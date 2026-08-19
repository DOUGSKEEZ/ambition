// Run all SQL migrations in database/migrations/ in filename order.
import 'dotenv/config';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, '..', 'database', 'migrations');

async function run() {
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    process.stdout.write(`[migrate] applying ${file} ... `);
    await pool.query(sql);
    console.log('ok');
  }
  console.log(`[migrate] done (${files.length} file(s))`);
  await pool.end();
}

run().catch((err) => {
  console.error('[migrate] failed:', err.message);
  process.exit(1);
});
