// The prep-pack importer — Anti-Tank's "AI generation" seam. The app itself is KEYLESS: packs are
// written by Claude Code in the terminal (GET /api/opportunities/:id/pack-context → generate →
// POST /api/opportunities/:id/pack). This module validates a pack exhaustively (the consumer is a
// model that self-corrects, so a 400 lists EVERY problem, not just the first) and imports it in
// one transaction: upsert briefs, upsert stories by title, insert deduped questions + checklist
// items, link suggested stories, and log the exact payload to prep_packs.
import { withTransaction } from './db.js';

export const CATEGORIES = ['behavioral', 'technical', 'company', 'role', 'logistics', 'curveball', 'general'];
export const PHASES = ['before', 'day_of', 'after'];

// Served verbatim by GET /api/pack-schema so any future Claude Code session can learn the
// contract with one curl — no source-reading required.
export const PACK_SCHEMA = {
  description:
    'A prep pack for one opportunity. All top-level keys are optional. Workflow: ' +
    'GET /api/opportunities/:id/pack-context (the generation context, incl. existing titles for dedupe) ' +
    '→ generate → POST /api/opportunities/:id/pack. Imported questions get source=claude. ' +
    "mode 'replace' first archives the opportunity's existing claude-sourced questions (their drill " +
    "history is kept); 'append' (default) only adds. Duplicate questions (same text, case-insensitive) " +
    'and checklist labels are skipped, stories upsert by title. The response echoes ' +
    '{ questions_added, checklist_added, stories_added, briefs_updated, skipped[] }.',
  schema: {
    mode: "'append' | 'replace' (optional, default 'append')",
    angle_md: "markdown (optional) — shorthand for briefs section 'angle': my positioning for THIS role",
    briefs: [{ section: "required — e.g. 'questions_for_them' | 'logistics' | 'notes'", title: 'optional heading', body_md: 'markdown' }],
    questions: [{
      question: 'required — the interview question text',
      category: `optional, one of ${CATEGORIES.join('|')} (default 'general')`,
      my_answer_md: 'optional — a drafted answer / talking points (markdown)',
      suggested_stories: ['optional — story TITLES to link (resolved against pack stories + the existing library, case-insensitive)'],
    }],
    checklist: [{ label: 'required', phase: `optional, one of ${PHASES.join('|')} (default 'before')` }],
    stories: [{
      title: 'required — the upsert key (case-insensitive)',
      situation_md: 'optional', task_md: 'optional', action_md: 'optional', result_md: 'optional',
      body_md: 'optional freeform alternative to STAR',
      tags: ['optional strings'],
    }],
  },
  example: {
    mode: 'append',
    angle_md: '**Why me for this role:** 8 years enterprise AE…',
    briefs: [{ section: 'questions_for_them', body_md: '- How does the team qualify enterprise deals today?' }],
    questions: [{
      question: 'Tell me about a deal you lost and why.',
      category: 'behavioral',
      my_answer_md: 'Lead with the honest loss, pivot to the process change…',
      suggested_stories: ['The lost Q3 platform deal'],
    }],
    checklist: [{ label: 'Confirm who is on the panel', phase: 'before' }],
    stories: [{
      title: 'The lost Q3 platform deal',
      situation_md: '…', task_md: '…', action_md: '…', result_md: '…',
      tags: ['lost-deal', 'process'],
    }],
  },
};

const isStr = (v) => typeof v === 'string';
const optStr = (v) => v == null || isStr(v);

// Validate a pack. Returns a list of problems — empty means valid.
export function validatePack(pack) {
  const problems = [];
  if (!pack || typeof pack !== 'object' || Array.isArray(pack)) return ['pack must be a JSON object'];
  if (pack.mode != null && !['append', 'replace'].includes(pack.mode)) problems.push("mode must be 'append' or 'replace'");
  if (!optStr(pack.angle_md)) problems.push('angle_md must be a string');

  const arr = (key) => {
    if (pack[key] == null) return [];
    if (!Array.isArray(pack[key])) { problems.push(`${key} must be an array`); return []; }
    return pack[key];
  };
  arr('briefs').forEach((b, i) => {
    if (!b || !isStr(b.section) || !b.section.trim()) problems.push(`briefs[${i}].section is required`);
    if (!optStr(b?.title)) problems.push(`briefs[${i}].title must be a string`);
    if (!optStr(b?.body_md)) problems.push(`briefs[${i}].body_md must be a string`);
  });
  arr('questions').forEach((q, i) => {
    if (!q || !isStr(q.question) || !q.question.trim()) problems.push(`questions[${i}].question is required`);
    if (q?.category != null && !CATEGORIES.includes(q.category)) problems.push(`questions[${i}].category must be one of ${CATEGORIES.join('|')}`);
    if (!optStr(q?.my_answer_md)) problems.push(`questions[${i}].my_answer_md must be a string`);
    if (q?.suggested_stories != null && (!Array.isArray(q.suggested_stories) || q.suggested_stories.some((s) => !isStr(s)))) {
      problems.push(`questions[${i}].suggested_stories must be an array of story-title strings`);
    }
  });
  arr('checklist').forEach((c, i) => {
    if (!c || !isStr(c.label) || !c.label.trim()) problems.push(`checklist[${i}].label is required`);
    if (c?.phase != null && !PHASES.includes(c.phase)) problems.push(`checklist[${i}].phase must be one of ${PHASES.join('|')}`);
  });
  arr('stories').forEach((s, i) => {
    if (!s || !isStr(s.title) || !s.title.trim()) problems.push(`stories[${i}].title is required`);
    for (const f of ['situation_md', 'task_md', 'action_md', 'result_md', 'body_md']) {
      if (!optStr(s?.[f])) problems.push(`stories[${i}].${f} must be a string`);
    }
    if (s?.tags != null && (!Array.isArray(s.tags) || s.tags.some((t) => !isStr(t)))) problems.push(`stories[${i}].tags must be an array of strings`);
  });
  return problems;
}

// Import a (validated) pack for one opportunity, transactionally. Returns the counts + skipped[].
export async function importPack(opportunityId, pack) {
  const mode = pack.mode || 'append';
  return withTransaction(async (client) => {
    const skipped = [];
    let questionsAdded = 0, checklistAdded = 0, storiesAdded = 0, briefsUpdated = 0;

    // replace: retire the previous claude-generated bank (drill history rides along, untouched).
    if (mode === 'replace') {
      await client.query(
        `UPDATE prep_questions SET archived = TRUE
         WHERE opportunity_id = $1 AND source = 'claude' AND NOT archived`,
        [opportunityId]
      );
    }

    // Briefs (angle_md is shorthand for the 'angle' section).
    const briefs = [...(pack.briefs || [])];
    if (pack.angle_md != null) briefs.push({ section: 'angle', body_md: pack.angle_md });
    for (const b of briefs) {
      await client.query(
        `INSERT INTO opportunity_briefs (opportunity_id, section, title, body_md)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (opportunity_id, section)
         DO UPDATE SET title = COALESCE(EXCLUDED.title, opportunity_briefs.title), body_md = EXCLUDED.body_md`,
        [opportunityId, b.section.trim(), b.title?.trim() || null, b.body_md ?? null]
      );
      briefsUpdated++;
    }

    // Stories: upsert by title (case-insensitive), global library.
    for (const s of pack.stories || []) {
      const existing = await client.query(
        `SELECT id FROM stories WHERE lower(title) = lower($1) LIMIT 1`,
        [s.title.trim()]
      );
      if (existing.rows.length) {
        await client.query(
          `UPDATE stories SET
             situation_md = COALESCE($2, situation_md), task_md = COALESCE($3, task_md),
             action_md = COALESCE($4, action_md), result_md = COALESCE($5, result_md),
             body_md = COALESCE($6, body_md),
             tags = CASE WHEN $7::text[] IS NULL THEN tags ELSE $7::text[] END,
             archived = FALSE
           WHERE id = $1`,
          [existing.rows[0].id, s.situation_md ?? null, s.task_md ?? null, s.action_md ?? null,
           s.result_md ?? null, s.body_md ?? null, s.tags ?? null]
        );
        skipped.push(`story "${s.title}" already existed — updated in place`);
      } else {
        await client.query(
          `INSERT INTO stories (title, situation_md, task_md, action_md, result_md, body_md, tags)
           VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::text[], '{}'))`,
          [s.title.trim(), s.situation_md ?? null, s.task_md ?? null, s.action_md ?? null,
           s.result_md ?? null, s.body_md ?? null, s.tags ?? null]
        );
        storiesAdded++;
      }
    }

    // Questions: dedupe on text (case-insensitive) against the opportunity's NON-archived bank —
    // including rows added earlier in this same pack.
    const existingQ = await client.query(
      `SELECT lower(question) AS q FROM prep_questions WHERE opportunity_id = $1 AND NOT archived`,
      [opportunityId]
    );
    const seen = new Set(existingQ.rows.map((r) => r.q));
    const maxSort = await client.query(
      `SELECT COALESCE(MAX(sort_order), 0) AS m FROM prep_questions WHERE opportunity_id = $1`,
      [opportunityId]
    );
    let sort = Number(maxSort.rows[0].m);
    for (const q of pack.questions || []) {
      const key = q.question.trim().toLowerCase();
      if (seen.has(key)) { skipped.push(`question "${q.question.slice(0, 60)}…" already in the bank`); continue; }
      seen.add(key);
      const inserted = await client.query(
        `INSERT INTO prep_questions (opportunity_id, question, category, source, my_answer_md, sort_order)
         VALUES ($1, $2, $3, 'claude', $4, $5) RETURNING id`,
        [opportunityId, q.question.trim(), q.category || 'general', q.my_answer_md ?? null, ++sort]
      );
      questionsAdded++;
      // Link suggested stories by title against the (post-upsert) library.
      for (const title of q.suggested_stories || []) {
        const st = await client.query(`SELECT id FROM stories WHERE lower(title) = lower($1) LIMIT 1`, [title.trim()]);
        if (!st.rows.length) { skipped.push(`suggested story "${title}" not found for question "${q.question.slice(0, 40)}…"`); continue; }
        await client.query(
          `INSERT INTO question_stories (question_id, story_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [inserted.rows[0].id, st.rows[0].id]
        );
      }
    }

    // Checklist: dedupe on label (case-insensitive).
    const existingC = await client.query(
      `SELECT lower(label) AS l FROM opportunity_checklist_items WHERE opportunity_id = $1`,
      [opportunityId]
    );
    const seenLabels = new Set(existingC.rows.map((r) => r.l));
    const maxCSort = await client.query(
      `SELECT COALESCE(MAX(sort_order), 0) AS m FROM opportunity_checklist_items WHERE opportunity_id = $1`,
      [opportunityId]
    );
    let csort = Number(maxCSort.rows[0].m);
    for (const c of pack.checklist || []) {
      const key = c.label.trim().toLowerCase();
      if (seenLabels.has(key)) { skipped.push(`checklist "${c.label}" already present`); continue; }
      seenLabels.add(key);
      await client.query(
        `INSERT INTO opportunity_checklist_items (opportunity_id, label, phase, sort_order)
         VALUES ($1, $2, $3, $4)`,
        [opportunityId, c.label.trim(), c.phase || 'before', ++csort]
      );
      checklistAdded++;
    }

    await client.query(
      `INSERT INTO prep_packs (opportunity_id, payload, mode, questions_added, checklist_added, stories_added, briefs_updated)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [opportunityId, JSON.stringify(pack), mode, questionsAdded, checklistAdded, storiesAdded, briefsUpdated]
    );

    return {
      mode,
      questions_added: questionsAdded,
      checklist_added: checklistAdded,
      stories_added: storiesAdded,
      briefs_updated: briefsUpdated,
      skipped,
    };
  });
}
