// Workday job-board adapter. Many enterprises (NVIDIA, etc.) host careers on Workday at
// <tenant>.<dc>.myworkdayjobs.com/<site>. The human page is backed by a JSON "cxs" API:
//
//   POST https://<tenant>.<dc>.myworkdayjobs.com/wday/cxs/<tenant>/<site>/jobs
//   body: { appliedFacets:{<facetParam>:[<id>,...]}, limit, offset, searchText }
//
// Unlike Greenhouse/Ashby, Workday PAGINATES (20/page) and exposes server-side facets — so a
// source narrows at the API level via `facets` (e.g. jobFamilyGroup=Sales, locationHierarchy1=US)
// and titleContains does the rest. The list response is sparse per job (title, externalPath,
// locationsText, postedOn, bulletFields[JR id]); we derive everything we need from those.

const FETCH_TIMEOUT_MS = 20000;
const PAGE = 20;
const MAX_PAGES = 40; // safety cap (~800 jobs) so a bad facet can't loop forever

const cxsBase = (s) =>
  `https://${s.tenant}.${s.dc}.myworkdayjobs.com/wday/cxs/${s.tenant}/${s.site}`;
// Public, shareable job page (verified to resolve without the /en-US locale segment).
const pageBase = (s) =>
  `https://${s.tenant}.${s.dc}.myworkdayjobs.com/${s.site}`;

// Workday gives a clean "City, ST, Country" string in locationsText for single-location roles, but
// just "N Locations" for multi-location ones. In that case fall back to the primary location baked
// into externalPath (e.g. /job/US-CA-Santa-Clara/Title_JR123 → "Santa Clara, CA +more").
function parseLocation(externalPath, locationsText) {
  const multi = /^\s*\d+\s+locations?\s*$/i.test(locationsText || '');
  if (locationsText && !multi) return locationsText;
  const seg = String(externalPath || '').split('/')[2] || ''; // "US-CA-Santa-Clara"
  const parts = seg.split('-').filter(Boolean);
  if (parts.length >= 3) {
    const [, state, ...cityWords] = parts; // drop country code; "Remote" stays as a city word
    const loc = `${cityWords.join(' ')}, ${state}`;
    return multi ? `${loc} +more` : loc;
  }
  return locationsText || null; // give back whatever we had rather than nothing
}

// Map one Workday list-row into the normalized posting shape. Groups are sparse here (location +
// a remote flag) since filtering is title/facet-driven, not group-driven, for Workday sources.
function normalize(job, source) {
  const path = job.externalPath || '';
  const location = parseLocation(path, job.locationsText);
  const jobId = String(job.bulletFields?.[0] || path); // JR id (stable); path is the fallback key
  const groups = [];
  if (location) groups.push({ type: 'location', name: location });
  if (/remote/i.test(`${path} ${job.locationsText || ''}`)) groups.push({ type: 'remote', name: 'remote' });
  return {
    jobId,
    title: job.title || '',
    url: path ? `${pageBase(source)}${path}` : null,
    location,
    groups,
    raw: job,
  };
}

// Fetch + normalize every job for a Workday source, paging through the cxs API. `source.facets` is
// the appliedFacets object (facetParameter → [ids]); omit it to pull the whole board. Throws on
// non-2xx/timeout so the tracker records the error and skips this source's diff.
export async function fetchJobs(source) {
  const url = `${cxsBase(source)}/jobs`;
  const appliedFacets = source.facets || {};
  const out = [];
  let offset = 0, total = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ appliedFacets, limit: PAGE, offset, searchText: source.searchText || '' }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    const body = await res.json();
    if (total === null) total = body.total; // only the first page reports a reliable total
    const batch = Array.isArray(body.jobPostings) ? body.jobPostings : [];
    out.push(...batch);
    offset += PAGE;
    if (!batch.length || offset >= total) break;
  }
  return out.map((j) => normalize(j, source));
}
