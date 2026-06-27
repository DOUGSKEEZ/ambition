// CLI entrypoint for the scheduled run (systemd timer, ~7am). Runs the tracker once, then emails a
// digest if anything changed or anything is due for re-apply. Exits non-zero on a hard failure so
// the systemd unit shows `failed`.
import 'dotenv/config';
import { runTracker } from './tracker.js';
import { sendDigest } from './notify.js';
import { pool } from './db.js';

async function run() {
  const summary = await runTracker();
  const { opened, reopened, closed, dueForReapply, errors } = summary;
  console.log(`[uav pipeline] opened=${opened.length} reopened=${reopened.length} closed=${closed.length} dueForReapply=${dueForReapply.length} errors=${errors.length}`);
  if (errors.length) for (const e of errors) console.error(`[uav pipeline]   error: ${e.source}: ${e.message}`);

  // Daily heartbeat: always send the digest so you know the 7am scan ran (empty sections show
  // "None"). The on-demand "Refresh now" button still never emails — only this scheduled run does.
  await sendDigest(summary);
}

run()
  .catch((err) => { console.error('[uav pipeline] failed:', err); process.exitCode = 1; })
  .finally(() => pool.end());
