// The briefing engine. Runs READ-ONLY queries across the other apps' tables (shared `sniper` DB)
// and assembles the per-opportunity dossier: the opportunity + company (SpecOps/Sniper), curated
// company intel (Commander), the live job posting (UAV), and the target people (Sniper via
// SpecOps's opportunity_contacts). Anti-Tank writes NONE of these tables.
//
// Mirrors commander/src/rollup.js's resilience pattern: every cross-app slice is independent +
// best-effort, so a schema drift in one app degrades that slice to null/[] (plus a warnings[]
// entry) instead of failing the whole briefing. Only the anchor (the opportunity itself) is
// allowed to throw — no opportunity, no briefing.
import { query } from './db.js';

// Stages where prep is live — the home list's default filter.
export const PREP_STAGES = ['hm_reply', 'screen_interview'];

// The opportunity + its company. The anchor slice: throws on DB error, null when missing.
async function opportunityRow(id) {
  const r = await query(
    `SELECT o.*, c.name AS company, c.id AS company_id
     FROM opportunities o JOIN companies c ON c.id = o.company_id
     WHERE o.id = $1`,
    [id]
  );
  return r.rows[0] || null;
}

// Commander's curated intel, joined by company name (the suite's cross-app join convention).
async function intelRows(company) {
  const r = await query(
    `SELECT section, title, body, source_url, updated_at
     FROM company_intel
     WHERE lower(company) = lower($1) AND COALESCE(body, '') <> ''
     ORDER BY section`,
    [company]
  );
  return r.rows;
}

// The UAV posting this opportunity is pinned to (SpecOps's job_posting_id link, when set).
async function postingRow(jobPostingId) {
  if (!jobPostingId) return null;
  const r = await query(
    `SELECT id, title, url, location, groups, closed_at, applied_at, last_applied_at
     FROM job_postings WHERE id = $1`,
    [jobPostingId]
  );
  return r.rows[0] || null;
}

// The target people (HMs/recruiters/champions) — SpecOps's link table joined to Sniper's profiles.
async function peopleRows(opportunityId) {
  const r = await query(
    `SELECT p.id, p.name, p.title, p.type, p.photo_path, p.linkedin_slug,
            p.current_title, p.current_company, p.current_tenure,
            p.previous_title, p.previous_company,
            p.ai_summary, p.ai_ins, p.my_notes,
            oc.role, oc.is_primary
     FROM opportunity_contacts oc JOIN people p ON p.id = oc.person_id
     WHERE oc.opportunity_id = $1
     ORDER BY oc.is_primary DESC, p.name`,
    [opportunityId]
  );
  return r.rows;
}

// --- Anti-Tank's OWN tables (not wrapped: our schema, a failure here is a real bug) ---

async function briefRows(opportunityId) {
  const r = await query(
    `SELECT section, title, body_md, updated_at
     FROM opportunity_briefs WHERE opportunity_id = $1 ORDER BY section`,
    [opportunityId]
  );
  return r.rows;
}

async function checklistRows(opportunityId) {
  const r = await query(
    `SELECT id, label, phase, sort_order, done, done_at, note
     FROM opportunity_checklist_items
     WHERE opportunity_id = $1
     ORDER BY CASE phase WHEN 'before' THEN 0 WHEN 'day_of' THEN 1 ELSE 2 END, sort_order, id`,
    [opportunityId]
  );
  return r.rows;
}

async function questionStats(opportunityId) {
  const r = await query(
    `SELECT COUNT(*)                                          AS total,
            COUNT(*) FILTER (WHERE times_drilled > 0)         AS drilled,
            COUNT(*) FILTER (WHERE last_grade = 'nailed')     AS nailed,
            COUNT(*) FILTER (WHERE last_grade = 'shaky')      AS shaky
     FROM prep_questions
     WHERE opportunity_id = $1 AND NOT archived`,
    [opportunityId]
  );
  const s = r.rows[0];
  return { total: Number(s.total), drilled: Number(s.drilled), nailed: Number(s.nailed), shaky: Number(s.shaky) };
}

async function lastPackRow(opportunityId) {
  const r = await query(
    `SELECT id, mode, questions_added, checklist_added, stories_added, briefs_updated, imported_at
     FROM prep_packs WHERE opportunity_id = $1 ORDER BY imported_at DESC LIMIT 1`,
    [opportunityId]
  );
  return r.rows[0] || null;
}

// The home list: opportunities + a prep rollup per card. Default filter = live-prep stages.
export async function listOpportunities({ all = false } = {}) {
  const r = await query(
    `SELECT o.id, o.role_title, o.stage, o.comp_range, o.location, o.job_posting_url,
            o.first_reply_at, o.updated_at, c.id AS company_id, c.name AS company,
            (SELECT COUNT(*) FROM prep_questions q
              WHERE q.opportunity_id = o.id AND NOT q.archived)                        AS question_count,
            (SELECT COUNT(*) FROM prep_questions q
              WHERE q.opportunity_id = o.id AND NOT q.archived AND q.times_drilled > 0) AS drilled_count,
            (SELECT COUNT(*) FROM prep_questions q
              WHERE q.opportunity_id = o.id AND NOT q.archived AND q.last_grade = 'nailed') AS nailed_count,
            (SELECT COUNT(*) FROM opportunity_checklist_items i
              WHERE i.opportunity_id = o.id)                                            AS checklist_total,
            (SELECT COUNT(*) FROM opportunity_checklist_items i
              WHERE i.opportunity_id = o.id AND i.done)                                 AS checklist_done,
            EXISTS (SELECT 1 FROM opportunity_briefs b
              WHERE b.opportunity_id = o.id AND b.section = 'angle'
                AND COALESCE(b.body_md, '') <> '')                                      AS has_angle
     FROM opportunities o JOIN companies c ON c.id = o.company_id
     WHERE $1 OR o.stage = ANY($2)
     ORDER BY CASE o.stage WHEN 'screen_interview' THEN 0 WHEN 'hm_reply' THEN 1 ELSE 2 END,
              o.updated_at DESC`,
    [all, PREP_STAGES]
  );
  return r.rows.map((row) => ({
    ...row,
    question_count: Number(row.question_count),
    drilled_count: Number(row.drilled_count),
    nailed_count: Number(row.nailed_count),
    checklist_total: Number(row.checklist_total),
    checklist_done: Number(row.checklist_done),
  }));
}

// The full dossier for one opportunity. Returns null if the opportunity doesn't exist.
export async function getBriefing(id) {
  const opportunity = await opportunityRow(id);
  if (!opportunity) return null;

  const warnings = [];
  const briefing = {
    opportunity,
    company_intel: [],
    job_posting: null,
    people: [],
    briefs: [],
    checklist: [],
    question_stats: { total: 0, drilled: 0, nailed: 0, shaky: 0 },
    last_pack: null,
    warnings,
  };

  try { briefing.company_intel = await intelRows(opportunity.company); }
  catch (err) { console.warn(`[briefing] intel(${opportunity.company}):`, err.message); warnings.push('company_intel unavailable'); }
  try { briefing.job_posting = await postingRow(opportunity.job_posting_id); }
  catch (err) { console.warn(`[briefing] posting(#${id}):`, err.message); warnings.push('job_posting unavailable'); }
  try { briefing.people = await peopleRows(id); }
  catch (err) { console.warn(`[briefing] people(#${id}):`, err.message); warnings.push('people unavailable'); }

  briefing.briefs = await briefRows(id);
  briefing.checklist = await checklistRows(id);
  briefing.question_stats = await questionStats(id);
  briefing.last_pack = await lastPackRow(id);
  return briefing;
}

// Everything a Claude Code session needs to WRITE a prep pack: the same dossier slices plus the
// existing question/story/checklist text (so a generation pass can avoid duplicates), trimmed of
// UI-only fields. Returns null if the opportunity doesn't exist.
export async function getPackContext(id) {
  const briefing = await getBriefing(id);
  if (!briefing) return null;

  const existingQuestions = await query(
    `SELECT question, category FROM prep_questions
     WHERE opportunity_id = $1 AND NOT archived ORDER BY sort_order, id`,
    [id]
  );
  const existingStories = await query(
    `SELECT title, tags FROM stories WHERE NOT archived ORDER BY title`
  );

  const o = briefing.opportunity;
  return {
    opportunity: {
      id: o.id, company: o.company, role_title: o.role_title, stage: o.stage,
      comp_range: o.comp_range, location: o.location,
      job_posting_url: o.job_posting_url, notes: o.notes,
    },
    company_intel: briefing.company_intel.map(({ section, title, body }) => ({ section, title, body })),
    job_posting: briefing.job_posting
      ? { title: briefing.job_posting.title, url: briefing.job_posting.url, location: briefing.job_posting.location, groups: briefing.job_posting.groups }
      : null,
    people: briefing.people.map((p) => ({
      name: p.name, title: p.title, type: p.type, role: p.role, is_primary: p.is_primary,
      current_title: p.current_title, current_company: p.current_company, current_tenure: p.current_tenure,
      previous_title: p.previous_title, previous_company: p.previous_company,
      ai_summary: p.ai_summary, ai_ins: p.ai_ins, my_notes: p.my_notes,
    })),
    briefs: briefing.briefs,
    existing: {
      questions: existingQuestions.rows,
      story_titles: existingStories.rows.map((s) => s.title),
      checklist_labels: briefing.checklist.map((i) => i.label),
    },
    warnings: briefing.warnings,
  };
}
