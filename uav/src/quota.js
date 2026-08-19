// Shared application-quota computation for rate-limited companies — sources that declare
// `appLimit: {max, windowDays}` (Google 3/30d, OpenAI 5/180d). Used by GET /api/quota (the header
// badges) AND by the tracker's due-for-reapply list (a full quota means you can't apply right now,
// so a reapply nudge would be noise). We count applications by each role's curated applied date —
// job_postings.last_applied_at, the date shown/edited on the card — NOT the uav_events timestamp,
// which records when you clicked "Mark applied" and can lag the real submission date you back-dated
// via the picker. One applied role = one application (re-applies to the same role aren't separately
// counted). Then we work out when headroom returns:
//   • nextSlotInDays    — days until `used` drops below `max` (when you can apply again). 0 if not full.
//   • oldestFreesInDays — days until the oldest in-window application ages out (when used drops by 1).
import { SOURCES } from './sources.js';
import { query } from './db.js';

export async function getQuotaStatuses() {
  const limited = SOURCES.filter((s) => s.appLimit && s.appLimit.max > 0 && s.appLimit.windowDays > 0);
  const dayMs = 86400000;
  const now = Date.now();
  return Promise.all(limited.map(async (s) => {
    const { max, windowDays } = s.appLimit;
    const winMs = windowDays * dayMs;
    // Ascending applied dates (ms) inside the window, from the curated per-role date.
    const r = await query(
      `SELECT EXTRACT(EPOCH FROM last_applied_at) * 1000 AS ts
         FROM job_postings
        WHERE source = $1 AND last_applied_at IS NOT NULL
          AND last_applied_at > NOW() - make_interval(days => $2)
        ORDER BY last_applied_at ASC`,
      [s.key, windowDays]
    );
    const ts = r.rows.map((x) => Number(x.ts));
    const used = ts.length;
    const remaining = Math.max(0, max - used);
    const full = used >= max;
    // When full, the (used-max)-th oldest event's expiry is what brings you back under the cap.
    const nextSlotInDays = full
      ? Math.max(0, Math.ceil((ts[used - max] + winMs - now) / dayMs))
      : 0;
    const oldestFreesInDays = used > 0
      ? Math.max(0, Math.ceil((ts[0] + winMs - now) / dayMs))
      : null;
    return { source: s.key, max, windowDays, used, remaining, full, nextSlotInDays, oldestFreesInDays };
  }));
}
