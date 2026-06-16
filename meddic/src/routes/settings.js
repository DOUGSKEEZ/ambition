import { Router } from 'express';
import { query } from '../db.js';
import { PROMPT_SECTIONS, sectionDefault } from '../prompt.js';

const router = Router();

// GET /settings/prompt — every drafting-prompt section with its default text, the
// saved override (if any), and the effective text the model actually sees. The UI
// modal renders one textarea per section from this.
router.get('/prompt', async (_req, res) => {
  try {
    const saved = {};
    try {
      const r = await query('SELECT key, body FROM prompt_overrides');
      for (const row of r.rows) saved[row.key] = row.body;
    } catch (err) {
      // Table not migrated yet — fall back to defaults rather than 500.
      console.warn('[GET /settings/prompt] no overrides table:', err.message);
    }
    const sections = PROMPT_SECTIONS.map((s) => {
      const def = sectionDefault(s.key);
      const override = saved[s.key] ?? null;
      const overridden = !!(override && override.trim());
      return {
        key: s.key,
        label: s.label,
        primary: !!s.primary,
        help: s.help || '',
        default: def,
        override,
        overridden,
        effective: overridden ? override : def,
      };
    });
    res.json({ sections });
  } catch (err) {
    console.error('[GET /settings/prompt]', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /settings/prompt/:key — save (or, with a blank body, reset to default) one
// section. An empty/whitespace body deletes the override so the code default is used.
router.put('/prompt/:key', async (req, res) => {
  try {
    const { key } = req.params;
    if (!PROMPT_SECTIONS.some((s) => s.key === key)) {
      return res.status(404).json({ error: `unknown prompt section: ${key}` });
    }
    const body = typeof req.body?.body === 'string' ? req.body.body : '';
    if (!body.trim()) {
      await query('DELETE FROM prompt_overrides WHERE key = $1', [key]);
      return res.json({ key, overridden: false, effective: sectionDefault(key) });
    }
    await query(
      `INSERT INTO prompt_overrides (key, body) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET body = EXCLUDED.body`,
      [key, body],
    );
    res.json({ key, overridden: true, effective: body });
  } catch (err) {
    console.error('[PUT /settings/prompt/:key]', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
