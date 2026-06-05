import { Router } from 'express';
import { query } from '../db.js';

const router = Router();

// GET /queue?company_id= — the Today work queue: active contacts for the company whose
// next_action_date is today or overdue (or never set), sorted by priority then hot/cold.
// Each row carries the current step and the next unsent step so Doug can act immediately.
// A "going_cold" flag marks anyone untouched for >= COLD_DAYS.
router.get('/', async (req, res) => {
  try {
    const { company_id } = req.query;
    const coldDays = parseInt(process.env.COLD_DAYS || '7', 10);
    const params = [coldDays];
    let companyFilter = '';
    if (company_id) { params.push(company_id); companyFilter = `AND p.company_id = $${params.length}`; }

    const result = await query(
      `SELECT p.id, p.name, p.title, p.type, p.photo_path, p.hot_cold, p.priority_score,
              p.label, p.next_action_date, p.last_action_at, p.company_id, c.name AS company_name,
              pc.id AS run_id, pc.campaign_id, pc.current_step, cam.name AS campaign_name,
              (p.next_action_date IS NULL OR p.next_action_date <= CURRENT_DATE) AS due,
              (p.last_action_at IS NOT NULL AND p.last_action_at < (NOW() - ($1 || ' days')::interval)) AS going_cold,
              ns.step_order AS next_step_order, ns.channel AS next_step_channel,
              ns.purpose AS next_step_purpose
       FROM people p
       JOIN companies c ON c.id = p.company_id
       LEFT JOIN person_campaigns pc ON pc.person_id = p.id AND pc.status = 'active'
       LEFT JOIN campaigns cam ON cam.id = pc.campaign_id
       LEFT JOIN LATERAL (
         SELECT step_order, channel, purpose
         FROM person_campaign_steps
         WHERE person_campaign_id = pc.id AND sent = FALSE
         ORDER BY step_order LIMIT 1
       ) ns ON TRUE
       WHERE p.import_status = 'active' AND p.status = 'active'
         AND (p.next_action_date IS NULL OR p.next_action_date <= CURRENT_DATE)
         ${companyFilter}
       ORDER BY p.priority_score DESC NULLS LAST,
                CASE p.hot_cold WHEN 'hot' THEN 0 WHEN 'warm' THEN 1 WHEN 'cold' THEN 2 ELSE 3 END,
                p.next_action_date NULLS LAST`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[GET /queue]', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
