import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isAbsolute, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
// Same media dir server.js serves at /media — so favicons live alongside contact photos and
// are reachable from every app that mounts /media (Sniper, Medic, SpecOps).
const MEDIA_DIR = (() => {
  const p = process.env.MEDIA_DIR || './media';
  return isAbsolute(p) ? p : join(ROOT, p);
})();

const FETCH_TIMEOUT_MS = 5000;
const sha1 = (buf) => createHash('sha1').update(buf).digest('hex');

// Fetch a favicon PNG from Google's service for a domain. Bounded by a timeout so a slow/hung
// service can't stall the caller. Returns the bytes, or null on any failure/timeout.
async function fetchFavicon(domain) {
  const url = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) return null;
  return Buffer.from(await res.arrayBuffer());
}

// Google returns a GENERIC GLOBE (HTTP 200) when it has no favicon for a domain. Fetch that
// placeholder once for a guaranteed-unknown domain and cache its hash, so we can recognise and
// skip it — otherwise a typo'd/unlisted website would badge the company with a fake globe logo.
let globeHashPromise;
function getGlobeHash() {
  if (!globeHashPromise) {
    globeHashPromise = fetchFavicon('no-such-domain.invalid')
      .then((buf) => (buf ? sha1(buf) : null))
      .catch(() => null);
  }
  return globeHashPromise;
}

// Best-effort: fetch a company's favicon by domain and save it as media/company-icons/<id>.png.
// Keyed by id (not name) so a rename can't orphan it. NEVER throws and never blocks indefinitely —
// a failed/timed-out fetch or a generic-globe result just leaves the company with no icon.
export async function saveCompanyFavicon(id, website) {
  try {
    if (!website) return;
    const domain = String(website)
      .replace(/^https?:\/\//i, '')
      .replace(/\/.*/, '')
      .replace(/^www\./i, '')
      .trim();
    if (!domain) return;
    const buf = await fetchFavicon(domain);
    if (!buf) return;
    const globe = await getGlobeHash();
    if (globe && sha1(buf) === globe) return; // no real favicon — don't save the placeholder
    const dir = join(MEDIA_DIR, 'company-icons');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${id}.png`), buf);
  } catch (err) {
    console.error('[favicon] fetch failed for', website, err?.message);
  }
}
