import { Router } from 'express';
import { query } from '../db.js';
import { saveCompanyFavicon } from '../favicon.js';

const router = Router();

// GET /companies — list (used by the extension dropdown and the review UI).
router.get('/', async (_req, res) => {
  try {
    const result = await query('SELECT * FROM companies ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    console.error('[GET /companies]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /companies — create (the only place companies are created).
router.post('/', async (req, res) => {
  try {
    const { name, tier, notes, website } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    const result = await query(
      'INSERT INTO companies (name, tier, notes, website) VALUES ($1, $2, $3, $4) RETURNING *',
      [name.trim(), tier || null, notes || null, website || null]
    );
    await saveCompanyFavicon(result.rows[0].id, result.rows[0].website);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'a company with that name already exists' });
    }
    console.error('[POST /companies]', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /companies/:id — update (review UI only).
router.put('/:id', async (req, res) => {
  try {
    const { name, tier, notes, website } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    const result = await query(
      'UPDATE companies SET name = $2, tier = $3, notes = $4, website = $5 WHERE id = $1 RETURNING *',
      [req.params.id, name.trim(), tier || null, notes || null, website || null]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'not found' });
    await saveCompanyFavicon(result.rows[0].id, result.rows[0].website);
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'a company with that name already exists' });
    }
    console.error('[PUT /companies/:id]', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
