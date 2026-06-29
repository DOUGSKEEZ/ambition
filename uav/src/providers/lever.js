// Lever job-board adapter. Mistral (and others) publish their board at
// api.lever.co/v0/postings/<account>?mode=json — a single JSON response that is a FLAT ARRAY of
// postings (no { jobs: [...] } wrapper, unlike Greenhouse/Ashby). Lever exposes human-readable
// department/team/location NAMES (no numeric ids) plus an ISO-2 country code. Normalizes each
// posting into the common shape the tracker/UI consume.

const FETCH_TIMEOUT_MS = 20000;

// Map a Lever posting into a normalized posting. categories carries department/team/location and an
// allLocations array; we keep each as a `group`. Lever's top-level `country` is an ISO-2 code
// (e.g. "US"), surfaced as a `country` group so sources can scope by country (like Ashby) instead
// of enumerating cities — important here since "SF Bay Area" is tagged location "Palo Alto".
function normalize(job) {
  const c = job.categories || {};
  const groups = [];
  if (c.department) groups.push({ type: 'department', name: c.department });
  if (c.team) groups.push({ type: 'team', name: c.team });
  const locs = new Set();
  if (c.location) locs.add(c.location);
  for (const l of c.allLocations || []) if (l) locs.add(l);
  for (const l of locs) groups.push({ type: 'location', name: l });
  if (job.country) groups.push({ type: 'country', name: job.country });
  // Surface a `remote` group when Lever flags the workplace remote or "remote" appears in a location,
  // so the UI can tag remote-friendly roles (consistent with the other adapters).
  const remote = /remote/i.test(job.workplaceType || '')
    || [...locs].some((l) => /remote/i.test(l));
  if (remote) groups.push({ type: 'remote', name: 'remote' });
  return {
    jobId: String(job.id),
    title: job.text || '',
    url: job.hostedUrl || job.applyUrl || null,
    location: c.location || null,
    groups,
    raw: job,
  };
}

// Fetch + normalize every posting for a Lever source. Bounded by a timeout; throws on
// non-2xx/timeout so the tracker can record the error and skip this source's diff.
export async function fetchJobs(source) {
  const url = source.endpoint || `https://api.lever.co/v0/postings/${source.board}?mode=json`;
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  const body = await res.json();
  const jobs = Array.isArray(body) ? body : [];
  return jobs.map(normalize);
}
