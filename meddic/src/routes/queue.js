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
      `SELECT p.id, p.name, p.title, p.type, p.photo_path, p.hot_cold, p.emoji, p.staged,
              p.label, p.next_action_date, p.last_action_at, p.company_id, c.name AS company_name,
              pc.id AS run_id, pc.campaign_id, pc.current_step, cam.name AS campaign_name,
              (p.next_action_date IS NULL OR p.next_action_date <= CURRENT_DATE) AS due,
              (p.last_action_at IS NOT NULL AND p.last_action_at < (NOW() - ($1 || ' days')::interval)) AS going_cold,
              ns.step_order AS next_step_order, ns.channel AS next_step_channel,
              ns.purpose AS next_step_purpose,
              EXISTS (
                SELECT 1 FROM person_campaign_steps s
                JOIN person_campaigns pcr ON pcr.id = s.person_campaign_id
                WHERE pcr.person_id = p.id AND s.response_received
              ) AS has_reply
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
       ORDER BY CASE p.hot_cold WHEN 'hot' THEN 0 WHEN 'warm' THEN 1 WHEN 'cold' THEN 2 ELSE 3 END,
                p.next_action_date NULLS LAST`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[GET /queue]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /queue/done?company_id= — Today recap: every step marked sent TODAY, newest first.
// One row per send (a contact touched twice today shows twice) so it reads as an activity log.
router.get('/done', async (req, res) => {
  try {
    const { company_id } = req.query;
    const params = [];
    let companyFilter = '';
    if (company_id) { params.push(company_id); companyFilter = `AND p.company_id = $${params.length}`; }

    const result = await query(
      `SELECT s.id AS step_id, s.step_order, s.channel, s.purpose, s.sent_at, s.response_received,
              p.id, p.name, p.type, p.photo_path, p.label, p.hot_cold, p.next_action_date,
              c.name AS company_name, cam.name AS campaign_name
       FROM person_campaign_steps s
       JOIN person_campaigns pc ON pc.id = s.person_campaign_id
       JOIN people p ON p.id = pc.person_id
       JOIN companies c ON c.id = p.company_id
       LEFT JOIN campaigns cam ON cam.id = pc.campaign_id
       WHERE s.sent = TRUE AND s.sent_at::date = CURRENT_DATE
         AND p.import_status = 'active'
         ${companyFilter}
       ORDER BY s.sent_at DESC`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[GET /queue/done]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /queue/week?company_id= — the "Tomorrow" view: active contacts whose next action
// falls from tomorrow through the end of the upcoming work week (the first Friday on or
// after tomorrow). Today's due items live in /queue; this is everything queued just ahead.
// Returns { start, end, rows } so the UI can label the window.
router.get('/week', async (req, res) => {
  try {
    const { company_id } = req.query;
    // Window bounds, computed by the DB so they track CURRENT_DATE like the Today queue.
    // end = first Friday (ISODOW 5) on or after tomorrow.
    const b = await query(
      `SELECT (CURRENT_DATE + 1)::text AS start_d,
              ((CURRENT_DATE + 1)
                + (((5 - EXTRACT(ISODOW FROM (CURRENT_DATE + 1))::int) % 7 + 7) % 7))::text AS end_d`
    );
    const { start_d, end_d } = b.rows[0];
    const params = [start_d, end_d];
    let companyFilter = '';
    if (company_id) { params.push(company_id); companyFilter = `AND p.company_id = $${params.length}`; }

    const result = await query(
      `SELECT p.id, p.name, p.title, p.type, p.photo_path, p.hot_cold, p.emoji, p.staged,
              p.label, p.next_action_date, p.company_id, c.name AS company_name,
              pc.current_step, cam.name AS campaign_name,
              ns.step_order AS next_step_order, ns.channel AS next_step_channel,
              ns.purpose AS next_step_purpose,
              EXISTS (
                SELECT 1 FROM person_campaign_steps s
                JOIN person_campaigns pcr ON pcr.id = s.person_campaign_id
                WHERE pcr.person_id = p.id AND s.response_received
              ) AS has_reply
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
         AND p.next_action_date >= $1 AND p.next_action_date <= $2
         ${companyFilter}
       ORDER BY p.next_action_date,
                CASE p.hot_cold WHEN 'hot' THEN 0 WHEN 'warm' THEN 1 WHEN 'cold' THEN 2 ELSE 3 END`,
      params
    );
    res.json({ start: start_d, end: end_d, rows: result.rows });
  } catch (err) {
    console.error('[GET /queue/week]', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
