// The shared fetch + filter + diff core. BOTH the scheduled pipeline (pipeline.js) and the UI's
// "Refresh now" button (POST /api/refresh) call runTracker(), so they always agree. The tracker
// updates posting state (open/closed) and writes diff events — it NEVER touches the application
// columns (applied_at/last_applied_at/application_count); only the apply API does.
import { SOURCES, getSource, reapplyCooldownDays } from './sources.js';
import { getProvider } from './providers/index.js';
import { query, withTransaction } from './db.js';
import { getQuotaStatuses } from './quota.js';

const REAPPLY_SOFT_DAYS = Number(process.env.REAPPLY_SOFT_DAYS) || 7;

const norm = (s) => String(s ?? '').toLowerCase();

// Does the job have a group satisfying this rule entry? `id`/`name` may be a single value OR an array
// — an array matches if ANY of its values do (OR within the entry). `type` optionally scopes which
// groups count. name match is case-insensitive substring.
function jobHasGroup(job, req) {
  const ids = req.id != null ? [].concat(req.id) : null;
  const names = req.name != null ? [].concat(req.name) : null;
  return (job.groups || []).some((g) => {
    if (req.type && g.type !== req.type) return false;
    if (ids) return ids.some((id) => String(g.id) === String(id));
    if (names) return names.some((n) => norm(g.name).includes(norm(n)));
    return true;
  });
}

// Does a normalized job satisfy a source's filter? AND across rule types; see sources.js for the
// per-rule semantics. A missing/empty rule is treated as "no constraint" (passes).
export function matchesFilter(job, filter = {}) {
  const title = norm(job.title);
  const { titleContains, titleExcludes, requireGroups, excludeGroups } = filter;

  if (Array.isArray(titleContains) && titleContains.length) {
    if (!titleContains.some((t) => title.includes(norm(t)))) return false;
  }

  // titleExcludes: reject if the title contains ANY of these (case-insensitive). Used to cast a wide
  // net on a department but drop known-irrelevant titles (e.g. xAI Sales minus "Client Partner").
  if (Array.isArray(titleExcludes) && titleExcludes.length) {
    if (titleExcludes.some((t) => title.includes(norm(t)))) return false;
  }

  // requireGroups: each entry must match at least one of the job's groups (entries AND together).
  if (Array.isArray(requireGroups) && requireGroups.length) {
    if (!requireGroups.every((req) => jobHasGroup(job, req))) return false;
  }

  // excludeGroups: reject if the job matches ANY entry. Used to scope a title net negatively — e.g.
  // Databricks AE roles minus the international offices (no country field on Greenhouse offices).
  if (Array.isArray(excludeGroups) && excludeGroups.length) {
    if (excludeGroups.some((req) => jobHasGroup(job, req))) return false;
  }

  return true;
}

// A compact view of a posting for the summary/email/UI.
const toEntry = (row) => ({
  id: row.id, source: row.source, job_id: row.job_id,
  title: row.title, url: row.url, location: row.location,
});

// Diff one source against the DB inside a transaction. Returns {opened, reopened, closed} entries.
async function diffSource(client, source, matched) {
  const opened = [];
  const reopened = [];
  const closed = [];
  const seenIds = [];

  for (const job of matched) {
    seenIds.push(job.jobId);
    // Upsert. To tell new vs reopened vs plain-still-open, a CTE reads the row's PRE-update state
    // (CTEs see the table snapshot from before the statement's own writes): no existing row =>
    // inserted/opened; existing row with closed_at set => reopened; else an unchanged open refresh.
    const r = await client.query(
      `WITH existing AS (
         SELECT closed_at FROM job_postings WHERE source = $1 AND job_id = $2
       ),
       ups AS (
         INSERT INTO job_postings (source, job_id, title, url, location, groups, raw, company, last_seen_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, NOW())
         ON CONFLICT (source, job_id) DO UPDATE
           SET title = EXCLUDED.title, url = EXCLUDED.url, location = EXCLUDED.location,
               groups = EXCLUDED.groups, raw = EXCLUDED.raw, company = EXCLUDED.company,
               last_seen_at = NOW(), closed_at = NULL
         RETURNING id, source, job_id, title, url, location
       )
       SELECT ups.*,
              (SELECT COUNT(*) FROM existing) = 0 AS inserted,
              COALESCE((SELECT closed_at FROM existing) IS NOT NULL, FALSE) AS was_closed
       FROM ups`,
      [source.key, job.jobId, job.title, job.url, job.location,
       JSON.stringify(job.groups || []), JSON.stringify(job.raw || {}), source.label]
    );
    const row = r.rows[0];
    if (row.inserted) opened.push(toEntry(row));
    else if (row.was_closed) reopened.push(toEntry(row));
  }

  // Close anything from this source that was open but is no longer in the matched set. Closed
  // entries also carry the application state: a role that closes AFTER you applied is a soft
  // rejection (nobody's reading that resume anymore), and the digest calls those out separately.
  const closeRes = await client.query(
    `UPDATE job_postings
       SET closed_at = NOW()
     WHERE source = $1 AND closed_at IS NULL AND NOT (job_id = ANY($2::text[]))
     RETURNING id, source, job_id, title, url, location,
               (applied_at IS NOT NULL) AS had_applied,
               CASE WHEN last_applied_at IS NULL THEN NULL
                    ELSE FLOOR(EXTRACT(EPOCH FROM (NOW() - last_applied_at)) / 86400)::int
               END AS days_since_applied`,
    [source.key, seenIds]
  );
  for (const row of closeRes.rows) {
    closed.push({ ...toEntry(row), had_applied: row.had_applied, days_since_applied: row.days_since_applied });
  }

  // Record the diff events.
  for (const e of opened) await insertEvent(client, e, 'opened');
  for (const e of reopened) await insertEvent(client, e, 'reopened');
  for (const e of closed) await insertEvent(client, e, 'closed');

  return { opened, reopened, closed };
}

function insertEvent(client, entry, type) {
  return client.query(
    `INSERT INTO uav_events (posting_id, source, job_id, title, url, location, event_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [entry.id, entry.source, entry.job_id, entry.title, entry.url, entry.location, type]
  );
}

// Run the tracker over all (or a subset of) sources. Each source is fetched + diffed independently:
// a fetch failure records an error and SKIPS that source's diff entirely — critically, a transient
// outage must never be read as "every role closed". Returns a summary the caller can email/render.
export async function runTracker({ sourceKeys } = {}) {
  const sources = sourceKeys?.length ? sourceKeys.map(getSource).filter(Boolean) : SOURCES;
  const summary = { opened: [], reopened: [], closed: [], dueForReapply: [], errors: [] };

  for (const source of sources) {
    let matched;
    try {
      const jobs = await getProvider(source.provider).fetchJobs(source);
      matched = jobs.filter((j) => matchesFilter(j, source.filter));
    } catch (err) {
      console.error(`[uav] fetch failed for ${source.key}:`, err?.message);
      summary.errors.push({ source: source.key, message: err?.message || String(err) });
      continue; // skip diff — leave this source's postings untouched
    }
    try {
      const r = await withTransaction((client) => diffSource(client, source, matched));
      summary.opened.push(...r.opened);
      summary.reopened.push(...r.reopened);
      summary.closed.push(...r.closed);
    } catch (err) {
      console.error(`[uav] diff failed for ${source.key}:`, err?.message);
      summary.errors.push({ source: source.key, message: err?.message || String(err) });
    }
  }

  summary.dueForReapply = await findDueForReapply();
  summary.counts = {
    opened: summary.opened.length, reopened: summary.reopened.length,
    closed: summary.closed.length, dueForReapply: summary.dueForReapply.length,
  };
  return summary;
}

// Open + applied + still-ACTIVE postings whose last application is older than the re-apply
// threshold — the daily nudge. Set-aside roles (rejected / not_interested) are excluded: a
// rejection means "stop", not "reapply harder". The threshold is per-company: a source with a
// reapply cooldown (see reapplyCooldownDays — OpenAI 180d, Google 30d) uses that instead of the
// global soft cadence. And while a company's application quota is FULL, its roles are suppressed
// entirely — you couldn't submit a new application anyway.
async function findDueForReapply() {
  const r = await query(
    `SELECT id, source, job_id, title, url, location,
            FLOOR(EXTRACT(EPOCH FROM (NOW() - last_applied_at)) / 86400)::int AS days_since_applied
       FROM job_postings
      WHERE closed_at IS NULL AND disposition = 'active' AND last_applied_at IS NOT NULL
        AND last_applied_at < NOW() - make_interval(days => $1::int)
      ORDER BY last_applied_at ASC`,
    [REAPPLY_SOFT_DAYS]
  );
  const quotaFull = new Set((await getQuotaStatuses()).filter((q) => q.full).map((q) => q.source));
  return r.rows.filter((row) => {
    const cooldown = reapplyCooldownDays(getSource(row.source)) ?? REAPPLY_SOFT_DAYS;
    return row.days_since_applied >= cooldown && !quotaFull.has(row.source);
  });
}
