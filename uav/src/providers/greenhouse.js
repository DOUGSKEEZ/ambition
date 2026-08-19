// Greenhouse job-board adapter. Anthropic (and many others) publish their board at
// boards-api.greenhouse.io/v1/boards/<token>/jobs?content=true — a single JSON response,
// no pagination. Normalizes each job into the common shape the tracker/UI consume.

const FETCH_TIMEOUT_MS = 15000;

// Map a Greenhouse job into a normalized posting. departments/offices each carry {id,name} —
// we keep both as `groups` so filters can match by the numeric id (exact) or the name.
function normalize(job, source) {
  const groups = [];
  for (const d of job.departments || []) groups.push({ type: 'department', id: d.id, name: d.name });
  for (const o of job.offices || []) groups.push({ type: 'office', id: o.id, name: o.name });
  // Surface a `remote` group when "remote" shows up anywhere in the job's location/office text, so
  // the UI can tag remote-friendly roles. Greenhouse has no structured remote flag.
  const remote = /remote/i.test(job.location?.name || '')
    || (job.offices || []).some((o) => /remote/i.test(o.name || ''));
  if (remote) groups.push({ type: 'remote', name: 'remote' });
  return {
    jobId: String(job.id),
    title: job.title || '',
    // Some companies (Scale) serve postings on their own domain at <jobUrlBase>/<id>; the hosted
    // job-boards.greenhouse.io absolute_url still works, but the native page is the better link.
    url: source.jobUrlBase ? `${source.jobUrlBase}/${job.id}` : (job.absolute_url || null),
    location: job.location?.name || null,
    groups,
    raw: job,
  };
}

// Fetch + normalize every job for a Greenhouse source. Bounded by a timeout; throws on
// non-2xx/timeout so the tracker can record the error and skip this source's diff.
export async function fetchJobs(source) {
  const url = source.endpoint || `https://boards-api.greenhouse.io/v1/boards/${source.board}/jobs?content=true`;
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  const body = await res.json();
  const jobs = Array.isArray(body?.jobs) ? body.jobs : [];
  return jobs.map((job) => normalize(job, source));
}
