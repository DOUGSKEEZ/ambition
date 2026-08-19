// Anti-Tank API — thin HTTP layer over briefing.js (cross-app reads), pack.js (the Claude Code
// import seam), ai.js (local-only drill banter), and this app's own tables.
import { Router } from 'express';
import { query } from '../db.js';
import { listOpportunities, getBriefing, getPackContext } from '../briefing.js';
import { validatePack, importPack, PACK_SCHEMA, CATEGORIES, PHASES } from '../pack.js';
import { generateBanter } from '../ai.js';

const router = Router();

const intId = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// Async handlers funnel errors to the JSON error middleware instead of hanging the request.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ======================= opportunities + briefing =======================

router.get('/opportunities', wrap(async (req, res) => {
  const rows = await listOpportunities({ all: req.query.all === '1' });
  res.json({ opportunities: rows });
}));

router.get('/opportunities/:id/briefing', wrap(async (req, res) => {
  const id = intId(req.params.id);
  if (!id) return res.status(400).json({ error: 'bad opportunity id' });
  const briefing = await getBriefing(id);
  if (!briefing) return res.status(404).json({ error: 'opportunity not found' });
  res.json(briefing);
}));

router.put('/opportunities/:id/briefs/:section', wrap(async (req, res) => {
  const id = intId(req.params.id);
  const section = String(req.params.section || '').trim().toLowerCase().replace(/\s+/g, '_');
  if (!id || !section) return res.status(400).json({ error: 'bad opportunity id or section' });
  const { title, body_md } = req.body || {};
  const r = await query(
    `INSERT INTO opportunity_briefs (opportunity_id, section, title, body_md)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (opportunity_id, section) DO UPDATE SET title = EXCLUDED.title, body_md = EXCLUDED.body_md
     RETURNING *`,
    [id, section, title?.trim() || null, body_md ?? null]
  );
  res.json(r.rows[0]);
}));

// ======================= checklist =======================

router.get('/checklist-templates', wrap(async (_req, res) => {
  const r = await query(
    `SELECT t.id, t.name,
            COALESCE(json_agg(json_build_object('id', i.id, 'label', i.label, 'phase', i.phase, 'sort_order', i.sort_order)
                              ORDER BY i.sort_order, i.id) FILTER (WHERE i.id IS NOT NULL), '[]') AS items
     FROM checklist_templates t
     LEFT JOIN checklist_template_items i ON i.template_id = t.id
     GROUP BY t.id ORDER BY t.name`
  );
  res.json({ templates: r.rows });
}));

router.post('/checklist-templates/:id/items', wrap(async (req, res) => {
  const id = intId(req.params.id);
  const { label, phase, sort_order } = req.body || {};
  if (!id || !label?.trim()) return res.status(400).json({ error: 'template id and label required' });
  if (phase != null && !PHASES.includes(phase)) return res.status(400).json({ error: `phase must be one of ${PHASES.join('|')}` });
  const r = await query(
    `INSERT INTO checklist_template_items (template_id, label, phase, sort_order)
     VALUES ($1, $2, COALESCE($3, 'before'),
             COALESCE($4, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM checklist_template_items WHERE template_id = $1)))
     RETURNING *`,
    [id, label.trim(), phase ?? null, sort_order ?? null]
  );
  res.status(201).json(r.rows[0]);
}));

router.patch('/checklist-template-items/:id', wrap(async (req, res) => {
  const id = intId(req.params.id);
  if (!id) return res.status(400).json({ error: 'bad item id' });
  const { label, phase, sort_order } = req.body || {};
  if (phase != null && !PHASES.includes(phase)) return res.status(400).json({ error: `phase must be one of ${PHASES.join('|')}` });
  const r = await query(
    `UPDATE checklist_template_items SET
       label = COALESCE($2, label), phase = COALESCE($3, phase), sort_order = COALESCE($4, sort_order)
     WHERE id = $1 RETURNING *`,
    [id, label?.trim() ?? null, phase ?? null, sort_order ?? null]
  );
  if (!r.rows.length) return res.status(404).json({ error: 'template item not found' });
  res.json(r.rows[0]);
}));

router.delete('/checklist-template-items/:id', wrap(async (req, res) => {
  const id = intId(req.params.id);
  if (!id) return res.status(400).json({ error: 'bad item id' });
  await query(`DELETE FROM checklist_template_items WHERE id = $1`, [id]);
  res.json({ ok: true });
}));

// Copy a template's items into the opportunity (the Meddic campaign→run pattern). Re-runnable:
// items whose label is already on the opportunity are skipped, so it only appends what's new.
router.post('/opportunities/:id/checklist/instantiate', wrap(async (req, res) => {
  const id = intId(req.params.id);
  const templateId = intId(req.body?.template_id);
  if (!id || !templateId) return res.status(400).json({ error: 'opportunity id and template_id required' });
  const r = await query(
    `INSERT INTO opportunity_checklist_items (opportunity_id, label, phase, sort_order, source_template_id)
     SELECT $1, i.label, i.phase,
            (SELECT COALESCE(MAX(sort_order), 0) FROM opportunity_checklist_items WHERE opportunity_id = $1) + i.sort_order,
            i.template_id
     FROM checklist_template_items i
     WHERE i.template_id = $2
       AND NOT EXISTS (SELECT 1 FROM opportunity_checklist_items x
                       WHERE x.opportunity_id = $1 AND lower(x.label) = lower(i.label))
     ORDER BY i.sort_order, i.id
     RETURNING id`,
    [id, templateId]
  );
  res.json({ added: r.rows.length });
}));

router.post('/opportunities/:id/checklist', wrap(async (req, res) => {
  const id = intId(req.params.id);
  const { label, phase } = req.body || {};
  if (!id || !label?.trim()) return res.status(400).json({ error: 'opportunity id and label required' });
  if (phase != null && !PHASES.includes(phase)) return res.status(400).json({ error: `phase must be one of ${PHASES.join('|')}` });
  const r = await query(
    `INSERT INTO opportunity_checklist_items (opportunity_id, label, phase, sort_order)
     VALUES ($1, $2, COALESCE($3, 'before'),
             (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM opportunity_checklist_items WHERE opportunity_id = $1))
     RETURNING *`,
    [id, label.trim(), phase ?? null]
  );
  res.status(201).json(r.rows[0]);
}));

router.patch('/checklist-items/:id', wrap(async (req, res) => {
  const id = intId(req.params.id);
  if (!id) return res.status(400).json({ error: 'bad item id' });
  const { done, label, note, phase } = req.body || {};
  if (phase != null && !PHASES.includes(phase)) return res.status(400).json({ error: `phase must be one of ${PHASES.join('|')}` });
  const r = await query(
    `UPDATE opportunity_checklist_items SET
       done = COALESCE($2, done),
       done_at = CASE WHEN $2 IS TRUE THEN NOW() WHEN $2 IS FALSE THEN NULL ELSE done_at END,
       label = COALESCE($3, label), note = COALESCE($4, note), phase = COALESCE($5, phase)
     WHERE id = $1 RETURNING *`,
    [id, typeof done === 'boolean' ? done : null, label?.trim() ?? null, note ?? null, phase ?? null]
  );
  if (!r.rows.length) return res.status(404).json({ error: 'checklist item not found' });
  res.json(r.rows[0]);
}));

router.delete('/checklist-items/:id', wrap(async (req, res) => {
  const id = intId(req.params.id);
  if (!id) return res.status(400).json({ error: 'bad item id' });
  await query(`DELETE FROM opportunity_checklist_items WHERE id = $1`, [id]);
  res.json({ ok: true });
}));

// ======================= questions + drill =======================

router.get('/opportunities/:id/questions', wrap(async (req, res) => {
  const id = intId(req.params.id);
  if (!id) return res.status(400).json({ error: 'bad opportunity id' });
  const includeArchived = req.query.include_archived === '1';
  const r = await query(
    `SELECT q.*,
            COALESCE(json_agg(json_build_object('id', s.id, 'title', s.title) ORDER BY s.title)
                     FILTER (WHERE s.id IS NOT NULL), '[]') AS stories
     FROM prep_questions q
     LEFT JOIN question_stories qs ON qs.question_id = q.id
     LEFT JOIN stories s ON s.id = qs.story_id AND NOT s.archived
     WHERE q.opportunity_id = $1 AND ($2 OR NOT q.archived)
     GROUP BY q.id
     ORDER BY q.sort_order, q.id`,
    [id, includeArchived]
  );
  res.json({ questions: r.rows });
}));

router.post('/opportunities/:id/questions', wrap(async (req, res) => {
  const id = intId(req.params.id);
  const { question, category, my_answer_md } = req.body || {};
  if (!id || !question?.trim()) return res.status(400).json({ error: 'opportunity id and question required' });
  if (category != null && !CATEGORIES.includes(category)) return res.status(400).json({ error: `category must be one of ${CATEGORIES.join('|')}` });
  const r = await query(
    `INSERT INTO prep_questions (opportunity_id, question, category, source, my_answer_md, sort_order)
     VALUES ($1, $2, COALESCE($3, 'general'), 'manual', $4,
             (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM prep_questions WHERE opportunity_id = $1))
     RETURNING *`,
    [id, question.trim(), category ?? null, my_answer_md ?? null]
  );
  res.status(201).json(r.rows[0]);
}));

router.patch('/questions/:id', wrap(async (req, res) => {
  const id = intId(req.params.id);
  if (!id) return res.status(400).json({ error: 'bad question id' });
  const { question, category, my_answer_md, sort_order, archived } = req.body || {};
  if (category != null && !CATEGORIES.includes(category)) return res.status(400).json({ error: `category must be one of ${CATEGORIES.join('|')}` });
  const r = await query(
    `UPDATE prep_questions SET
       question = COALESCE($2, question), category = COALESCE($3, category),
       my_answer_md = COALESCE($4, my_answer_md), sort_order = COALESCE($5, sort_order),
       archived = COALESCE($6, archived)
     WHERE id = $1 RETURNING *`,
    [id, question?.trim() ?? null, category ?? null, my_answer_md ?? null,
     sort_order ?? null, typeof archived === 'boolean' ? archived : null]
  );
  if (!r.rows.length) return res.status(404).json({ error: 'question not found' });
  res.json(r.rows[0]);
}));

router.post('/questions/:id/grade', wrap(async (req, res) => {
  const id = intId(req.params.id);
  const { grade } = req.body || {};
  if (!id) return res.status(400).json({ error: 'bad question id' });
  if (!['nailed', 'shaky'].includes(grade)) return res.status(400).json({ error: "grade must be 'nailed' or 'shaky'" });
  const r = await query(
    `UPDATE prep_questions SET
       times_drilled = times_drilled + 1,
       nailed_count = nailed_count + ($2 = 'nailed')::int,
       shaky_count  = shaky_count  + ($2 = 'shaky')::int,
       last_grade = $2, last_drilled_at = NOW()
     WHERE id = $1 RETURNING *`,
    [id, grade]
  );
  if (!r.rows.length) return res.status(404).json({ error: 'question not found' });
  res.json(r.rows[0]);
}));

// Local-only qwen3 pushback. Degrades to { banter: null } (200) when the endpoint is down — the
// drill carries on without it.
router.post('/questions/:id/banter', wrap(async (req, res) => {
  const id = intId(req.params.id);
  if (!id) return res.status(400).json({ error: 'bad question id' });
  const r = await query(
    `SELECT q.question, q.my_answer_md, o.role_title, c.name AS company
     FROM prep_questions q
     JOIN opportunities o ON o.id = q.opportunity_id
     JOIN companies c ON c.id = o.company_id
     WHERE q.id = $1`,
    [id]
  );
  if (!r.rows.length) return res.status(404).json({ error: 'question not found' });
  const row = r.rows[0];
  const result = await generateBanter({
    company: row.company,
    role: row.role_title,
    question: row.question,
    my_answer: row.my_answer_md,
    spoken_notes: req.body?.spoken_notes,
  });
  res.json(result ? { banter: result.text, provider: result.provider } : { banter: null });
}));

router.put('/questions/:id/stories', wrap(async (req, res) => {
  const id = intId(req.params.id);
  const storyIds = req.body?.story_ids;
  if (!id) return res.status(400).json({ error: 'bad question id' });
  if (!Array.isArray(storyIds) || storyIds.some((s) => !intId(s))) {
    return res.status(400).json({ error: 'story_ids must be an array of ids' });
  }
  const q = await query(`SELECT id FROM prep_questions WHERE id = $1`, [id]);
  if (!q.rows.length) return res.status(404).json({ error: 'question not found' });
  await query(`DELETE FROM question_stories WHERE question_id = $1`, [id]);
  if (storyIds.length) {
    await query(
      `INSERT INTO question_stories (question_id, story_id)
       SELECT $1, s.id FROM stories s WHERE s.id = ANY($2::int[])
       ON CONFLICT DO NOTHING`,
      [id, storyIds]
    );
  }
  res.json({ ok: true, linked: storyIds.length });
}));

// ======================= stories (global) =======================

router.get('/stories', wrap(async (req, res) => {
  const tag = req.query.tag?.trim() || null;
  const r = await query(
    `SELECT s.*, (SELECT COUNT(*) FROM question_stories qs WHERE qs.story_id = s.id) AS usage_count
     FROM stories s
     WHERE NOT s.archived AND ($1::text IS NULL OR $1 = ANY(s.tags))
     ORDER BY s.title`,
    [tag]
  );
  res.json({ stories: r.rows.map((s) => ({ ...s, usage_count: Number(s.usage_count) })) });
}));

router.post('/stories', wrap(async (req, res) => {
  const { title, situation_md, task_md, action_md, result_md, body_md, tags } = req.body || {};
  if (!title?.trim()) return res.status(400).json({ error: 'title required' });
  if (tags != null && (!Array.isArray(tags) || tags.some((t) => typeof t !== 'string'))) {
    return res.status(400).json({ error: 'tags must be an array of strings' });
  }
  const r = await query(
    `INSERT INTO stories (title, situation_md, task_md, action_md, result_md, body_md, tags)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::text[], '{}')) RETURNING *`,
    [title.trim(), situation_md ?? null, task_md ?? null, action_md ?? null,
     result_md ?? null, body_md ?? null, tags ?? null]
  );
  res.status(201).json(r.rows[0]);
}));

router.patch('/stories/:id', wrap(async (req, res) => {
  const id = intId(req.params.id);
  if (!id) return res.status(400).json({ error: 'bad story id' });
  const { title, situation_md, task_md, action_md, result_md, body_md, tags } = req.body || {};
  if (tags != null && (!Array.isArray(tags) || tags.some((t) => typeof t !== 'string'))) {
    return res.status(400).json({ error: 'tags must be an array of strings' });
  }
  const r = await query(
    `UPDATE stories SET
       title = COALESCE($2, title),
       situation_md = COALESCE($3, situation_md), task_md = COALESCE($4, task_md),
       action_md = COALESCE($5, action_md), result_md = COALESCE($6, result_md),
       body_md = COALESCE($7, body_md),
       tags = CASE WHEN $8::text[] IS NULL THEN tags ELSE $8::text[] END
     WHERE id = $1 RETURNING *`,
    [id, title?.trim() ?? null, situation_md ?? null, task_md ?? null,
     action_md ?? null, result_md ?? null, body_md ?? null, tags ?? null]
  );
  if (!r.rows.length) return res.status(404).json({ error: 'story not found' });
  res.json(r.rows[0]);
}));

// Archive, never destroy — the story's question links survive an un-archive.
router.delete('/stories/:id', wrap(async (req, res) => {
  const id = intId(req.params.id);
  if (!id) return res.status(400).json({ error: 'bad story id' });
  const r = await query(`UPDATE stories SET archived = TRUE WHERE id = $1 RETURNING id`, [id]);
  if (!r.rows.length) return res.status(404).json({ error: 'story not found' });
  res.json({ ok: true });
}));

// ======================= prep packs (the Claude Code seam) =======================

router.get('/pack-schema', (_req, res) => res.json(PACK_SCHEMA));

router.get('/opportunities/:id/pack-context', wrap(async (req, res) => {
  const id = intId(req.params.id);
  if (!id) return res.status(400).json({ error: 'bad opportunity id' });
  const ctx = await getPackContext(id);
  if (!ctx) return res.status(404).json({ error: 'opportunity not found' });
  res.json(ctx);
}));

router.post('/opportunities/:id/pack', wrap(async (req, res) => {
  const id = intId(req.params.id);
  if (!id) return res.status(400).json({ error: 'bad opportunity id' });
  const opp = await query(`SELECT id FROM opportunities WHERE id = $1`, [id]);
  if (!opp.rows.length) return res.status(404).json({ error: 'opportunity not found' });
  const problems = validatePack(req.body);
  if (problems.length) return res.status(400).json({ error: 'invalid pack', problems });
  const result = await importPack(id, req.body);
  res.json(result);
}));

export default router;
