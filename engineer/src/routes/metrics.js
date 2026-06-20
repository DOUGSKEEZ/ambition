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

export default router;
