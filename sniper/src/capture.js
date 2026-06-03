// Ingest pipeline shared by POST /capture and the inbox file-watcher.
// persist raw -> deterministic parse -> photo -> AI -> upsert as staged.
import { mkdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { query } from './db.js';
import { parseProfile } from './parse.js';
import { synthesize } from './ai.js';

const ROOT = resolve(import.meta.dirname, '..');
const MEDIA_DIR = resolveDir(process.env.MEDIA_DIR || './media');
const RAW_DIR = resolveDir(process.env.RAW_DIR || './raw');

function resolveDir(p) {
  const dir = isAbsolute(p) ? p : join(ROOT, p);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// Write a data: URL (or bare base64) to MEDIA_DIR/{slug}.jpg, return relative path.
function savePhotoFromDataUrl(slug, photo) {
  if (!photo) return null;
  const m = String(photo).match(/^data:(image\/\w+);base64,(.*)$/s);
  const b64 = m ? m[2] : photo;
  if (!b64) return null;
  try {
    const buf = Buffer.from(b64, 'base64');
    if (!buf.length) return null;
    writeFileSync(join(MEDIA_DIR, `${slug}.jpg`), buf);
    return `${slug}.jpg`;
  } catch (err) {
    console.warn(`[capture] photo (data-url) save failed for ${slug}: ${err.message}`);
    return null;
  }
}

// Download the profile photo from the licdn CDN URL parsed out of the HTML.
// Server-side fetch of a public CDN image is fine (it's not LinkedIn profile HTML).
async function savePhotoFromUrl(slug, url) {
  if (!url) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) return null;
    writeFileSync(join(MEDIA_DIR, `${slug}.jpg`), buf);
    return `${slug}.jpg`;
  } catch (err) {
    console.warn(`[capture] photo (url) download failed for ${slug}: ${err.message}`);
    return null;
  }
}

// Prefer the extension's data-URL (exact image the human saw); fall back to
// downloading the parsed licdn URL when the data-URL is missing/CORS-tainted.
async function savePhoto(slug, dataUrl, photoUrl) {
  return savePhotoFromDataUrl(slug, dataUrl) || (await savePhotoFromUrl(slug, photoUrl));
}

/**
 * Process one capture payload. Idempotent on linkedin_slug.
 * On recapture, refreshes deterministic fields + raw HTML only; never touches
 * ai_summary, ai_ins, my_notes, import_status, type, company_id.
 * @returns {object} the upserted people row
 */
export async function ingest(payload) {
  const fields = parseProfile(payload);
  const slug = fields.linkedin_slug;
  if (!slug) throw new Error('could not derive linkedin_slug from url');

  // 1. Persist raw HTML to disk first (re-parsing never needs recapture).
  let rawPath = null;
  try {
    rawPath = `${slug}.html`;
    writeFileSync(join(RAW_DIR, rawPath), payload.html || '');
  } catch (err) {
    console.warn(`[capture] raw save failed for ${slug}: ${err.message}`);
    rawPath = null;
  }

  // 2. Photo: extension data-URL if present, else download the parsed licdn URL.
  const photoPath = await savePhoto(slug, payload.photo, fields.photo_url);

  // Does the row already exist? (decides whether this is a fresh capture)
  const existing = await query('SELECT id FROM people WHERE linkedin_slug = $1', [slug]);
  const isNew = existing.rowCount === 0;

  const capturedAt = payload.captured_at || new Date().toISOString();

  // 4. Upsert. ON CONFLICT updates deterministic columns ONLY.
  const sql = `
    INSERT INTO people (
      linkedin_slug, linkedin_url, company_id, type, priority, my_notes,
      name, title, location, about,
      current_company, current_title, current_tenure, previous_title, previous_company,
      photo_path, ai_summary, ai_ins, raw_html, import_status, captured_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6,
      $7, $8, $9, $10,
      $11, $12, $13, $14, $15,
      $16, NULL, NULL, $17, 'staged', $18
    )
    ON CONFLICT (linkedin_slug) DO UPDATE SET
      linkedin_url     = EXCLUDED.linkedin_url,
      name             = EXCLUDED.name,
      title            = EXCLUDED.title,
      location         = EXCLUDED.location,
      about            = EXCLUDED.about,
      current_company  = EXCLUDED.current_company,
      current_title    = EXCLUDED.current_title,
      current_tenure   = EXCLUDED.current_tenure,
      previous_title   = EXCLUDED.previous_title,
      previous_company = EXCLUDED.previous_company,
      photo_path       = COALESCE(EXCLUDED.photo_path, people.photo_path),
      raw_html         = EXCLUDED.raw_html,
      captured_at      = EXCLUDED.captured_at
    RETURNING *;
  `;

  const values = [
    slug, payload.url || null, payload.company_id ?? null, payload.type || null, payload.priority ?? null, payload.my_notes ?? null,
    fields.name, fields.title, fields.location, fields.about,
    fields.current_company, fields.current_title, fields.current_tenure, fields.previous_title, fields.previous_company,
    photoPath, rawPath, capturedAt,
  ];

  const result = await query(sql, values);
  const row = result.rows[0];
  console.log(`[capture] ${isNew ? 'created' : 'updated'} ${slug} (id=${row.id})`);

  // Fire-and-forget AI synthesis: caller gets the staged row immediately; AI text
  // lands a bit later. Only on first capture (recapture preserves existing notes).
  if (isNew) enrich(row.id, payload.type || 'peer', fields);

  return row;
}

// Background enrichment — runs after the HTTP response is already sent.
// The `ai_summary IS NULL` guard avoids clobbering anything Doug edited meanwhile.
async function enrich(id, type, fields) {
  try {
    const ai = await synthesize(type, fields);
    await query(
      'UPDATE people SET ai_summary = $2, ai_ins = $3 WHERE id = $1 AND ai_summary IS NULL',
      [id, ai.summary, ai.ins]
    );
    console.log(`[capture] enriched id=${id} (summary ${ai.summary.length}c, ins ${ai.ins.length}c)`);
  } catch (err) {
    console.error(`[capture] enrich failed for id=${id}: ${err.message}`);
  }
}
