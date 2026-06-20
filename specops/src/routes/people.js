import { Router } from 'express';
import { query } from '../db.js';

const router = Router();

// GET /people?company_id=<int> — contacts to attach to an opportunity as target HMs/recruiters.
// Returns a company's non-rejected contacts (a guessed HM might be staged or cold-stored, so we
// don't restrict to active). Ordered hiring managers first, then by name.
router.get('/', async (req, res) => {
  try {
    const params = [];
    const where = ["p.import_status <> 'rejected'"];
    const companyId = Number.parseInt(req.query.company_id, 10);
    if (Number.isInteger(companyId)) { params.push(companyId); where.push(`p.company_id = $${params.length}`); }

    const result = await query(
      `SELECT p.id, p.name, p.title, p.type, p.photo_path, p.label, p.company_id, c.name AS company_name
       FROM people p
       JOIN companies c ON c.id = p.company_id
       WHERE ${where.join(' AND ')}
       ORDER BY CASE p.type WHEN 'hiring_manager' THEN 0 WHEN 'recruiter' THEN 1 ELSE 2 END, p.name`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[GET /people]', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
