import pg from 'pg';

const { Pool } = pg;

// Connects to the shared Sniper database. Commander OWNS feed_items + feed_digests + company_intel +
// sitreps, and READS the other apps' tables (people/opportunities/job_postings) for the SITREP
// rollup — it never writes them.
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

// Run fn inside a transaction with a dedicated client (BEGIN/COMMIT, ROLLBACK on throw).
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
