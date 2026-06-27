import { Router } from 'express';
import { query, pool } from '../db.js';

const router = Router();

// GET /campaigns — list with step counts.
router.get('/', async (_req, res) => {
  try {
    const result = await query(
      `SELECT c.*, COUNT(s.id) AS step_count
       FROM campaigns c LEFT JOIN campaign_steps s ON s.campaign_id = c.id
       GROUP BY c.id ORDER BY c.name`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[GET /campaigns]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /campaigns/:id — campaign + ordered steps.
router.get('/:id', async (req, res) => {
  try {
    const c = await query('SELECT * FROM campaigns WHERE id = $1', [req.params.id]);
    if (!c.rowCount) return res.status(404).json({ error: 'not found' });
    const steps = await query(
      'SELECT * FROM campaign_steps WHERE campaign_id = $1 ORDER BY step_order',
      [req.params.id]
    );
    res.json({ ...c.rows[0], steps: steps.rows });
  } catch (err) {
    console.error('[GET /campaigns/:id]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /campaigns — create (optionally with steps in one shot).
router.post('/', async (req, res) => {
  const client = await pool.connect();
  try {
    const { name, category, goal, steps } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
    await client.query('BEGIN');
    const c = await client.query(
      'INSERT INTO campaigns (name, category, goal) VALUES ($1, $2, $3) RETURNING *',
      [name.trim(), category || null, goal || null]
    );
    const campaign = c.rows[0];
    if (Array.isArray(steps)) {
      for (let i = 0; i < steps.length; i++) {
        const s = steps[i];
        await client.query(
          `INSERT INTO campaign_steps (campaign_id, step_order, channel, purpose, skeleton_text, default_delay_days)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [campaign.id, s.step_order ?? i + 1, s.channel || null, s.purpose || null,
           s.skeleton_text || null, s.default_delay_days ?? null]
        );
      }
    }
    await client.query('COMMIT');
    res.status(201).json(campaign);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[POST /campaigns]', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// PUT /campaigns/:id — update campaign fields.
router.put('/:id', async (req, res) => {
  try {
    const { name, category, goal } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
    const result = await query(
      'UPDATE campaigns SET name = $2, category = $3, goal = $4 WHERE id = $1 RETURNING *',
      [req.params.id, name.trim(), category || null, goal || null]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[PUT /campaigns/:id]', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /campaigns/:id — steps cascade. Existing person runs keep their copied steps
// (campaign_id on the run is set NULL by the FK), so deleting a play never corrupts history.
router.delete('/:id', async (req, res) => {
  try {
    const result = await query('DELETE FROM campaigns WHERE id = $1 RETURNING id', [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'not found' });
    res.json({ deleted: result.rows[0].id });
  } catch (err) {
    console.error('[DELETE /campaigns/:id]', err);
    res.status(500).json({ error: err.message });
  }
});

// --- Steps -----------------------------------------------------------------

// POST /campaigns/:id/steps — append or insert a step.
router.post('/:id/steps', async (req, res) => {
  try {
    const { step_order, channel, purpose, skeleton_text, default_delay_days } = req.body || {};
    // Default to next order if not provided.
    let order = step_order;
    if (order == null) {
      const m = await query('SELECT COALESCE(MAX(step_order),0)+1 AS n FROM campaign_steps WHERE campaign_id = $1', [req.params.id]);
      order = m.rows[0].n;
    }
    const result = await query(
      `INSERT INTO campaign_steps (campaign_id, step_order, channel, purpose, skeleton_text, default_delay_days)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.params.id, order, channel || null, purpose || null, skeleton_text || null, default_delay_days ?? null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[POST /campaigns/:id/steps]', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /campaigns/:id/steps/:stepId — edit a step.
router.put('/:id/steps/:stepId', async (req, res) => {
  try {
    const { step_order, channel, purpose, skeleton_text, default_delay_days } = req.body || {};
    const result = await query(
      `UPDATE campaign_steps SET
         step_order = COALESCE($3, step_order),
         channel = $4, purpose = $5, skeleton_text = $6, default_delay_days = $7
       WHERE id = $2 AND campaign_id = $1 RETURNING *`,
      [req.params.id, req.params.stepId, step_order ?? null, channel || null,
       purpose || null, skeleton_text || null, default_delay_days ?? null]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[PUT /campaigns/:id/steps/:stepId]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /campaigns/:id/reorder  { order: [stepId, ...] }
// Renumber a campaign's template steps to the given id order (step_order = 1..N). The order
// array must list exactly this campaign's step ids. Atomic; returns the steps in the new order.
// Mirrors POST /person-campaigns/:id/reorder (runs.js) for the contact-side run.
router.post('/:id/reorder', async (req, res) => {
  const client = await pool.connect();
  try {
    const campaignId = Number(req.params.id);
    const order = Array.isArray(req.body?.order) ? req.body.order.map(Number) : null;
    if (!order || !order.length) return res.status(400).json({ error: 'order (array of step ids) required' });

    await client.query('BEGIN');
    const existing = await client.query(
      'SELECT id FROM campaign_steps WHERE campaign_id = $1', [campaignId]
    );
    const ids = new Set(existing.rows.map((r) => r.id));
    const sameSet = order.length === ids.size && order.every((id) => ids.has(id));
    if (!sameSet) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: "order must list exactly this campaign's step ids" });
    }
    for (let i = 0; i < order.length; i++) {
      await client.query(
        'UPDATE campaign_steps SET step_order = $2 WHERE id = $1 AND campaign_id = $3',
        [order[i], i + 1, campaignId]
      );
    }
    const rows = await client.query(
      'SELECT * FROM campaign_steps WHERE campaign_id = $1 ORDER BY step_order', [campaignId]
    );
    await client.query('COMMIT');
    res.json(rows.rows);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[POST /campaigns/:id/reorder]', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// DELETE /campaigns/:id/steps/:stepId
router.delete('/:id/steps/:stepId', async (req, res) => {
  try {
    const result = await query(
      'DELETE FROM campaign_steps WHERE id = $2 AND campaign_id = $1 RETURNING id',
      [req.params.id, req.params.stepId]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'not found' });
    res.json({ deleted: result.rows[0].id });
  } catch (err) {
    console.error('[DELETE step]', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
