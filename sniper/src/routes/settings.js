import { Router } from 'express';
import { getAllSettings, setSetting } from '../settings.js';

const router = Router();

// GET /settings -> { ai_provider, ... }
router.get('/', async (_req, res) => {
  try {
    res.json(await getAllSettings());
  } catch (err) {
    console.error('[GET /settings]', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /settings  { ai_provider? } — set one or more known settings.
router.put('/', async (req, res) => {
  try {
    const body = req.body || {};
    const updates = {};
    for (const [key, value] of Object.entries(body)) {
      updates[key] = await setSetting(key, value);
    }
    res.json(updates);
  } catch (err) {
    console.error('[PUT /settings]', err);
    res.status(400).json({ error: err.message });
  }
});

export default router;
