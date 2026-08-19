// App settings (key/value in the `settings` table). Small in-memory cache so the hot
// capture path doesn't hit Postgres on every synthesis; writes update the cache too.
import { query } from './db.js';

const ALLOWED = {
  ai_provider: { values: ['local', 'anthropic'], default: 'local' },
};

const cache = new Map();

export async function getSetting(key) {
  if (cache.has(key)) return cache.get(key);
  const { rows } = await query('SELECT value FROM settings WHERE key = $1', [key]);
  const value = rows[0]?.value ?? ALLOWED[key]?.default ?? null;
  cache.set(key, value);
  return value;
}

export async function setSetting(key, value) {
  const spec = ALLOWED[key];
  if (!spec) throw new Error(`unknown setting: ${key}`);
  if (!spec.values.includes(value)) {
    throw new Error(`invalid value for ${key}: ${value} (allowed: ${spec.values.join(', ')})`);
  }
  await query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, value]
  );
  cache.set(key, value);
  return value;
}

// Current values for every known setting (filling in defaults), for the Settings UI.
export async function getAllSettings() {
  const out = {};
  for (const key of Object.keys(ALLOWED)) out[key] = await getSetting(key);
  return out;
}
