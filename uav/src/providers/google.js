// Google careers adapter. Google has NO public JSON board. The careers results page is server-side
// rendered with the full job list embedded in an `AF_initDataCallback({key:'ds:1', ... data:[...]})`
// blob. We fetch the results URL (which applies the `q` keyword filter server-side), paginate, and
// parse that blob. Each job is an array: [0]=id, [1]=title, [2]=apply-url, [9]=locations (each
// [displayName, [addresses], city, zip, state, countryCode]).
//
// This is the MOST FRAGILE adapter — Google can change the embedded shape without notice. On any
// parse/fetch failure it throws, so the tracker isolates this source and the API-based ones keep
// working. Filtering (title/location) is done client-side by tracker.matchesFilter, as for the
// other providers.

const FETCH_TIMEOUT_MS = 20000;
const MAX_PAGES = 6;                  // ~20 results/page; a keyword search is well under this
const PAGE_SIZE = 20;
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const slug = (title) => String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// Balance-extract the `data:[...]` array following an AF_initDataCallback at `from`. String-aware so
// brackets inside job-description text can't throw off the balance. Returns the parsed array or null.
function extractDataArray(html, from) {
  const d = html.indexOf('data:', from);
  if (d < 0) return null;
  let start = d + 'data:'.length;
  while (start < html.length && html[start] !== '[') start++;
  let depth = 0, end = -1, inStr = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (c === '\\') { i++; continue; }   // skip the escaped char
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '[') depth++;
    else if (c === ']') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end < 0) return null;
  try { return JSON.parse(html.slice(start, end)); } catch { return null; }
}

// The SSR HTML has several AF_initDataCallback blocks (jobs, company facets, ...). Identify the JOB
// block by SHAPE — data[0] is an array of tuples whose [0] is a long numeric id and [1] is a string
// title — rather than by a key name that could change. Returns the array of job tuples (or []).
function parseJobs(html) {
  const re = /AF_initDataCallback\(\{key:\s*['"][^'"]+['"]/g;
  let m;
  while ((m = re.exec(html))) {
    const data = extractDataArray(html, m.index);
    const rows = Array.isArray(data?.[0]) ? data[0] : null;
    const t0 = rows?.[0];
    if (Array.isArray(t0) && typeof t0[0] === 'string' && /^[0-9]{12,}$/.test(t0[0]) && typeof t0[1] === 'string') {
      return rows;
    }
  }
  return [];
}

function normalize(j) {
  const jobId = String(j[0]);
  const title = j[1] || '';
  const locs = Array.isArray(j[9]) ? j[9] : [];
  const groups = [];
  const countries = new Set();
  for (const loc of locs) {
    if (loc?.[0]) groups.push({ type: 'location', name: loc[0] }); // e.g. "San Francisco, CA, USA"
    if (loc?.[5]) countries.add(loc[5]);                           // e.g. "US"
  }
  if (countries.has('US')) groups.push({ type: 'country', name: 'United States' });
  return {
    jobId,
    title,
    url: `https://www.google.com/about/careers/applications/jobs/results/${jobId}-${slug(title)}`,
    location: locs[0]?.[0] || null,
    groups,
    // Keep raw compact — the source tuple carries multi-KB description HTML we don't need stored.
    raw: { id: jobId, title, locations: locs.map((l) => l?.[0]).filter(Boolean) },
  };
}

export async function fetchJobs(source) {
  const base = source.endpoint; // careers results URL with the q=... keyword baked in
  const seen = new Set();
  const out = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = base + (base.includes('?') ? '&' : '?') + 'page=' + page;
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status} from Google careers (page ${page})`);
    const jobs = parseJobs(await res.text());
    if (!jobs.length) break;
    let added = 0;
    for (const j of jobs) {
      const id = String(j[0]);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(normalize(j));
      added++;
    }
    if (jobs.length < PAGE_SIZE || added === 0) break; // last page, or nothing new
  }
  return out;
}
