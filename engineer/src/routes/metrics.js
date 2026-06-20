import { Router } from 'express';
import { query } from '../db.js';

const router = Router();

// Whitelists. The `granularity` value is passed as a bound parameter to date_trunc, and the
// `segment` value only ever selects one of these fixed SQL expressions — neither is ever
// string-interpolated from raw input, so there is no injection surface.
const GRANULARITY = new Set(['day', 'week']);
const SEGMENT_EXPR = {
  type: "COALESCE(p.type, 'unknown')",
  company: "COALESCE(c.name, '(no company)')",
};

// Day/week buckets are anchored to Doug's local day, not the server's. We convert sent_at
// (a timestamptz) into local wall-clock with `AT TIME ZONE` BEFORE truncating, so an 8pm
// send lands on the day it felt like — and so buckets don't shift if Postgres runs under a
// different session TZ (e.g. UTC in a container). Override with REPORT_TZ if Doug relocates.
const REPORT_TZ = process.env.REPORT_TZ || 'America/Denver';

// GET /metrics/outbound?granularity=day|week&segment=type|company&company_id=<int>
//
// Outbound touches = campaign steps Doug has marked sent. Bucketed by period and split by
// contact type (HM / recruiter / peer) or by company. Returns tidy rows
// [{ period:'YYYY-MM-DD', seg_key, count }] that the frontend pivots into stacked datasets.
// `period` is emitted as a plain string (to_char) so node-pg's DATE→Date parsing can't shift
// it across a timezone. Two deliberate scope choices, both matching Medic's /queue/done recap:
//   • No import_status filter — a contact archived/cold-stored later was still genuinely
//     contacted, so the touch counts.
//   • No person_campaigns.status filter — sends on a since-archived run (e.g. a campaign was
//     reassigned) are real touches that happened; reassignment creates fresh unsent steps
//     rather than copying sent state, so this does not double-count one physical send.
router.get('/outbound', async (req, res) => {
  try {
    const granularity = GRANULARITY.has(req.query.granularity) ? req.query.granularity : 'day';
    const segment = SEGMENT_EXPR[req.query.segment] ? req.query.segment : 'type';
    const segExpr = SEGMENT_EXPR[segment];

    const params = [REPORT_TZ, granularity];
    let companyFilter = '';
    // Strict numeric-string check: ignore junk ('5abc') and duplicate-param arrays rather than
    // letting parseInt silently coerce them into a wrong filter. (Value is bound either way.)
    const rawCo = req.query.company_id;
    if (typeof rawCo === 'string' && /^\d+$/.test(rawCo)) {
      params.push(Number(rawCo));
      companyFilter = `AND p.company_id = $${params.length}`;
    }

    const result = await query(
      `SELECT to_char(date_trunc($2, s.sent_at AT TIME ZONE $1), 'YYYY-MM-DD') AS period,
              ${segExpr} AS seg_key,
              COUNT(*)::int AS count
       FROM person_campaign_steps s
       JOIN person_campaigns pc ON pc.id = s.person_campaign_id
       JOIN people p ON p.id = pc.person_id
       LEFT JOIN companies c ON c.id = p.company_id
       WHERE s.sent = TRUE AND s.sent_at IS NOT NULL
         ${companyFilter}
       GROUP BY period, seg_key
       ORDER BY period`,
      params
    );
    res.json({ granularity, segment, rows: result.rows });
  } catch (err) {
    console.error('[GET /metrics/outbound]', err);
    res.status(500).json({ error: err.message });
  }
});

// Which column the funnel stacks by. Whitelisted (only ever 'type_key' or 'company_key'),
// never interpolated from raw input — the UNION below computes both, this just picks one.
const FUNNEL_SEG_COL = { type: 'type_key', company: 'company_key' };

// GET /metrics/funnel?segment=type|company&company_id=<int>
//
// The contact-lifecycle funnel: how far each sourced contact has progressed in the CURRENT
// active pipeline, as a snapshot (no history needed). Five milestones, each counting DISTINCT
// people, optionally split by contact type or company:
//   Captured    — every person Sniper sourced (any import_status)
//   Active      — approved into the working set (import_status='active' AND status='active')
//   In campaign — Active AND has an active Medic run
//   Touched     — In campaign AND ≥1 step sent on that active run
//   Responded   — Touched AND ≥1 reply received on that active run
// The stage flags are CUMULATIVE — each ANDs in every prior condition — so the stages are
// strictly nested subsets (Responded ⊆ Touched ⊆ In campaign ⊆ Active ⊆ Captured). That
// guarantees the funnel can't invert and the frontend "% of prev" conversion is always ≤100%.
// NOTE: this is deliberately the *current active pipeline*, so "Touched" here (sent on the
// active run) is a stricter measure than /outbound's "sent ever" (which counts archived runs).
// A person counts once per stage in their own type/company bucket, so stacks never double-count.
// The next stage after Responded would be "Opportunity" — that's SpecOps, not built yet.
router.get('/funnel', async (req, res) => {
  try {
    const segment = FUNNEL_SEG_COL[req.query.segment] ? req.query.segment : 'type';
    const segCol = FUNNEL_SEG_COL[segment];

    const params = [];
    let companyFilter = '';
    const rawCo = req.query.company_id;
    if (typeof rawCo === 'string' && /^\d+$/.test(rawCo)) {
      params.push(Number(rawCo));
      companyFilter = `WHERE p.company_id = $${params.length}`;
    }

    const result = await query(
      `WITH flags AS (
         SELECT p.id,
                COALESCE(p.type, 'unknown') AS type_key,
                COALESCE(c.name, '(no company)') AS company_key,
                (p.import_status = 'active' AND p.status = 'active') AS is_active,
                EXISTS (SELECT 1 FROM person_campaigns pc
                        WHERE pc.person_id = p.id AND pc.status = 'active') AS has_active_run,
                EXISTS (SELECT 1 FROM person_campaigns pc
                        JOIN person_campaign_steps s ON s.person_campaign_id = pc.id
                        WHERE pc.person_id = p.id AND pc.status = 'active' AND s.sent) AS sent_on_active,
                EXISTS (SELECT 1 FROM person_campaigns pc
                        JOIN person_campaign_steps s ON s.person_campaign_id = pc.id
                        WHERE pc.person_id = p.id AND pc.status = 'active' AND s.response_received) AS resp_on_active
         FROM people p
         LEFT JOIN companies c ON c.id = p.company_id
         ${companyFilter}
       ),
       base AS (
         SELECT id, type_key, company_key,
                is_active AS s_active,
                (is_active AND has_active_run) AS s_in_campaign,
                (is_active AND has_active_run AND sent_on_active) AS s_touched,
                (is_active AND has_active_run AND sent_on_active AND resp_on_active) AS s_responded
         FROM flags
       )
       SELECT stage_order, stage, ${segCol} AS seg_key, COUNT(*)::int AS count
       FROM (
                   SELECT 1 AS stage_order, 'captured'    AS stage, type_key, company_key FROM base
         UNION ALL SELECT 2,               'active',                type_key, company_key FROM base WHERE s_active
         UNION ALL SELECT 3,               'in_campaign',           type_key, company_key FROM base WHERE s_in_campaign
         UNION ALL SELECT 4,               'touched',               type_key, company_key FROM base WHERE s_touched
         UNION ALL SELECT 5,               'responded',             type_key, company_key FROM base WHERE s_responded
       ) x
       GROUP BY stage_order, stage, ${segCol}
       ORDER BY stage_order`,
      params
    );
    res.json({ segment, rows: result.rows });
  } catch (err) {
    console.error('[GET /metrics/funnel]', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
