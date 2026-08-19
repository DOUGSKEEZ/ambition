// Generic selector-driven HTML adapter (the equivalent of UAV's custom google.js, but config-driven
// so most companies need no bespoke code). For boards that publish NO feed — Anthropic news/events,
// Cursor blog, Arize blog/press, and the public companies' investor-report pages (kind='financial').
//
// Config: {
//   adapter: 'html',
//   url,                 // page to fetch
//   base?,               // origin for resolving relative hrefs (defaults to url's origin)
//   item,                // CSS selector for each item container (REQUIRED)
//   title?,              // selector within item for the title text (default: the item's own text)
//   link?,               // selector within item for the <a> (default: item if it's an <a>, else first <a>)
//   date?,               // selector within item for a date string (parsed best-effort; may be absent)
//   summary?,            // selector within item for an excerpt
//   location?,           // selector within item for an event location (kind='event')
//   eventDates?,         // true → the parsed date is the event's START (future), not a publish date
// }
//
// A site that is fully client-rendered (some event pages) yields no server HTML → the item selector
// matches nothing → we throw, and the tracker isolates this feed (like a UAV fetch failure) rather
// than silently reporting "no items". Selectors are tuned per-company as each is brought online.
import * as cheerio from 'cheerio';

const UA = 'Mozilla/5.0 (compatible; ambition-commander/1.0; +https://dougmcafee.com)';
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

// Parse a human date string ("Jun 30, 2026") into an ISO date, or null if unparseable/absent.
// Event listings often show a RANGE ("August 1-6, 2026" / "Aug 30 – Sep 2, 2026"). GOTCHA: bare
// Date.parse doesn't reject the first form — it reads "6, 2026" as year 6 and returns 2006-08-01 —
// so ranges are normalized to their start date before parsing.
function parseDate(text) {
  const t = clean(text)
    .replace(/(\d{1,2})\s*[-–—]\s*\d{1,2}(,?\s*\d{4})/, '$1$2') // "August 1-6, 2026" → "August 1, 2026"
    .replace(/(\d{1,2})\s*[-–—]\s*[A-Za-z]+\s+\d{1,2}(,?\s*\d{4})/, '$1$2'); // "Aug 30 – Sep 2, 2026" → "Aug 30, 2026"
  if (!t) return null;
  const ms = Date.parse(t);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

export async function fetchFeed(source, feed) {
  if (!feed.item) throw new Error(`html feed for ${source.key} is missing the "item" selector`);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  let html;
  try {
    const res = await fetch(feed.url, { headers: { 'user-agent': UA, accept: 'text/html' }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = await res.text();
  } finally {
    clearTimeout(timer);
  }

  const $ = cheerio.load(html);
  const base = feed.base || new URL(feed.url).origin;
  // The listing page's own path (e.g. "/blog/") — used to drop the self-referential nav link that an
  // `a[href*="/blog/"]` selector otherwise picks up alongside the real post links.
  const indexPath = new URL(feed.url).pathname.replace(/\/+$/, '');
  const resolve = (href) => {
    if (!href) return null;
    try {
      return new URL(href, base).toString();
    } catch {
      return null;
    }
  };

  const seen = new Set();
  const items = [];
  $(feed.item).each((_, el) => {
    const node = $(el);
    // Title: an explicit selector wins; if it's absent OR misses (e.g. a "featured" hero card with
    // different classes than the list cards), prefer the first heading inside the item; only then
    // fall back to the item's own text. Preferring a heading avoids mashing the date/category/excerpt
    // into the title when the whole card is one <a>.
    let titleEl = feed.title ? node.find(feed.title).first() : node.find('h1,h2,h3,h4,h5').first();
    if (!titleEl.length) titleEl = node.find('h1,h2,h3,h4,h5').first();
    const title = clean(titleEl.length ? titleEl.text() : node.text());
    let href = feed.link
      ? node.find(feed.link).first().attr('href')
      : node.is('a')
        ? node.attr('href')
        : node.find('a').first().attr('href');
    href = resolve(href);
    if (!title || !href || seen.has(href)) return;
    // Skip the listing page's own link (nav/hero pointing back at /blog/, /news/, …).
    try { if (new URL(href).pathname.replace(/\/+$/, '') === indexPath) return; } catch { /* keep */ }
    seen.add(href);
    items.push({
      externalId: href,
      title: title.slice(0, 300),
      url: href,
      summary: feed.summary ? clean(node.find(feed.summary).first().text()).slice(0, 600) || null : null,
      publishedAt: feed.date ? parseDate(node.find(feed.date).first().text()) : null,
      eventStart: feed.date && feed.eventDates ? parseDate(node.find(feed.date).first().text()) : null,
      eventLocation: feed.location ? clean(node.find(feed.location).first().text()) || null : null,
      raw: {},
    });
  });

  if (!items.length) throw new Error(`no items matched selector "${feed.item}" on ${feed.url}`);
  return items;
}
