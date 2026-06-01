import { Router } from 'express';
import { query } from '../db.js';
import { generateDraft } from '../draft.js';

const router = Router();

// POST /draft  { person_id, step_id, provider? }
// Assembles the context package from live data and returns draft text. Does NOT persist —
// the UI drops the result into customized_text for Doug to refine, then saves via the step PUT.
router.post('/', async (req, res) => {
  try {
    const { person_id, step_id, provider } = req.body || {};
    if (!person_id || !step_id) return res.status(400).json({ error: 'person_id and step_id required' });

    const p = await query(
      `SELECT p.*, c.name AS company_name
       FROM people p LEFT JOIN companies c ON c.id = p.company_id WHERE p.id = $1`,
      [person_id]
    );
    if (!p.rowCount) return res.status(404).json({ error: 'person not found' });

    const s = await query(
      `SELECT pcs.*, pc.campaign_id, cam.goal AS campaign_goal
       FROM person_campaign_steps pcs
       JOIN person_campaigns pc ON pc.id = pcs.person_campaign_id
       LEFT JOIN campaigns cam ON cam.id = pc.campaign_id
       WHERE pcs.id = $1`,
      [step_id]
    );
    if (!s.rowCount) return res.status(404).json({ error: 'step not found' });
    const step = s.rows[0];

    const { text, provider: used } = await generateDraft({
      person: p.rows[0],
      step,
      goal: step.campaign_goal,
      provider,
    });
    res.json({ text, provider: used });
  } catch (err) {
    console.error('[POST /draft]', err);
    res.status(502).json({ error: err.message });
  }
});

export default router;
