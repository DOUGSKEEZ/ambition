import { Router } from 'express';
import { query } from '../db.js';

const router = Router();

// GET /companies — the shared companies table, with a count of active contacts so the
// picker can show where the work is (mirrors Medic's picker for a consistent feel).
router.get('/', async (_req, res) => {
  try {
    const result = await query(
      `SELECT c.id, c.name,
              COUNT(p.id) FILTER (WHERE p.import_status = 'active' AND p.status = 'active')::int AS active_contacts
       FROM companies c
       LEFT JOIN people p ON p.company_id = c.id
       GROUP BY c.id
       ORDER BY c.name`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[GET /companies]', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
