// The SITREP fact + ACTION engine. Runs READ-ONLY queries across the other apps' tables (shared
// `sniper` DB) and turns them into a ranked list of concrete next actions per company — Doug's
// funnel questions, answered deterministically in SQL (the LLM only phrases/prioritizes, it never
// computes). Commander writes NONE of these tables.
//
//   TOP of funnel      — staged contacts waiting in the Sniper queue? actives never qualified into a
//                        Meddic campaign? UAV roles left unapplied (quota-aware, e.g. OpenAI 5/180d)?
//   MIDDLE of funnel   — in-campaign contacts with no due date? due in the next few days but not
//                        marked staged?
//   BOTTOM of funnel   — opportunities in Screen & Interview → CALL THEM OUT.
//
// Joins are by COMPANY NAME (source label == companies.name == job_postings.company), matching how
// UAV/SpecOps denormalize the label. A company with no CRM footprint yields zeros + a "no contacts"
// flag. Severity ranks: critical > high > medium > low (cards show the top few; the SITREP leads
// with criticals).
import { query } from './db.js';

const DUE_SOON_DAYS = Number(process.env.DUE_SOON_DAYS) || 3;

const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };

// One row of everything countable about a company's funnel state.
async function funnelRow(company) {
  const r = await query(
    `WITH co AS (SELECT id, name FROM companies WHERE lower(name) = lower($1)),
     ppl AS (
       SELECT p.* FROM people p JOIN co ON p.company_id = co.id
     ),
     actives AS (
       SELECT p.*, (pc.id IS NOT NULL) AS in_campaign
       FROM ppl p
       LEFT JOIN person_campaigns pc ON pc.person_id = p.id AND pc.status = 'active'
       WHERE p.import_status = 'active' AND p.status = 'active'
     )
     SELECT
       (SELECT id FROM co)                                                          AS company_id,
       (SELECT COUNT(*) FROM ppl WHERE import_status = 'staged')                    AS sniper_staged,
       (SELECT COUNT(*) FROM actives)                                               AS active_contacts,
       (SELECT COUNT(*) FROM actives WHERE NOT in_campaign)                         AS no_campaign,
       (SELECT COUNT(*) FROM actives WHERE in_campaign AND next_action_date IS NULL) AS no_due_date,
       (SELECT COUNT(*) FROM actives
         WHERE in_campaign AND NOT staged
           AND next_action_date IS NOT NULL
           AND next_action_date <= CURRENT_DATE + $2::int)                          AS due_not_staged
     `,
    [company, DUE_SOON_DAYS]
  );
  return r.rows[0];
}

// Open/unapplied UAV roles, quota-aware: appLimit (replicated from UAV's source config) caps how
// many applications fit in the rolling window, counted by last_applied_at like UAV's /api/quota.
async function roleRow(company, appLimit) {
  const r = await query(
    `SELECT
       COUNT(*) FILTER (WHERE closed_at IS NULL AND disposition = 'active')                             AS open,
       COUNT(*) FILTER (WHERE closed_at IS NULL AND disposition = 'active' AND last_applied_at IS NULL) AS unapplied,
       COUNT(*) FILTER (WHERE last_applied_at IS NOT NULL
                          AND last_applied_at > NOW() - make_interval(days => $2::int))                  AS used_in_window
     FROM job_postings
     WHERE lower(company) = lower($1)`,
    [company, appLimit?.windowDays || 0]
  );
  const row = r.rows[0];
  const roles = { open: Number(row.open), unapplied: Number(row.unapplied) };
  if (appLimit) {
    roles.quota = {
      max: appLimit.max,
      windowDays: appLimit.windowDays,
      used: Number(row.used_in_window),
      remaining: Math.max(0, appLimit.max - Number(row.used_in_window)),
    };
  }
  return roles;
}

// Opportunities: stage counts + the Screen & Interview cards themselves (titles for the callout).
async function oppRows(company) {
  const r = await query(
    `SELECT o.stage, o.outcome, o.role_title
     FROM opportunities o JOIN companies c ON c.id = o.company_id
     WHERE lower(c.name) = lower($1)`,
    [company]
  );
  const by_stage = {};
  const interviews = [];
  for (const row of r.rows) {
    by_stage[row.stage] = (by_stage[row.stage] || 0) + 1;
    if (row.stage === 'screen_interview') interviews.push(row.role_title || '(untitled role)');
  }
  return { by_stage, interviews, open: r.rows.filter((x) => x.stage !== 'closed').length };
}

// Turn the counts into ranked, imperative action flags. Every flag is something Doug can DO.
function buildActions(company, f, roles, opps) {
  const actions = [];
  const add = (severity, code, text) => actions.push({ severity, code, text });

  // BOTTOM of funnel first — an interview in motion beats everything.
  if (opps.interviews.length) {
    add('critical', 'interview_live',
      `🎯 IN SCREEN & INTERVIEW: ${opps.interviews.join(', ')} — prep and drive these`);
  }

  // MIDDLE — outreach mechanics slipping.
  if (f.due_not_staged > 0) {
    add('high', 'due_not_staged',
      `Stage outreach for ${f.due_not_staged} contact${f.due_not_staged > 1 ? 's' : ''} due within ${DUE_SOON_DAYS} days`);
  }
  if (f.no_due_date > 0) {
    add('medium', 'no_due_date',
      `Set a next-action date for ${f.no_due_date} in-campaign contact${f.no_due_date > 1 ? 's' : ''}`);
  }
  if (f.no_campaign > 0) {
    add('medium', 'no_campaign',
      `Assign a campaign to ${f.no_campaign} active contact${f.no_campaign > 1 ? 's' : ''} sitting outside Meddic`);
  }

  // TOP — feed the machine.
  if (roles.unapplied > 0) {
    if (roles.quota) {
      if (roles.quota.remaining > 0) {
        add('high', 'unapplied_roles',
          `Apply to ${Math.min(roles.unapplied, roles.quota.remaining)} of ${roles.unapplied} open role${roles.unapplied > 1 ? 's' : ''} (${roles.quota.remaining} quota slot${roles.quota.remaining > 1 ? 's' : ''} left of ${roles.quota.max}/${roles.quota.windowDays}d)`);
      }
      // quota full → applying isn't possible; not an action
    } else {
      add('high', 'unapplied_roles', `Apply to ${roles.unapplied} open role${roles.unapplied > 1 ? 's' : ''} on the board`);
    }
  }
  if (f.sniper_staged > 0) {
    add('low', 'sniper_backlog',
      `Review ${f.sniper_staged} contact${f.sniper_staged > 1 ? 's' : ''} staged in the Sniper queue`);
  }
  if (f.active_contacts === 0 && f.sniper_staged === 0) {
    add('high', 'no_contacts', `No contacts at all — source targets in Sniper`);
  }

  actions.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  return actions;
}

// Gather facts + actions for one company. Each slice is independent + best-effort so a schema drift
// in one app degrades that slice to zeros instead of failing the whole rollup.
export async function getCompanyFacts(company, { appLimit } = {}) {
  const facts = {
    company,
    company_id: null,
    funnel: { sniper_staged: 0, active_contacts: 0, no_campaign: 0, no_due_date: 0, due_not_staged: 0 },
    roles: { open: 0, unapplied: 0 },
    opportunities: { by_stage: {}, interviews: [], open: 0 },
    actions: [],
  };
  try {
    const f = await funnelRow(company);
    facts.company_id = f.company_id;
    facts.funnel = {
      sniper_staged: Number(f.sniper_staged), active_contacts: Number(f.active_contacts),
      no_campaign: Number(f.no_campaign), no_due_date: Number(f.no_due_date),
      due_not_staged: Number(f.due_not_staged),
    };
  } catch (err) { console.warn(`[rollup] funnel(${company}):`, err.message); }
  try { facts.roles = await roleRow(company, appLimit); }
  catch (err) { console.warn(`[rollup] roles(${company}):`, err.message); }
  try { facts.opportunities = await oppRows(company); }
  catch (err) { console.warn(`[rollup] opportunities(${company}):`, err.message); }

  facts.actions = buildActions(company, facts.funnel, facts.roles, facts.opportunities);
  return facts;
}

// Whole-campaign: per-company facts + a flat, globally-ranked action list for the dashboard SITREP.
export async function getAllFacts(sources) {
  const companies = [];
  for (const s of sources) companies.push(await getCompanyFacts(s.label, { appLimit: s.appLimit }));
  const actions = companies
    .flatMap((c) => c.actions.map((a) => ({ ...a, company: c.company })))
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  return { companies, actions };
}
