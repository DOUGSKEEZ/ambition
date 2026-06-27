import { Router } from 'express';
import { query } from '../db.js';

const router = Router();

// Kept in lock-step with STAGES in opportunities.js / public/app.js.
const STAGES = new Set(['lead', 'outreach', 'outreach_today', 'completed_outreach', 'hm_reply', 'screen_interview', 'closed']);

const clean = (v) => (v === '' || v === undefined ? null : v);
const bool = (v) => v === true || v === 'true';
const pgStatus = (err) => (['23503', '22007', '22P02', '23514', '23505'].includes(err?.code) ? 400 : 500);

const SELECT = `SELECT id, stage, sort_order, label_above, label_below, chevron_up, chevron_down
                FROM board_dividers`;

// GET /dividers — every divider, ordered the same way cards are (stage, then sort_order). The board
// merges these with the opportunities by sort_order, so they're returned unfiltered by company.
router.get('/', async (_req, res) => {
  try {
    const r = await query(`${SELECT} ORDER BY stage, sort_order NULLS LAST, id`);
    res.json(r.rows);
  } catch (err) {
    console.error('[GET /dividers]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /dividers — add a divider to a stage column. It lands at the TOP of the column (one less than
// the smallest sort_order currently in that stage across cards AND dividers); drag it where you want.
router.post('/', async (req, res) => {
  try {
    const stage = clean(req.body.stage);
    if (!STAGES.has(stage)) return res.status(400).json({ error: `invalid stage: ${req.body.stage}` });
    const top = await query(
      `SELECT LEAST(
                COALESCE((SELECT MIN(sort_order) FROM opportunities   WHERE stage = $1), 0),
                COALESCE((SELECT MIN(sort_order) FROM board_dividers  WHERE stage = $1), 0)
              ) - 1 AS so`,
      [stage]
    );
    const ins = await query(
      `INSERT INTO board_dividers (stage, sort_order, label_above, label_below, chevron_up, chevron_down)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [stage, top.rows[0].so, clean(req.body.label_above), clean(req.body.label_below),
       bool(req.body.chevron_up), bool(req.body.chevron_down)]
    );
    const r = await query(`${SELECT} WHERE id = $1`, [ins.rows[0].id]);
    res.status(201).json(r.rows[0]);
  } catch (err) {
    console.error('[POST /dividers]', err);
    res.status(pgStatus(err)).json({ error: err.message });
  }
});

// PUT /dividers/:id — edit the captions and chevrons (position is changed via /opportunities/reorder).
router.put('/:id', async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad id' });
    const r = await query(
      `UPDATE board_dividers
          SET label_above = $1, label_below = $2, chevron_up = $3, chevron_down = $4
        WHERE id = $5
        RETURNING id`,
      [clean(req.body.label_above), clean(req.body.label_below),
       bool(req.body.chevron_up), bool(req.body.chevron_down), id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'not found' });
    const out = await query(`${SELECT} WHERE id = $1`, [id]);
    res.json(out.rows[0]);
  } catch (err) {
    console.error('[PUT /dividers/:id]', err);
    res.status(pgStatus(err)).json({ error: err.message });
  }
});

// DELETE /dividers/:id
router.delete('/:id', async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad id' });
    const r = await query('DELETE FROM board_dividers WHERE id = $1', [id]);
    if (!r.rowCount) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /dividers/:id]', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
