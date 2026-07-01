// Generic RSS/Atom adapter. Config: { adapter:'rss', url }. Covers any company that publishes a real
// feed — OpenAI news (openai.com/news/rss.xml), NVIDIA blog (blogs.nvidia.com/feed/), Google's blog
// RSS, Google-News search RSS, etc. Returns the normalized FeedItem shape the tracker upserts.
import Parser from 'rss-parser';

const parser = new Parser({
  timeout: 20000,
  headers: { 'user-agent': 'Mozilla/5.0 (compatible; ambition-commander/1.0)' },
});

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 600);

export async function fetchFeed(source, feed) {
  const parsed = await parser.parseURL(feed.url);
  return (parsed.items || [])
    .map((it) => ({
      externalId: String(it.guid || it.id || it.link || it.title || '').trim(),
      title: clean(it.title),
      url: it.link || null,
      summary: clean(it.contentSnippet || it.summary || it.content || '') || null,
      publishedAt: it.isoDate || it.pubDate || null,
      eventStart: null,
      eventLocation: null,
      raw: { creator: it.creator || it['dc:creator'] || null, categories: it.categories || [] },
    }))
    .filter((i) => i.title && i.externalId);
}
