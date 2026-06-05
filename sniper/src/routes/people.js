import { Router } from 'express';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import busboy from 'busboy';
import { query } from '../db.js';
import { synthesize } from '../ai.js';

const router = Router();

const ROOT = resolve(import.meta.dirname, '..', '..');
const resolveDir = (envVal, fallback) => {
  const p = envVal || fallback;
  const dir = isAbsolute(p) ? p : join(ROOT, p);
  mkdirSync(dir, { recursive: true });
  return dir;
};
const MEDIA_DIR = resolveDir(process.env.MEDIA_DIR, './media');
const RAW_DIR = resolveDir(process.env.RAW_DIR, './raw');

// Best-effort removal of a person's on-disk artifacts (photo + raw HTML).
function deletePersonFiles(person) {
  for (const f of [person.photo_path && join(MEDIA_DIR, person.photo_path),
                   person.raw_html && join(RAW_DIR, person.raw_html)]) {
    if (f) { try { rmSync(f, { force: true }); } catch { /* ignore */ } }
  }
}

// Columns the review UI is allowed to PATCH.
const EDITABLE = new Set([
  'name', 'title', 'location', 'email', 'label', 'about',
  'current_company', 'current_title', 'current_tenure', 'previous_title', 'previous_company',
  'ai_summary', 'ai_ins', 'my_notes',
  'type', 'company_id', 'priority',
]);

async function getPerson(id) {
  const r = await query('SELECT * FROM people WHERE id = $1', [id]);
  return r.rows[0] || null;
}

// GET /people?import_status=staged — queue listing with company name joined.
router.get('/', async (req, res) => {
  try {
    const { import_status } = req.query;
    const params = [];
    let where = '';
    if (import_status) {
      params.push(import_status);
      where = 'WHERE p.import_status = $1';
    }
    const result = await query(
      `SELECT p.*, c.name AS company_name
       FROM people p LEFT JOIN companies c ON c.id = p.company_id
       ${where}
       ORDER BY p.captured_at DESC NULLS LAST, p.id DESC`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[GET /people]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /people/:id
router.get('/:id', async (req, res) => {
  try {
    const person = await getPerson(req.params.id);
    if (!person) return res.status(404).json({ error: 'not found' });
    res.json(person);
  } catch (err) {
    console.error('[GET /people/:id]', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /people/:id — update editable fields.
router.patch('/:id', async (req, res) => {
  try {
    const updates = Object.entries(req.body || {}).filter(([k]) => EDITABLE.has(k));
    if (!updates.length) return res.status(400).json({ error: 'no editable fields provided' });

    const sets = updates.map(([k], i) => `${k} = $${i + 2}`);
    const values = updates.map(([, v]) => v);
    const result = await query(
      `UPDATE people SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
      [req.params.id, ...values]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[PATCH /people/:id]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /people/:id/regenerate — re-run the LLM using the current type + fields.
router.post('/:id/regenerate', async (req, res) => {
  try {
    const person = await getPerson(req.params.id);
    if (!person) return res.status(404).json({ error: 'not found' });

    const ai = await synthesize(person.type || 'peer', person);
    const result = await query(
      'UPDATE people SET ai_summary = $2, ai_ins = $3 WHERE id = $1 RETURNING *',
      [person.id, ai.summary, ai.ins]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[POST /people/:id/regenerate]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /people/:id/approve and /reject — status transitions.
function statusRoute(status) {
  return async (req, res) => {
    try {
      const result = await query(
        'UPDATE people SET import_status = $2 WHERE id = $1 RETURNING *',
        [req.params.id, status]
      );
      if (!result.rowCount) return res.status(404).json({ error: 'not found' });
      res.json(result.rows[0]);
    } catch (err) {
      console.error(`[POST /people/:id/${status}]`, err);
      res.status(500).json({ error: err.message });
    }
  };
}
router.post('/:id/approve', statusRoute('active'));
router.post('/:id/reject', statusRoute('rejected'));
router.post('/:id/restage', statusRoute('staged')); // recover a rejected/active/cold-storage contact
router.post('/:id/cold-storage', statusRoute('cold_storage')); // park an off-target contact on ice

// POST /people/bulk-delete  { ids: [..] } — permanently delete contacts + their files.
// Refuses 'active' contacts (deleting one would cascade-wipe its meddic outreach history);
// returns which ids were deleted vs skipped. Must be declared before DELETE /:id.
router.post('/bulk-delete', async (req, res) => {
  try {
    const ids = (req.body?.ids || []).map(Number).filter(Number.isInteger);
    if (!ids.length) return res.status(400).json({ error: 'no ids provided' });

    const rows = (await query('SELECT * FROM people WHERE id = ANY($1)', [ids])).rows;
    const deletable = rows.filter((p) => p.import_status !== 'active');
    const skippedActive = rows.filter((p) => p.import_status === 'active').map((p) => p.id);

    if (deletable.length) {
      await query('DELETE FROM people WHERE id = ANY($1)', [deletable.map((p) => p.id)]);
      deletable.forEach(deletePersonFiles);
    }
    res.json({ deleted: deletable.map((p) => p.id), skipped_active: skippedActive });
  } catch (err) {
    console.error('[POST /people/bulk-delete]', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /people/:id — permanently delete one contact + its files. Refuses 'active'.
router.delete('/:id', async (req, res) => {
  try {
    const person = await getPerson(req.params.id);
    if (!person) return res.status(404).json({ error: 'not found' });
    if (person.import_status === 'active') {
      return res.status(409).json({ error: 'cannot delete an active contact; reject or set inactive first' });
    }
    await query('DELETE FROM people WHERE id = $1', [person.id]);
    deletePersonFiles(person);
    res.json({ deleted: person.id });
  } catch (err) {
    console.error('[DELETE /people/:id]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /people/:id/photo — multipart upload to replace the image.
router.post('/:id/photo', async (req, res) => {
  try {
    const person = await getPerson(req.params.id);
    if (!person) return res.status(404).json({ error: 'not found' });

    const bb = busboy({ headers: req.headers, limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
    const chunks = [];
    let gotFile = false;

    bb.on('file', (_name, stream) => {
      gotFile = true;
      stream.on('data', (d) => chunks.push(d));
    });
    bb.on('error', (err) => {
      console.error('[photo upload] busboy error', err);
      if (!res.headersSent) res.status(500).json({ error: err.message });
    });
    bb.on('close', async () => {
      try {
        if (!gotFile || !chunks.length) return res.status(400).json({ error: 'no file uploaded' });
        const fileName = `${person.linkedin_slug}.jpg`;
        writeFileSync(join(MEDIA_DIR, fileName), Buffer.concat(chunks));
        const result = await query(
          'UPDATE people SET photo_path = $2 WHERE id = $1 RETURNING *',
          [person.id, fileName]
        );
        res.json(result.rows[0]);
      } catch (err) {
        console.error('[photo upload] save error', err);
        if (!res.headersSent) res.status(500).json({ error: err.message });
      }
    });

    req.pipe(bb);
  } catch (err) {
    console.error('[POST /people/:id/photo]', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
