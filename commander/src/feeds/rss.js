// Generic RSS/Atom adapter. Config: { adapter:'rss', url, categories?, excludeCategories? }. Covers
// any company that publishes a real feed — OpenAI news (openai.com/news/rss.xml), NVIDIA blog
// (blogs.nvidia.com/feed/), Google's blog RSS, Google-News search RSS, etc.
//
// Category bucketing: several feed configs may share ONE RSS url and split its items by <category>.
// `categories` keeps an item if ANY of its categories match (case-insensitive); `excludeCategories`
// drops it if ANY match. Priority between buckets is encoded with excludes — e.g. the
// Research+Product bucket excludes Company so a Company+Research item lands only in the Company
// bucket. A bucket with ONLY excludes is the catch-all for everything the other buckets claimed.
import Parser from 'rss-parser';

const parser = new Parser({
  timeout: 20000,
  headers: { 'user-agent': 'Mozilla/5.0 (compatible; ambition-commander/1.0)' },
});

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 600);

// rss-parser yields categories as strings or objects ({_: text} / {$: {term}}) depending on dialect.
const itemCategories = (it) =>
  (it.categories || []).map((c) => clean(typeof c === 'string' ? c : c?._ ?? c?.$?.term ?? '')).filter(Boolean);

function matchesBucket(cats, feed) {
  const has = (list) => list.some((want) => cats.some((c) => c.toLowerCase() === String(want).toLowerCase()));
  if (Array.isArray(feed.excludeCategories) && feed.excludeCategories.length && has(feed.excludeCategories)) return false;
  if (Array.isArray(feed.categories) && feed.categories.length) return has(feed.categories);
  return true;
}

export async function fetchFeed(source, feed) {
  const parsed = await parser.parseURL(feed.url);
  return (parsed.items || [])
    .filter((it) => matchesBucket(itemCategories(it), feed))
    .map((it) => ({
      externalId: String(it.guid || it.id || it.link || it.title || '').trim(),
      title: clean(it.title),
      url: it.link || null,
      summary: clean(it.contentSnippet || it.summary || it.content || '') || null,
      publishedAt: it.isoDate || it.pubDate || null,
      eventStart: null,
      eventLocation: null,
      raw: { creator: it.creator || it['dc:creator'] || null, categories: itemCategories(it) },
    }))
    .filter((i) => i.title && i.externalId);
}
