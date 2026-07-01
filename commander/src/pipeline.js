// The scheduled entry point (systemd user timer, ~07:15). Runs the full refresh: fetch + store every
// feed, regenerate the per-feed digest lines, then regenerate the SITREPs (campaign-wide + per
// company). UI-only for v1 — no email; the UI reads the freshly-stored rows. Best-effort throughout:
// a failing feed or a down LLM is logged and skipped, never fatal.
import 'dotenv/config';
import { runTracker } from './tracker.js';
import { regenerateDigests, regenerateAllSitreps } from './generate.js';
import { pool } from './db.js';

async function run() {
  console.log('[commander] pipeline start');
  const summary = await runTracker();
  console.log(`[commander] fetch done: ${summary.added} new item(s), ${summary.errors.length} feed error(s)`);

  console.log('[commander] regenerating feed digests…');
  await regenerateDigests();

  console.log('[commander] regenerating SITREPs…');
  await regenerateAllSitreps();

  console.log('[commander] pipeline done');
  await pool.end();
  return summary;
}

run().catch(async (err) => {
  console.error('[commander] pipeline failed:', err.message);
  try { await pool.end(); } catch { /* ignore */ }
  process.exit(1);
});
