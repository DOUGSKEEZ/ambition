import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { runTracker } from '../tracker.js';
import { SOURCES, getSource } from '../sources.js';

const router = Router();

const REAPPLY_SOFT_DAYS = Number(process.env.REAPPLY_SOFT_DAYS) || 7;
const REAPPLY_HARD_DAYS = Number(process.env.REAPPLY_HARD_DAYS) || 14;
// A posting first seen within this many days is flagged "new" in the UI (highlighted on the card).
const NEW_DAYS = Number(process.env.UAV_NEW_DAYS) || 3;

const DISPOSITIONS = new Set(['active', 'rejected', 'not_interested']);

// Shared SELECT for postings: returns the stored columns + a computed days_since_applied (whole
// days since the last application, NULL if never applied) and is_new (first seen within NEW_DAYS)
// so the UI can render the aging badge + the new-role highlight.
function selectPostings(whereSql = '', params = []) {
  return query(
    `SELECT jp.id, jp.source, jp.job_id, jp.title, jp.url, jp.location, jp.groups, jp.disposition,
            to_char(jp.first_seen_at, 'YYYY-MM-DD') AS first_seen_at,
            to_char(jp.last_seen_at, 'YYYY-MM-DD') AS last_seen_at,
            jp.closed_at, jp.applied_at, jp.last_applied_at, jp.application_count,
            to_char(jp.last_applied_at, 'YYYY-MM-DD') AS last_applied_on,
            CASE WHEN jp.last_applied_at IS NULL THEN NULL
                 ELSE FLOOR(EXTRACT(EPOCH FROM (NOW() - jp.last_applied_at)) / 86400)::int
            END AS days_since_applied,
            (jp.first_seen_at > NOW() - make_interval(days => ${NEW_DAYS})) AS is_new,
            o.id AS opportunity_id, o.stage AS opportunity_stage, o.company_id
       FROM job_postings jp
       LEFT JOIN opportunities o ON o.job_posting_id = jp.id
       ${whereSql}
       ORDER BY jp.source, jp.first_seen_at DESC, jp.id`,
    params
  );
}

// GET /api/config — thresholds + sources, so the SPA can render badges/labels without hardcoding.
router.get('/config', (_req, res) => {
  res.json({
    reapplySoftDays: REAPPLY_SOFT_DAYS,
    reapplyHardDays: REAPPLY_HARD_DAYS,
    newDays: NEW_DAYS,
    dispositions: [...DISPOSITIONS],
    sources: SOURCES.map((s) => ({ key: s.key, label: s.label, provider: s.provider, careersUrl: s.careersUrl || null })),
  });
});

// GET /api/postings?status=open|closed|all&source=<key>
router.get('/postings', async (req, res) => {
  try {
    const status = req.query.status || 'open';
    const where = [];
    const params = [];
    if (status === 'open') where.push('jp.closed_at IS NULL');
    else if (status === 'closed') where.push('jp.closed_at IS NOT NULL');
    else if (status !== 'all') return res.status(400).json({ error: `invalid status: ${status}` });

    if (req.query.source) {
      if (!getSource(req.query.source)) return res.status(400).json({ error: `unknown source: ${req.query.source}` });
      params.push(req.query.source);
      where.push(`jp.source = $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const r = await selectPostings(whereSql, params);
    res.json(r.rows);
  } catch (err) {
    console.error('[GET /api/postings]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/events?limit=<n>&types=<a,b,c> — recent diff/activity history (capped).
// `types` is a comma-separated allow-list of event_type values; omit it for all types. Filtering
// happens in SQL so the limit applies to the *visible* set (e.g. screening out not_interested won't
// leave you with a near-empty feed).
router.get('/events', async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 200);
    const types = (req.query.types || '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    const params = [limit];
    let where = '';
    if (types.length) {
      params.push(types);
      where = `WHERE event_type = ANY($${params.length})`;
    }
    const r = await query(
      `SELECT id, posting_id, source, job_id, title, url, location, event_type, created_at
         FROM uav_events ${where} ORDER BY created_at DESC, id DESC LIMIT $1`,
      params
    );
    res.json(r.rows);
  } catch (err) {
    console.error('[GET /api/events]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/refresh — run the tracker now (on-demand radar refresh). Does NOT email; that's the
// scheduled pipeline's job. Returns the diff summary so the UI can toast + re-render.
router.post('/refresh', async (_req, res) => {
  try {
    const summary = await runTracker();
    res.json(summary);
  } catch (err) {
    console.error('[POST /api/refresh]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/postings/:id/apply — mark this role applied. First time sets applied_at + starts the
// aging timer; subsequent calls are a re-apply (bump last_applied_at + count). Writes an event.
router.post('/postings/:id/apply', async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad id' });

    const row = await withTransaction(async (client) => {
      const upd = await client.query(
        `UPDATE job_postings
            SET applied_at = COALESCE(applied_at, NOW()),
                last_applied_at = NOW(),
                application_count = application_count + 1
          WHERE id = $1
          RETURNING id, source, job_id, title, url, location, application_count`,
        [id]
      );
      if (!upd.rows.length) return null;
      const p = upd.rows[0];
      await client.query(
        `INSERT INTO uav_events (posting_id, source, job_id, title, url, location, event_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [p.id, p.source, p.job_id, p.title, p.url, p.location, p.application_count > 1 ? 'reapplied' : 'applied']
      );
      return p;
    });
    if (!row) return res.status(404).json({ error: 'not found' });
    const r = await selectPostings('WHERE jp.id = $1', [id]);
    res.json(r.rows[0]);
  } catch (err) {
    console.error('[POST /api/postings/:id/apply]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/postings/:id/unapply — clear application state (undo a mistaken "applied").
router.post('/postings/:id/unapply', async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad id' });
    const upd = await query(
      `UPDATE job_postings SET applied_at = NULL, last_applied_at = NULL, application_count = 0
        WHERE id = $1 RETURNING id`,
      [id]
    );
    if (!upd.rows.length) return res.status(404).json({ error: 'not found' });
    const r = await selectPostings('WHERE jp.id = $1', [id]);
    res.json(r.rows[0]);
  } catch (err) {
    console.error('[POST /api/postings/:id/unapply]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/postings/:id/applied-date — correct the applied date (e.g. you actually applied a few
// days ago). Sets last_applied_at to the given YYYY-MM-DD; if the role wasn't applied yet it becomes
// applied (count 1). This is an edit, not a re-apply: application_count is not bumped and no event is
// logged. The aging timer (days_since_applied) recomputes off the new date.
router.post('/postings/:id/applied-date', async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad id' });
    const date = req.body?.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    const upd = await query(
      `UPDATE job_postings
          SET last_applied_at = $2::date,
              applied_at = COALESCE(applied_at, $2::date),
              application_count = GREATEST(application_count, 1)
        WHERE id = $1 RETURNING id`,
      [id, date]
    );
    if (!upd.rows.length) return res.status(404).json({ error: 'not found' });
    const r = await selectPostings('WHERE jp.id = $1', [id]);
    res.json(r.rows[0]);
  } catch (err) {
    console.error('[POST /api/postings/:id/applied-date]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/postings/:id/status — set the user disposition (active | rejected | not_interested).
// Separate from applied state + board open/closed. Rejected/not_interested get minimized in the UI;
// switching back to active logs a 'reactivated' event.
router.post('/postings/:id/status', async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad id' });
    const disposition = req.body?.disposition;
    if (!DISPOSITIONS.has(disposition)) return res.status(400).json({ error: `invalid disposition: ${disposition}` });

    const row = await withTransaction(async (client) => {
      const upd = await client.query(
        `UPDATE job_postings SET disposition = $1 WHERE id = $2
         RETURNING id, source, job_id, title, url, location`,
        [disposition, id]
      );
      if (!upd.rows.length) return null;
      const p = upd.rows[0];
      // Log the change (active => 'reactivated', else the disposition name itself).
      const evt = disposition === 'active' ? 'reactivated' : disposition;
      await client.query(
        `INSERT INTO uav_events (posting_id, source, job_id, title, url, location, event_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [p.id, p.source, p.job_id, p.title, p.url, p.location, evt]
      );
      return p;
    });
    if (!row) return res.status(404).json({ error: 'not found' });
    const r = await selectPostings('WHERE jp.id = $1', [id]);
    res.json(r.rows[0]);
  } catch (err) {
    console.error('[POST /api/postings/:id/status]', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
