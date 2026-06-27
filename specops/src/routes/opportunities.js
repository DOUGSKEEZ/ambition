import { Router } from 'express';
import { query, withTransaction } from '../db.js';

const router = Router();

const STAGES = new Set(['lead', 'outreach', 'outreach_today', 'completed_outreach', 'hm_reply', 'screen_interview', 'closed']);
const OUTCOMES = new Set(['accepted', 'rejected', 'withdrawn']);
// Card visual status: the "active" accent color (a fixed palette mapped to CSS classes) and an
// emoji stamp. Kept in lock-step with CARD_COLORS / STAMPS in public/app.js.
const COLORS = new Set(['blue', 'red', 'green', 'orange']);
const STAMPS = new Set(['🔥', '✅', '⚠️', '🥶', '📝', '🚀']);
const DATE_FIELDS = new Set(['first_message_at', 'first_reply_at']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Columns the client may set on create/update. Names come from this whitelist (never raw
// input), values are always bound — so there's no injection surface in the dynamic SQL.
const EDITABLE = ['role_title', 'job_posting_url', 'stage', 'outcome', 'comp_range', 'location', 'first_message_at', 'first_reply_at', 'notes', 'accent_color', 'stamp'];

// Normalize an incoming value: '' / undefined -> null (so empty date inputs don't break, and
// blanks clear a field). Everything else passes through.
const clean = (v) => (v === '' || v === undefined ? null : v);
const isPrimaryFlag = (v) => v === true || v === 'true';

// Map common Postgres errors that stem from client input to 400 rather than a catch-all 500.
// 23503 FK violation, 22007/22P02 bad date/int text, 23514 check violation, 23505 unique.
const pgStatus = (err) => (['23503', '22007', '22P02', '23514', '23505'].includes(err?.code) ? 400 : 500);

// Validate the constrained fields of a payload against their CLEANED values (so the check and
// the value that actually gets stored agree). Returns an error string, or null if OK.
function validatePayload(body) {
  if ('stage' in body) {
    const s = clean(body.stage);
    if (s === null) return 'stage cannot be null';
    if (!STAGES.has(s)) return `invalid stage: ${body.stage}`;
  }
  if ('outcome' in body) {
    const o = clean(body.outcome);
    if (o !== null && !OUTCOMES.has(o)) return `invalid outcome: ${body.outcome}`;
  }
  if ('accent_color' in body) {
    const c = clean(body.accent_color);
    if (c !== null && !COLORS.has(c)) return `invalid color: ${body.accent_color}`;
  }
  if ('stamp' in body) {
    const s = clean(body.stamp);
    if (s !== null && !STAMPS.has(s)) return `invalid stamp: ${body.stamp}`;
  }
  for (const f of EDITABLE) {
    if (!(f in body)) continue;
    const v = clean(body[f]);
    if (v === null) continue;
    if (typeof v !== 'string') return `invalid value for ${f} (expected text)`;
    if (DATE_FIELDS.has(f) && !DATE_RE.test(v)) return `invalid date for ${f}: ${body[f]} (expected YYYY-MM-DD)`;
  }
  return null;
}

// An outcome only makes sense on a closed opportunity. When a payload moves the stage to a
// non-closed value, force-clear outcome so the DB invariant holds and stale outcomes don't linger.
function coerceOutcome(body) {
  if ('stage' in body && clean(body.stage) !== 'closed') body.outcome = null;
}

// job_posting_id is an INT (link to a UAV posting), so it can't ride the string-only EDITABLE path —
// it's handled separately like company_id. Returns: undefined = not provided, null = explicit clear,
// or an integer. Throws on a non-int value. A duplicate link is caught at the DB (unique) → 400.
function parseJobPostingId(body) {
  if (!('job_posting_id' in body)) return undefined;
  const v = clean(body.job_posting_id);
  if (v === null) return null;
  const n = Number.parseInt(v, 10);
  if (!Number.isInteger(n)) throw new Error('invalid job_posting_id');
  return n;
}

// SELECT one or all opportunities with company name + an aggregated contacts array.
function selectOpportunities(whereSql = '', params = []) {
  return query(
    `SELECT o.id, o.company_id, c.name AS company_name, o.role_title, o.job_posting_url,
            o.stage, o.outcome, o.accent_color, o.stamp, o.sort_order, o.comp_range, o.location,
            to_char(o.first_message_at, 'YYYY-MM-DD') AS first_message_at,
            to_char(o.first_reply_at, 'YYYY-MM-DD') AS first_reply_at,
            o.notes, o.created_at, o.updated_at,
            o.job_posting_id,
            jp.title AS job_posting_title, jp.url AS job_posting_link,
            jp.source AS job_posting_source, jp.closed_at AS job_posting_closed_at,
            COALESCE((
              SELECT json_agg(json_build_object(
                       'person_id', oc.person_id, 'name', p.name, 'title', p.title,
                       'type', p.type, 'photo_path', p.photo_path,
                       'role', oc.role, 'is_primary', oc.is_primary,
                       'my_notes', p.my_notes, 'ai_summary', p.ai_summary)
                     ORDER BY oc.is_primary DESC, p.name)
              FROM opportunity_contacts oc JOIN people p ON p.id = oc.person_id
              WHERE oc.opportunity_id = o.id
            ), '[]'::json) AS contacts
     FROM opportunities o
     JOIN companies c ON c.id = o.company_id
     LEFT JOIN job_postings jp ON jp.id = o.job_posting_id
     ${whereSql}
     ORDER BY o.sort_order NULLS LAST, o.created_at, o.id`,
    params
  );
}

// GET /opportunities?company_id=<int>
router.get('/', async (req, res) => {
  try {
    const companyId = Number.parseInt(req.query.company_id, 10);
    const r = Number.isInteger(companyId)
      ? await selectOpportunities('WHERE o.company_id = $1', [companyId])
      : await selectOpportunities();
    res.json(r.rows);
  } catch (err) {
    console.error('[GET /opportunities]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /opportunities/:id/first-message — the earliest message Doug sent to this opportunity's
// PRIMARY contact, pulled from Medic's send history (shared DB). Backs the "import" button so
// first_message_at doesn't have to be retyped. Returns null when there's no primary or no send.
router.get('/:id/first-message', async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad id' });
    const r = await query(
      `SELECT to_char(s.sent_at, 'YYYY-MM-DD') AS date, s.channel, s.customized_text AS text, p.name AS contact_name
       FROM opportunity_contacts oc
       JOIN people p ON p.id = oc.person_id
       JOIN person_campaigns pc ON pc.person_id = oc.person_id
       JOIN person_campaign_steps s ON s.person_campaign_id = pc.id
       WHERE oc.opportunity_id = $1 AND oc.is_primary AND s.sent AND s.sent_at IS NOT NULL
       ORDER BY s.sent_at ASC
       LIMIT 1`,
      [id]
    );
    res.json(r.rows[0] || null);
  } catch (err) {
    console.error('[GET /opportunities/:id/first-message]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /opportunities — company_id required; everything else optional.
router.post('/', async (req, res) => {
  try {
    const companyId = Number.parseInt(req.body.company_id, 10);
    if (!Number.isInteger(companyId)) return res.status(400).json({ error: 'company_id is required' });
    const verr = validatePayload(req.body);
    if (verr) return res.status(400).json({ error: verr });
    coerceOutcome(req.body);

    const cols = ['company_id'];
    const vals = [companyId];
    for (const f of EDITABLE) {
      if (f in req.body) { cols.push(f); vals.push(clean(req.body[f])); }
    }
    let jobPostingId;
    try { jobPostingId = parseJobPostingId(req.body); }
    catch (e) { return res.status(400).json({ error: e.message }); }
    if (jobPostingId !== undefined) { cols.push('job_posting_id'); vals.push(jobPostingId); }
    const placeholders = vals.map((_, i) => `$${i + 1}`);
    const ins = await query(
      `INSERT INTO opportunities (${cols.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING id`,
      vals
    );
    const r = await selectOpportunities('WHERE o.id = $1', [ins.rows[0].id]);
    res.status(201).json(r.rows[0]);
  } catch (err) {
    console.error('[POST /opportunities]', err);
    res.status(pgStatus(err)).json({ error: err.message });
  }
});

// PUT /opportunities/reorder — set the top-to-bottom order of one stage column. The column is a
// single ordered list of mixed items — cards and dividers share one sort_order space so a divider
// sits between two cards. Body: {stage, items:[{type:'opportunity'|'divider', id}, ...]} (legacy
// {ids:[...]} is still accepted as an all-opportunity list). Each item is moved into `stage` (so a
// drop that crosses columns is one call) and given a sequential sort_order; a card leaving `closed`
// has its outcome cleared to keep the outcome_only_when_closed invariant. Registered BEFORE '/:id'
// so the literal path isn't swallowed by the :id param route.
router.put('/reorder', async (req, res) => {
  try {
    const stage = clean(req.body.stage);
    if (!STAGES.has(stage)) return res.status(400).json({ error: `invalid stage: ${req.body.stage}` });

    // Normalize to a typed item list (legacy `ids` = all opportunities).
    const items = Array.isArray(req.body.items)
      ? req.body.items
      : Array.isArray(req.body.ids) ? req.body.ids.map((id) => ({ type: 'opportunity', id })) : null;
    if (!items) return res.status(400).json({ error: 'items must be an array' });
    const norm = items.map((it) => ({ type: it?.type, id: Number.parseInt(it?.id, 10) }));
    if (norm.some((it) => !Number.isInteger(it.id) || (it.type !== 'opportunity' && it.type !== 'divider'))) {
      return res.status(400).json({ error: 'each item needs an integer id and type opportunity|divider' });
    }

    await withTransaction(async (client) => {
      for (let i = 0; i < norm.length; i++) {
        const it = norm[i];
        if (it.type === 'divider') {
          await client.query('UPDATE board_dividers SET stage = $1, sort_order = $2 WHERE id = $3', [stage, i, it.id]);
        } else {
          await client.query(
            `UPDATE opportunities
               SET stage = $1, sort_order = $2,
                   outcome = CASE WHEN $1 = 'closed' THEN outcome ELSE NULL END
             WHERE id = $3`,
            [stage, i, it.id]
          );
        }
      }
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('[PUT /opportunities/reorder]', err);
    res.status(pgStatus(err)).json({ error: err.message });
  }
});

// PUT /opportunities/:id — patch any editable fields (stage move included). company_id may also be
// changed (e.g. an opportunity created under the wrong company); since contacts are company-scoped,
// moving companies unlinks any attached contacts that don't belong to the new company.
router.put('/:id', async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad id' });
    const verr = validatePayload(req.body);
    if (verr) return res.status(400).json({ error: verr });
    coerceOutcome(req.body);

    let newCompanyId = null;
    if ('company_id' in req.body) {
      newCompanyId = Number.parseInt(req.body.company_id, 10);
      if (!Number.isInteger(newCompanyId)) return res.status(400).json({ error: 'invalid company_id' });
    }

    let jobPostingId;
    try { jobPostingId = parseJobPostingId(req.body); }
    catch (e) { return res.status(400).json({ error: e.message }); }

    const sets = [];
    const vals = [];
    for (const f of EDITABLE) {
      if (f in req.body) { vals.push(clean(req.body[f])); sets.push(`${f} = $${vals.length}`); }
    }
    if (newCompanyId !== null) { vals.push(newCompanyId); sets.push(`company_id = $${vals.length}`); }
    if (jobPostingId !== undefined) { vals.push(jobPostingId); sets.push(`job_posting_id = $${vals.length}`); }
    if (!sets.length) return res.status(400).json({ error: 'nothing to update' });

    const updated = await withTransaction(async (client) => {
      vals.push(id);
      const upd = await client.query(`UPDATE opportunities SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING id`, vals);
      if (!upd.rows.length) return false;
      if (newCompanyId !== null) {
        await client.query(
          `DELETE FROM opportunity_contacts oc USING people p
           WHERE oc.opportunity_id = $1 AND oc.person_id = p.id AND p.company_id <> $2`,
          [id, newCompanyId]
        );
      }
      return true;
    });
    if (!updated) return res.status(404).json({ error: 'not found' });
    const r = await selectOpportunities('WHERE o.id = $1', [id]);
    res.json(r.rows[0]);
  } catch (err) {
    console.error('[PUT /opportunities/:id]', err);
    res.status(pgStatus(err)).json({ error: err.message });
  }
});

// DELETE /opportunities/:id (cascades to opportunity_contacts).
router.delete('/:id', async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad id' });
    const r = await query('DELETE FROM opportunities WHERE id = $1', [id]);
    if (!r.rowCount) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /opportunities/:id]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /opportunities/:id/contacts — attach (or update) a target contact. {person_id, role, is_primary}.
// The person must be at the opportunity's company. Setting is_primary clears any other primary in
// the same transaction (partial-unique index). Omitting role on re-attach preserves the existing role.
router.post('/:id/contacts', async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    const personId = Number.parseInt(req.body.person_id, 10);
    if (!Number.isInteger(id) || !Number.isInteger(personId)) return res.status(400).json({ error: 'id and person_id required' });

    // The contact must be a person at THIS opportunity's company. This one check also rejects a
    // missing opportunity or missing person, so no FK-violation 500 can escape here.
    const match = await query(
      `SELECT 1 FROM opportunities o JOIN people p ON p.company_id = o.company_id WHERE o.id = $1 AND p.id = $2`,
      [id, personId]
    );
    if (!match.rows.length) return res.status(400).json({ error: "contact must be a person at this opportunity's company" });

    const role = clean(req.body.role);
    const isPrimary = isPrimaryFlag(req.body.is_primary);
    await withTransaction(async (client) => {
      if (isPrimary) {
        await client.query('UPDATE opportunity_contacts SET is_primary = FALSE WHERE opportunity_id = $1 AND is_primary', [id]);
      }
      await client.query(
        `INSERT INTO opportunity_contacts (opportunity_id, person_id, role, is_primary)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (opportunity_id, person_id)
         DO UPDATE SET role = COALESCE(EXCLUDED.role, opportunity_contacts.role), is_primary = EXCLUDED.is_primary`,
        [id, personId, role, isPrimary]
      );
    });
    const r = await selectOpportunities('WHERE o.id = $1', [id]);
    res.json(r.rows[0]);
  } catch (err) {
    console.error('[POST /opportunities/:id/contacts]', err);
    res.status(pgStatus(err)).json({ error: err.message });
  }
});

// DELETE /opportunities/:id/contacts/:personId — detach a contact.
router.delete('/:id/contacts/:personId', async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    const personId = Number.parseInt(req.params.personId, 10);
    if (!Number.isInteger(id) || !Number.isInteger(personId)) return res.status(400).json({ error: 'bad id' });
    await query('DELETE FROM opportunity_contacts WHERE opportunity_id = $1 AND person_id = $2', [id, personId]);
    const r = await selectOpportunities('WHERE o.id = $1', [id]);
    if (!r.rows.length) return res.status(404).json({ error: 'not found' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error('[DELETE /opportunities/:id/contacts/:personId]', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
