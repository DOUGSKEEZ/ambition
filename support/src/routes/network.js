import { Router } from 'express';
import { query, withTransaction } from '../db.js';

const router = Router();

// Same slug derivation Sniper's parser uses — keeps manual adds and captures in agreement.
function slugFromUrl(url) {
  const m = String(url || '').match(/linkedin\.com\/in\/([^/?#]+)/i);
  return m ? decodeURIComponent(m[1]) : null;
}

// Columns the UI is allowed to PATCH. `completed_at` is server-managed (see coerceCompleted).
const EDITABLE = new Set([
  'name', 'company', 'note', 'channels', 'recc_flag', 'completed', 'completed_via',
  'status', 'linkedin_slug',
]);

const CHANNELS = new Set(['call', 'text', 'email', 'linkedin']);
const STATUSES = new Set(['active', 'waiting', 'inactive']);

// The read-time join IS the sync mechanism: a manual row and a later Sniper capture of the
// same slug merge here without any write-time linking. Support-owned values win (COALESCE
// order) so a capture can never overwrite a name or company typed on the card.
const SELECT_JOINED = `
  SELECT np.*,
         COALESCE(np.name, p.name) AS display_name,
         COALESCE(np.company, c.name, p.current_company) AS display_company,
         p.title, p.photo_path, p.linkedin_url,
         (p.id IS NOT NULL) AS linked
  FROM network_people np
  LEFT JOIN people p ON p.linkedin_slug = np.linkedin_slug
  LEFT JOIN companies c ON c.id = p.company_id`;

// Board order: manual position within the column, NULLs first so a fresh "→ Support" capture
// (which has no sort_order yet) lands at the top of Active rather than the bottom.
const BOARD_ORDER = 'ORDER BY np.sort_order ASC NULLS FIRST, np.created_at DESC, np.id DESC';

// Normalize + validate the fields shared by POST and PATCH. Returns an error string or null.
function validate(body) {
  if ('channels' in body) {
    if (!Array.isArray(body.channels)) return 'channels must be an array';
    if (body.channels.some((c) => !CHANNELS.has(c))) return 'invalid channel';
  }
  if ('status' in body && body.status != null && !STATUSES.has(body.status)) return 'invalid status';
  if ('completed_via' in body && body.completed_via != null && body.completed_via !== ''
      && !CHANNELS.has(body.completed_via)) return 'invalid completed_via';
  return null;
}

// Ticking Completed stamps the time; clearing it wipes the stamp and the verb, so a card that
// comes back to life doesn't keep a stale "✅ Texted" strip.
function coerceCompleted(updates, current) {
  const has = (k) => Object.prototype.hasOwnProperty.call(updates, k);
  if (!has('completed')) return updates;
  if (updates.completed) {
    if (!current?.completed) updates.completed_at = new Date();
    // Only one channel on the card? Then the verb is unambiguous — infer it rather than ask.
    if (!has('completed_via') && !current?.completed_via) {
      const chans = has('channels') ? updates.channels : current?.channels;
      if (Array.isArray(chans) && chans.length === 1) updates.completed_via = chans[0];
    }
  } else {
    updates.completed_at = null;
    updates.completed_via = null;
  }
  return updates;
}

// GET /api/people — the whole board in one call. Filtering (search / recc / channel) is done
// client-side so the columns never disappear out from under a drag.
router.get('/people', async (_req, res) => {
  try {
    const result = await query(`${SELECT_JOINED} ${BOARD_ORDER}`);
    res.json(result.rows);
  } catch (err) {
    console.error('[GET /people]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/people — manual add. Needs a name or a LinkedIn URL (to derive the slug).
router.post('/people', async (req, res) => {
  try {
    const { name, linkedin_url, company, note, channels, recc_flag, status } = req.body || {};
    const slug = slugFromUrl(linkedin_url);
    if (!name && !slug) {
      return res.status(400).json({ error: 'provide a name or a LinkedIn profile URL' });
    }
    const verr = validate(req.body || {});
    if (verr) return res.status(400).json({ error: verr });
    const inserted = await query(
      `INSERT INTO network_people (linkedin_slug, name, company, note, channels, recc_flag, status)
       VALUES ($1, $2, $3, $4, COALESCE($5::text[], '{}'), COALESCE($6, FALSE), COALESCE($7, 'active'))
       RETURNING id`,
      [slug, name || null, company || null, note || null, channels || null, recc_flag, status || null]);
    const row = await query(`${SELECT_JOINED} WHERE np.id = $1`, [inserted.rows[0].id]);
    res.status(201).json(row.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'already tracked' });
    console.error('[POST /people]', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/people/reorder — set the top-to-bottom order of one column. Body: {status, ids:[…]}.
// Each id is moved into `status` (so a cross-column drop is a single call) and given a sequential
// sort_order. Registered before '/people/:id' for clarity; the methods differ so there's no clash.
router.put('/people/reorder', async (req, res) => {
  try {
    const { status } = req.body || {};
    if (!STATUSES.has(status)) return res.status(400).json({ error: `invalid status: ${status}` });
    if (!Array.isArray(req.body.ids)) return res.status(400).json({ error: 'ids must be an array' });
    const ids = req.body.ids.map((id) => Number.parseInt(id, 10));
    if (ids.some((id) => !Number.isInteger(id))) return res.status(400).json({ error: 'ids must be integers' });

    await withTransaction(async (client) => {
      for (let i = 0; i < ids.length; i++) {
        await client.query(
          'UPDATE network_people SET status = $1, sort_order = $2 WHERE id = $3', [status, i, ids[i]]);
      }
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('[PUT /people/reorder]', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/people/:id — update editable fields.
router.patch('/people/:id', async (req, res) => {
  try {
    const verr = validate(req.body || {});
    if (verr) return res.status(400).json({ error: verr });

    const current = await query(
      'SELECT completed, completed_via, channels FROM network_people WHERE id = $1', [req.params.id]);
    if (!current.rowCount) return res.status(404).json({ error: 'not found' });

    const patch = coerceCompleted(
      Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => EDITABLE.has(k))),
      current.rows[0]);
    // completed_at is set by coerceCompleted, never by the client.
    const updates = Object.entries(patch).filter(([k]) => EDITABLE.has(k) || k === 'completed_at');
    if (!updates.length) return res.status(400).json({ error: 'no editable fields provided' });

    const sets = updates.map(([k], i) => `${k} = $${i + 2}`);
    // '' means "cleared" for text fields; an empty channels array is a real value, so keep it.
    const values = updates.map(([, v]) => (v === '' ? null : v));
    const result = await query(
      `UPDATE network_people SET ${sets.join(', ')} WHERE id = $1 RETURNING id`,
      [req.params.id, ...values]);
    if (!result.rowCount) return res.status(404).json({ error: 'not found' });
    const row = await query(`${SELECT_JOINED} WHERE np.id = $1`, [req.params.id]);
    res.json(row.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'already tracked' });
    console.error('[PATCH /people/:id]', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/people/:id — removes the Support row only (Sniper owns any photo/raw files).
router.delete('/people/:id', async (req, res) => {
  try {
    const result = await query('DELETE FROM network_people WHERE id = $1', [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /people/:id]', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
