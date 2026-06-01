import { Router } from 'express';
import { query } from '../db.js';

const router = Router();

// Columns meddic may write. Tracker columns are meddic-owned; my_notes is the shared
// Doug field; ai_summary/ai_ins are Sniper-owned enrichment that Doug can override from
// here (they heavily drive drafting; Sniper recapture preserves them, so edits survive).
const TRACKER_FIELDS = new Set([
  'status', 'hot_cold', 'priority_score', 'next_action_date', 'last_action_at',
  'my_notes', 'ai_summary', 'ai_ins',
]);

// GET /people?company_id=&status=active — roster for a company.
// Joins the person's active run so the roster/queue can show current campaign + step.
router.get('/', async (req, res) => {
  try {
    const { company_id, status } = req.query;
    const where = [];
    const params = [];
    // Only meddic-relevant contacts: those Sniper approved to active.
    where.push("p.import_status = 'active'");
    if (company_id) { params.push(company_id); where.push(`p.company_id = $${params.length}`); }
    if (status) { params.push(status); where.push(`p.status = $${params.length}`); }

    const result = await query(
      `SELECT p.*, c.name AS company_name,
              pc.id AS run_id, pc.campaign_id, pc.current_step, pc.status AS run_status,
              cam.name AS campaign_name
       FROM people p
       LEFT JOIN companies c ON c.id = p.company_id
       LEFT JOIN person_campaigns pc ON pc.person_id = p.id AND pc.status = 'active'
       LEFT JOIN campaigns cam ON cam.id = pc.campaign_id
       WHERE ${where.join(' AND ')}
       ORDER BY p.priority_score DESC NULLS LAST,
                CASE p.hot_cold WHEN 'hot' THEN 0 WHEN 'warm' THEN 1 WHEN 'cold' THEN 2 ELSE 3 END,
                p.name`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[GET /people]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /people/:id — full contact: Sniper context (read-only) + tracker fields + active run w/ steps.
router.get('/:id', async (req, res) => {
  try {
    const p = await query(
      `SELECT p.*, c.name AS company_name
       FROM people p LEFT JOIN companies c ON c.id = p.company_id
       WHERE p.id = $1`,
      [req.params.id]
    );
    if (!p.rowCount) return res.status(404).json({ error: 'not found' });

    const run = await query(
      `SELECT pc.*, cam.name AS campaign_name, cam.goal AS campaign_goal
       FROM person_campaigns pc LEFT JOIN campaigns cam ON cam.id = pc.campaign_id
       WHERE pc.person_id = $1 AND pc.status = 'active'`,
      [req.params.id]
    );
    let activeRun = run.rows[0] || null;
    if (activeRun) {
      const steps = await query(
        'SELECT * FROM person_campaign_steps WHERE person_campaign_id = $1 ORDER BY step_order',
        [activeRun.id]
      );
      activeRun = { ...activeRun, steps: steps.rows };
    }
    res.json({ ...p.rows[0], active_run: activeRun });
  } catch (err) {
    console.error('[GET /people/:id]', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /people/:id — update tracker fields only.
router.put('/:id', async (req, res) => {
  try {
    const updates = Object.entries(req.body || {}).filter(([k]) => TRACKER_FIELDS.has(k));
    if (!updates.length) return res.status(400).json({ error: 'no tracker fields provided' });
    const sets = updates.map(([k], i) => `${k} = $${i + 2}`);
    const values = updates.map(([, v]) => (v === '' ? null : v));
    const result = await query(
      `UPDATE people SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
      [req.params.id, ...values]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[PUT /people/:id]', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /people/:id — permanently remove the contact. WARNING: this is the SAME row
// Sniper owns, and the FK cascade wipes the contact's campaign runs + all drafted/sent
// message history. Archiving (PUT status='inactive') is the reversible alternative; the
// UI surfaces Archive prominently and confirms before allowing this.
router.delete('/:id', async (req, res) => {
  try {
    const result = await query('DELETE FROM people WHERE id = $1 RETURNING id, name', [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'not found' });
    res.json({ deleted: result.rows[0].id });
  } catch (err) {
    console.error('[DELETE /people/:id]', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
