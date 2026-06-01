import pg from 'pg';

const { Pool } = pg;

// Connects to the shared Sniper database (companies + people live here; meddic owns
// the campaign tables and the people tracker columns).
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
