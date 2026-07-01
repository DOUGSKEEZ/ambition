// The SITREP fact-gatherer. Runs READ-ONLY aggregate queries across the other apps' tables (all in
// the shared `sniper` DB) to answer "where do I stand with company X" — contacts by type, going-cold
// count, last touch, open opportunities by stage, open roles + applied count. The output is a compact
// facts object handed to ai.writeSitrep(); Commander writes NONE of these tables.
//
// Joins are by COMPANY NAME (source label == companies.name == job_postings.company), matching how
// UAV/SpecOps already denormalize the label. A company with no CRM footprint just yields zeros.
import { query } from './db.js';

const COLD_DAYS = Number(process.env.COLD_DAYS) || 7;

const emptyFacts = (company) => ({
  company,
  contacts: { total: 0, recruiter: 0, peer: 0, hiring_manager: 0, going_cold: 0 },
  last_touch_at: null,
  opportunities: { open: 0, by_stage: {}, closed_won: 0, closed_lost: 0 },
  roles: { open: 0, applied: 0 },
});

// Contacts (active only), broken out by type, plus a "going cold" count and the last touch date.
async function contactFacts(company) {
  const r = await query(
    `SELECT
       COUNT(*)                                                              AS total,
       COUNT(*) FILTER (WHERE p.type = 'recruiter')                          AS recruiter,
       COUNT(*) FILTER (WHERE p.type = 'peer')                               AS peer,
       COUNT(*) FILTER (WHERE p.type = 'hiring_manager')                     AS hiring_manager,
       COUNT(*) FILTER (WHERE p.last_action_at < NOW() - make_interval(days => $2::int)) AS going_cold,
       MAX(p.last_action_at)                                                 AS last_touch_at
     FROM people p
     JOIN companies c ON c.id = p.company_id
     WHERE lower(c.name) = lower($1)
       AND p.import_status = 'active' AND p.status = 'active'`,
    [company, COLD_DAYS]
  );
  return r.rows[0];
}

// Opportunities by stage + closed outcomes (SpecOps).
async function opportunityFacts(company) {
  const r = await query(
    `SELECT o.stage, o.outcome, COUNT(*) AS n
     FROM opportunities o
     JOIN companies c ON c.id = o.company_id
     WHERE lower(c.name) = lower($1)
     GROUP BY o.stage, o.outcome`,
    [company]
  );
  const by_stage = {};
  let open = 0;
  let closed_won = 0;
  let closed_lost = 0;
  for (const row of r.rows) {
    const n = Number(row.n);
    by_stage[row.stage] = (by_stage[row.stage] || 0) + n;
    if (row.stage === 'closed') {
      if (row.outcome === 'accepted') closed_won += n;
      else closed_lost += n;
    } else {
      open += n;
    }
  }
  return { open, by_stage, closed_won, closed_lost };
}

// Open roles + how many are marked applied (UAV job_postings, joined by denormalized company label).
async function roleFacts(company) {
  const r = await query(
    `SELECT
       COUNT(*) FILTER (WHERE closed_at IS NULL)                                          AS open,
       COUNT(*) FILTER (WHERE closed_at IS NULL AND last_applied_at IS NOT NULL)          AS applied
     FROM job_postings
     WHERE lower(company) = lower($1)`,
    [company]
  );
  return r.rows[0];
}

// Gather all facts for one company. Each sub-query is independent + best-effort so a missing table or
// a schema drift in one app degrades to zeros for that slice instead of failing the whole SITREP.
export async function getCompanyFacts(company) {
  const facts = emptyFacts(company);
  try {
    const c = await contactFacts(company);
    facts.contacts = {
      total: Number(c.total), recruiter: Number(c.recruiter), peer: Number(c.peer),
      hiring_manager: Number(c.hiring_manager), going_cold: Number(c.going_cold),
    };
    facts.last_touch_at = c.last_touch_at;
  } catch (err) { console.warn(`[rollup] contacts(${company}):`, err.message); }
  try { facts.opportunities = await opportunityFacts(company); }
  catch (err) { console.warn(`[rollup] opportunities(${company}):`, err.message); }
  try {
    const roles = await roleFacts(company);
    facts.roles = { open: Number(roles.open), applied: Number(roles.applied) };
  } catch (err) { console.warn(`[rollup] roles(${company}):`, err.message); }
  return facts;
}

// Whole-campaign facts: per-company breakdown + rolled-up totals, for the dashboard SITREP.
export async function getAllFacts(companies) {
  const per = [];
  for (const name of companies) per.push(await getCompanyFacts(name));
  const totals = per.reduce(
    (a, f) => ({
      contacts: a.contacts + f.contacts.total,
      going_cold: a.going_cold + f.contacts.going_cold,
      open_opportunities: a.open_opportunities + f.opportunities.open,
      open_roles: a.open_roles + f.roles.open,
      applied_roles: a.applied_roles + f.roles.applied,
    }),
    { contacts: 0, going_cold: 0, open_opportunities: 0, open_roles: 0, applied_roles: 0 }
  );
  return { totals, companies: per };
}
