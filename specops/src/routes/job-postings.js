import { Router } from 'express';
import { query } from '../db.js';

const router = Router();

// GET /job-postings?company_id=<id> — open, not-yet-linked UAV postings for a company. Reads UAV's
// job_postings (shared DB, cross-app read) and maps company → postings via the denormalized label
// (job_postings.company = SOURCES[].label) matched to companies.name. Powers the SpecOps "Link UAV
// posting" picker, so it excludes closed postings and any already linked to an opportunity.
router.get('/', async (req, res) => {
  try {
    const companyId = Number.parseInt(req.query.company_id, 10);
    if (!Number.isInteger(companyId)) return res.status(400).json({ error: 'company_id is required' });
    const r = await query(
      `SELECT jp.id, jp.title, jp.url, jp.location, jp.source
         FROM job_postings jp
         JOIN companies c ON c.id = $1 AND lower(jp.company) = lower(c.name)
        WHERE jp.closed_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM opportunities o WHERE o.job_posting_id = jp.id)
        ORDER BY jp.title`,
      [companyId]
    );
    res.json(r.rows);
  } catch (err) {
    console.error('[GET /job-postings]', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
