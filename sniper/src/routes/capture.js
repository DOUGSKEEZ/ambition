import { Router } from 'express';
import { ingest } from '../capture.js';

const router = Router();

// POST /capture — accept a capture payload, run the pipeline, return the staged row.
router.post('/', async (req, res) => {
  try {
    const payload = req.body;
    if (!payload || !payload.url) {
      return res.status(400).json({ error: 'missing url in payload' });
    }
    const row = await ingest(payload);
    res.status(201).json(row);
  } catch (err) {
    console.error('[POST /capture]', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
