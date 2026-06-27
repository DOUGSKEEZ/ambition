// Ashby job-board adapter. OpenAI (and others) publish their board at
// api.ashbyhq.com/posting-api/job-board/<board> — a single (large, multi-MB) JSON response.
// Ashby exposes human-readable department/team/location NAMES (no numeric ids like Greenhouse),
// so filters for Ashby sources match on names. Normalizes into the common posting shape.

const FETCH_TIMEOUT_MS = 30000; // generous: the response can be several MB

// Ashby tags each location with a postal address; the country lives at
// address.postalAddress.addressCountry. We surface it as a `country` group so sources can
// filter by country (e.g. all US roles) instead of enumerating city names.
function countryOf(address) {
  return address?.postalAddress?.addressCountry || null;
}

// Slugify a title the way embedded-board careers pages do: lowercase, runs of non-alphanumerics
// → single hyphen, trimmed. e.g. "Account Executive, Geo Enterprise - SF" → "account-executive-geo-enterprise-sf".
function slugify(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Build the public slug-path URL for a job on an embedded careers page (source.jobUrlBase set).
// Base slug is the title; when two postings on the board share a title (e.g. the same role in
// New York and London), the company disambiguates by appending the location — so we do too, using
// the collision counts gathered across the whole board in fetchJobs.
function slugUrl(job, base, slugCounts) {
  const titleSlug = slugify(job.title);
  const slug = (slugCounts && slugCounts.get(titleSlug) > 1 && job.location)
    ? slugify(`${job.title} ${job.location}`)
    : titleSlug;
  return `${base.replace(/\/+$/, '')}/${slug}`;
}

// Map an Ashby job into a normalized posting. Collects department, team, the primary location
// and any secondaryLocations into `groups` (names only — Ashby has no group ids in this feed),
// plus a `country` group per distinct address country.
//
// URL: Ashby's `jobUrl` (jobs.ashbyhq.com/<board>/<id>) only resolves when the company publishes
// the HOSTED board. Companies that instead EMBED the board on their own careers page (e.g. Cursor)
// leave that hosted page as a dead "Jobs" shell — for those, set `jobUrlBase` on the source and we
// build the page's own slug-path URL (<base>/<title-slug>). Falls back to the hosted jobUrl otherwise.
function normalize(job, source = {}, slugCounts = null) {
  const groups = [];
  if (job.department) groups.push({ type: 'department', name: job.department });
  if (job.team) groups.push({ type: 'team', name: job.team });
  if (job.location) groups.push({ type: 'location', name: job.location });
  const countries = new Set();
  const addCountry = (addr) => { const c = countryOf(addr); if (c) countries.add(c); };
  addCountry(job.address);
  for (const sec of job.secondaryLocations || []) {
    const name = sec?.location || sec;
    if (name) groups.push({ type: 'location', name });
    addCountry(sec?.address);
  }
  for (const c of countries) groups.push({ type: 'country', name: c });
  // Surface a `remote` group when Ashby flags the role remote or "remote" appears in its workplace
  // type / location text, so the UI can tag remote-friendly roles.
  const locs = [job.location, ...(job.secondaryLocations || []).map((s) => s?.location || s)];
  const remote = job.isRemote === true
    || /remote/i.test(job.workplaceType || '')
    || locs.some((l) => /remote/i.test(l || ''));
  if (remote) groups.push({ type: 'remote', name: 'remote' });
  const url = source.jobUrlBase
    ? slugUrl(job, source.jobUrlBase, slugCounts)
    : (job.jobUrl || job.applyUrl || null);
  return {
    jobId: String(job.id),
    title: job.title || '',
    url,
    location: job.location || null,
    groups,
    raw: job,
  };
}

// Fetch + normalize listed jobs for an Ashby source. Unlisted roles (isListed === false) are
// dropped — they aren't publicly posted. Throws on non-2xx/timeout (tracker handles it).
export async function fetchJobs(source) {
  const url = source.endpoint || `https://api.ashbyhq.com/posting-api/job-board/${source.board}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  const body = await res.json();
  const jobs = Array.isArray(body?.jobs) ? body.jobs : [];
  const listed = jobs.filter((j) => j.isListed !== false);
  // For slug-path URLs (embedded boards), count title-slug occurrences across the WHOLE board so
  // normalize() knows which titles collide and must be disambiguated by location.
  let slugCounts = null;
  if (source.jobUrlBase) {
    slugCounts = new Map();
    for (const j of listed) {
      const s = slugify(j.title);
      slugCounts.set(s, (slugCounts.get(s) || 0) + 1);
    }
  }
  return listed.map((j) => normalize(j, source, slugCounts));
}
