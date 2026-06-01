// Deterministic parse of a captured LinkedIn profile.
// Pure function over the capture payload: no DB, no network.
//
// IMPORTANT: captures come from Doug's AUTHENTICATED LinkedIn session, whose HTML
// has NO JSON-LD and uses hashed/obfuscated CSS classes that change per build. So we
// cannot rely on stable selectors or schema.org. Instead we:
//   1. take the name from <title> / og:title (rock solid),
//   2. extract the rendered visible-text lines and read the top card by position,
//      anchored on the name and the "Contact info" marker,
//   3. pull the profile photo URL from the loaded <img> (media.licdn.com/...displayphoto).
// JSON-LD is still tried first when present (logged-out / public captures).
import * as cheerio from 'cheerio';

// Pull the LinkedIn vanity slug out of a profile URL.
// https://www.linkedin.com/in/jane-doe-123/  ->  jane-doe-123
export function slugFromUrl(url = '') {
  const m = String(url).match(/linkedin\.com\/in\/([^/?#]+)/i);
  if (m) return decodeURIComponent(m[1]);
  try {
    const u = new URL(url);
    const seg = u.pathname.split('/').filter(Boolean).pop();
    if (seg) return decodeURIComponent(seg);
  } catch {
    /* not a URL */
  }
  return null;
}

const FIELDS = [
  'name', 'title', 'location', 'about',
  'current_company', 'current_title', 'current_tenure',
  'previous_title', 'previous_company',
];

// ---------------------------------------------------------------------------
// JSON-LD path (logged-out / public profiles, which DO carry schema.org data)
// ---------------------------------------------------------------------------
function findPerson(node) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const f = findPerson(item);
      if (f) return f;
    }
    return null;
  }
  const t = node['@type'];
  if (t === 'Person' || (Array.isArray(t) && t.includes('Person'))) return node;
  if (Array.isArray(node['@graph'])) return findPerson(node['@graph']);
  return null;
}

function parseJsonLd(jsonldStrings = []) {
  for (const raw of jsonldStrings) {
    let data;
    try {
      data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      continue;
    }
    const person = findPerson(data);
    if (!person) continue;

    const out = {};
    out.name = person.name || null;
    if (typeof person.jobTitle === 'string') out.title = person.jobTitle;
    else if (Array.isArray(person.jobTitle) && person.jobTitle.length) out.title = person.jobTitle[0];
    if (!out.title && person.description) out.title = person.description;
    if (person.description) out.about = person.description;

    const addr = person.address;
    if (addr) {
      out.location = typeof addr === 'string'
        ? addr
        : [addr.addressLocality, addr.addressRegion, addr.addressCountry].filter(Boolean).join(', ') || null;
    }

    const works = Array.isArray(person.worksFor) ? person.worksFor : person.worksFor ? [person.worksFor] : [];
    if (works.length) {
      out.current_company = works[0]?.name || null;
      const member = works[0]?.member;
      if (member?.description) out.current_title = member.description;
    }
    return out;
  }
  return {};
}

// ---------------------------------------------------------------------------
// Rendered-text path (authenticated app HTML)
// ---------------------------------------------------------------------------

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&#x2019;/g, '’')
    .replace(/&#x2014;/g, '—')
    .replace(/&nbsp;/g, ' ');
}

// Collapse the HTML to a list of trimmed visible-text lines (scripts/styles/svg removed).
function visibleLines(html) {
  let h = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  h = h.replace(/<[^>]+>/g, '\n');
  return decodeEntities(h)
    .split('\n')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length > 0);
}

function nameFromHtml($, html) {
  // <title>Doug McAfee | LinkedIn</title>
  const title = $('title').first().text().trim();
  if (title) {
    const n = title.replace(/\s*[|–-]\s*LinkedIn.*$/i, '').replace(/\s*\|\s*LinkedIn$/i, '').trim();
    if (n && !/^\(\d+\)/.test(n)) return n; // skip "(3) Feed | LinkedIn"
    const stripped = n.replace(/^\(\d+\)\s*/, '').trim();
    if (stripped) return stripped;
  }
  // og:title fallback
  const og = $('meta[property="og:title"]').attr('content');
  if (og) return og.replace(/\s*[|–-]\s*LinkedIn.*$/i, '').trim();
  return null;
}

// Heuristics for the top card.
const NAV_NOISE = new Set([
  'Home', 'My Network', 'Jobs', 'Messaging', 'Notifications', 'Me', 'For Business',
  'Advertise', 'Resources', 'Visit my website', 'Add section', 'Open to', 'Contact info',
  'More', 'Skip to search', 'Skip to main content', 'Skip to primary content', 'Skip to aside',
]);

// Pronoun lines, connection-degree markers, and bare bullets in the top card.
function isCardNoise(s) {
  if (!s) return true;
  if (/^·+$/.test(s)) return true;                       // bare "·"
  if (/^·?\s*(1st|2nd|3rd)$/i.test(s)) return true;      // "· 1st", "1st"
  if (/^(she|he|they)\/(her|him|them)$/i.test(s)) return true; // pronouns
  if (/^(Message|Follow|Connect|More|Pending|Following)$/i.test(s)) return true;
  return false;
}

function looksLikeLocation(s) {
  // "Breckenridge, Colorado, United States" / "Greater Seattle Area" / "London, England, United Kingdom"
  if (s.length > 90) return false;
  if (/\bconnections?\b|\bfollowers?\b/i.test(s)) return false;
  return /,/.test(s) || /\bArea\b/.test(s) || /\bRegion\b/.test(s);
}

function parseTopCard(html) {
  const lines = visibleLines(html);
  const $ = cheerio.load(html);
  const out = {};

  const name = nameFromHtml($, html);
  if (name) out.name = name;

  // The top card is anchored by the "Contact info" line. The authed layout is:
  //   [name] [headline] [company · school]  <- the SECOND name block, just above
  //   Contact info
  //   [location]                            <- immediately AFTER Contact info
  const ci = lines.indexOf('Contact info');
  if (ci !== -1) {
    // Walk backward from Contact info to find the name block that precedes it.
    let nameIdx = -1;
    for (let i = ci - 1; i >= 0 && i >= ci - 8; i--) {
      if (name && lines[i] === name) { nameIdx = i; break; }
    }
    if (nameIdx !== -1) {
      // Lines between the name and Contact info. Drop nav noise, pronouns, and
      // connection-degree markers ("· 1st", "1st", bare "·").
      const card = [];
      for (let k = nameIdx + 1; k < ci; k++) {
        const l = lines[k];
        if (l === name || NAV_NOISE.has(l) || isCardNoise(l)) continue;
        card.push(l);
      }
      // Headline = first remaining line that isn't itself the location.
      const titleLine = card.find((l) => !looksLikeLocation(l));
      if (titleLine) out.title = titleLine;

      // Company: prefer a separate "Company · School" line; else pull it out of a
      // headline of the form "<Role> at <Company>".
      const orgLine = card.find((l) => / · /.test(l) && !looksLikeLocation(l));
      if (orgLine) {
        out.current_company = orgLine.split(' · ')[0].trim();
      } else if (out.title) {
        const m = out.title.match(/\bat\s+(.+)$/i);
        if (m) out.current_company = m[1].trim();
      }

      // Location: a card line that looks like a place.
      const loc = card.find((l) => l !== out.title && looksLikeLocation(l));
      if (loc) out.location = loc;
    }
    // Fallback: line right after Contact info.
    if (!out.location && looksLikeLocation(lines[ci + 1])) out.location = lines[ci + 1];
  }

  // About section: the block following a standalone "About" heading.
  const aboutIdx = lines.findIndex((l) => l === 'About');
  if (aboutIdx !== -1) {
    // Gather following lines until the next section heading.
    const SECTION = /^(Experience|Education|Activity|Featured|Skills|Licenses|Projects|Recommendations|People also viewed|Interests)$/;
    const buf = [];
    for (let k = aboutIdx + 1; k < lines.length && buf.join(' ').length < 2500; k++) {
      if (SECTION.test(lines[k])) break;
      if (lines[k] === 'About') continue;
      buf.push(lines[k]);
    }
    let about = buf.join('\n').trim();
    // Strip the "see more" truncation artifact LinkedIn appends.
    about = about.replace(/\n?\s*…?\s*(see more|more)\s*$/i, '').replace(/\n?\s*…\s*$/i, '').trim();
    if (about) out.about = about;
  }

  // Experience section: best-effort current/previous role from the rendered text.
  // (Requires the page to have been scrolled so LinkedIn lazy-loads it — the
  // extension now auto-scrolls before capturing.) Fills gaps; never clobbers the
  // top-card values we already trust.
  const exp = parseExperience(lines);
  for (const k of ['current_title', 'current_company', 'current_tenure', 'previous_title', 'previous_company']) {
    if (!out[k] && exp[k]) out[k] = exp[k];
  }

  return out;
}

const EMPLOYMENT_TYPES = /^(Full-time|Part-time|Self-employed|Freelance|Contract|Internship|Hybrid|Remote|On-site|Apprenticeship|Seasonal|Permanent)$/i;
const DURATION = /\b\d+\s*(yr|yrs|year|years|mo|mos|month|months)\b/i;
// A LinkedIn date range: "Jan 2018 - Present · 8 yrs 5 mos", "Dec 2023 - Mar 2026 · 2 yrs", "2019 - 2021".
const DATE_RANGE = /\b([A-Z][a-z]{2}\.?\s+\d{4}|\d{4})\s*[-–]\s*(Present|[A-Z][a-z]{2}\.?\s+\d{4}|\d{4})/;

// Parse the Experience block into current/previous {title, company, tenure}.
// LinkedIn renders two layouts:
//   FLAT (one role per company):   Title / "Company · Type" (or Company) / Date / [loc] / [desc]
//   GROUPED (multiple roles/co):   Company / TotalDuration / Title / Date / [desc] / Title2 / Date2 ...
// We detect which by looking at the first date's preceding line, then parse accordingly.
function parseExperience(lines) {
  const out = {};
  const ei = lines.findIndex((l) => l === 'Experience');
  if (ei === -1) return out;

  const END = /^(Education|Skills|Licenses & certifications|Licenses|Volunteering|Projects|Courses|Honors|Recommendations|People also viewed|Interests|Activity|Featured)$/i;
  const sec = [];
  for (let k = ei + 1; k < lines.length; k++) {
    if (END.test(lines[k])) break;
    sec.push(lines[k]);
  }

  const isNoise = (l) =>
    !l || EMPLOYMENT_TYPES.test(l) || DURATION.test(l) || DATE_RANGE.test(l) ||
    looksLikeLocation(l) || l === '…' || l === 'more' || l.length > 90;
  const tenureOf = (dateLine) => {
    const m = dateLine.match(/·\s*(.+)$/);
    return (m ? m[1] : dateLine).trim();
  };
  const cleanAbove = (d, skip = []) => {
    for (let j = d - 1; j >= 0 && j > d - 6; j--) {
      if (!isNoise(sec[j]) && !skip.includes(sec[j])) return sec[j];
    }
    return null;
  };

  const dateIdxs = sec.map((l, i) => (DATE_RANGE.test(l) ? i : -1)).filter((i) => i >= 0);
  if (!dateIdxs.length) return out;

  // FLAT if the line just above the first date is a "Company · Type" or a bare company
  // (i.e. not itself noise) AND the line above THAT exists as a title. We treat a
  // "· "-containing line above the date as the strongest FLAT signal.
  const firstAbove = sec[dateIdxs[0] - 1] || '';
  const flat = firstAbove.includes(' · ') ||
    (!isNoise(firstAbove) && !!cleanAbove(dateIdxs[0] - 1) &&
     // grouped layouts put a "total duration" line near the top; flat ones don't
     !(DURATION.test(sec[1] || '') && !DATE_RANGE.test(sec[1] || '')));

  const entries = [];
  if (flat) {
    for (const d of dateIdxs) {
      const above = sec[d - 1] || '';
      const company = above.includes(' · ') ? above.split(' · ')[0].trim()
        : (!isNoise(above) ? above : null);
      const title = cleanAbove(company ? d - 1 : d, company ? [company] : []);
      entries.push({ title, company, tenure: tenureOf(sec[d]) });
      if (entries.length >= 2) break;
    }
  } else {
    // GROUPED: company is the section header (first clean line, before its total-duration).
    const company = sec.find((l) => !isNoise(l)) || null;
    for (const d of dateIdxs) {
      const title = cleanAbove(d, company ? [company] : []);
      entries.push({ title, company, tenure: tenureOf(sec[d]) });
      if (entries.length >= 2) break;
    }
  }

  if (entries[0]) {
    out.current_title = entries[0].title || null;
    out.current_company = entries[0].company || null;
    out.current_tenure = entries[0].tenure || null;
  }
  if (entries[1]) {
    out.previous_title = entries[1].title || null;
    out.previous_company = entries[1].company || null;
  }
  return out;
}

// Profile photo URL from the already-loaded <img> (authed pages embed the licdn URL).
// The page contains MULTIPLE displayphoto images — the global-nav "Me" avatar (the
// viewer, i.e. Doug), "people also viewed" thumbnails, etc. The profile owner's photo
// is the one whose alt text is the owner's name, so we rank candidates rather than
// taking the first match (which would grab the nav avatar).
export function photoUrlFromHtml(html = '', name = '') {
  const $ = cheerio.load(html);
  const candidates = [];
  $('img').each((_i, el) => {
    const $el = $(el);
    const src = $el.attr('src') || $el.attr('data-delayed-url') || '';
    if (!/displayphoto/i.test(src)) return;
    const alt = ($el.attr('alt') || '').trim();
    // Is this inside the global nav / "Me" menu? That's the viewer's avatar — skip-ish.
    const inNav = $el.closest('header, nav, .global-nav, [class*="global-nav"]').length > 0;
    candidates.push({ src, alt, inNav });
  });
  if (!candidates.length) return null;

  const n = (name || '').trim();
  // Best: exact alt == owner name, not in nav. Then alt includes name, not in nav.
  // Then any non-nav displayphoto. Then any displayphoto at all.
  return (
    candidates.find((c) => !c.inNav && n && c.alt === n) ||
    candidates.find((c) => !c.inNav && n && c.alt.includes(n)) ||
    candidates.find((c) => !c.inNav) ||
    candidates[0]
  ).src;
}

// ---------------------------------------------------------------------------
function merge(primary, fallback) {
  const out = { ...fallback };
  for (const [k, v] of Object.entries(primary)) {
    if (v !== null && v !== undefined && v !== '') out[k] = v;
  }
  return out;
}

/**
 * Parse a capture payload into deterministic person fields.
 * @param {{url?:string, html?:string, jsonld?:string[]}} payload
 * @returns {object} field map (all FIELDS keys present, null when unknown) + linkedin_slug + photo_url
 */
export function parseProfile(payload = {}) {
  const fromLd = parseJsonLd(payload.jsonld || []);
  const fromText = payload.html ? parseTopCard(payload.html) : {};

  // Text path is the reliable one for authed captures; JSON-LD fills gaps when present.
  const merged = merge(fromText, fromLd);

  const result = { linkedin_slug: slugFromUrl(payload.url) };
  for (const f of FIELDS) result[f] = merged[f] ?? null;
  result.photo_url = payload.html ? photoUrlFromHtml(payload.html, merged.name || '') : null;
  return result;
}
