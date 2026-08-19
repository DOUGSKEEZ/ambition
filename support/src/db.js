import pg from 'pg';

const { Pool } = pg;

// Connects to the shared Sniper database. Support OWNS network_people, and READS
// people + companies (linked by linkedin_slug for name/title/photo/company) — it
// never writes them. Sniper's ingest is the one outside writer of network_people
// (the extension's "→ Support" capture inserts membership rows).
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('[db] unexpected idle client error', err);
});

export function query(text, params) {
  return pool.query(text, params);
}

// Run fn inside a transaction — used by the board reorder, which rewrites a whole column's
// sort_order and must not leave it half-renumbered if one statement fails.
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
