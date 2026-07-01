// The shared fetch + store core. BOTH the scheduled pipeline (pipeline.js) and the UI's "Refresh now"
// button (POST /api/refresh) call runTracker(), so they always agree. Feeds are APPEND-ONLY: a new
// item is inserted, a re-seen item just bumps last_seen_at (items never "close" — unlike UAV postings).
// Each feed is fetched independently; a failure records an error and leaves that feed's items
// untouched — a transient outage never wipes a stream.
import { SOURCES, getSource, allFeeds } from './sources.js';
import { getAdapter } from './feeds/index.js';
import { query } from './db.js';

// Upsert one normalized item. Returns whether it was newly inserted (via the xmax=0 trick: on INSERT
// xmax is 0, on UPDATE it is the locking txid) so the caller can count/print what's new.
async function upsertItem(source, kind, item) {
  const r = await query(
    `INSERT INTO feed_items
       (company, source_key, kind, external_id, title, url, summary,
        published_at, event_start, event_location, raw, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, NOW())
     ON CONFLICT (source_key, kind, external_id) DO UPDATE
       SET title          = EXCLUDED.title,
           url            = EXCLUDED.url,
           summary        = COALESCE(EXCLUDED.summary, feed_items.summary),
           published_at   = COALESCE(EXCLUDED.published_at, feed_items.published_at),
           event_start    = COALESCE(EXCLUDED.event_start, feed_items.event_start),
           event_location = COALESCE(EXCLUDED.event_location, feed_items.event_location),
           last_seen_at   = NOW()
     RETURNING id, (xmax = 0) AS inserted`,
    [
      source.label, source.key, kind, item.externalId, item.title, item.url || null,
      item.summary || null, item.publishedAt || null, item.eventStart || null,
      item.eventLocation || null, JSON.stringify(item.raw || {}),
    ]
  );
  return r.rows[0].inserted;
}

// Fetch + store every feed of (a subset of) sources. Returns a summary the caller can render, plus the
// set of (company, kind) pairs that gained new items — so the pipeline only re-summarizes what changed.
export async function runTracker({ sourceKeys } = {}) {
  const sources = sourceKeys?.length ? sourceKeys.map(getSource).filter(Boolean) : SOURCES;
  const summary = { added: 0, feeds: [], errors: [], touched: [] };

  for (const { source, kind, feed } of allFeeds(sources)) {
    let items;
    try {
      items = await getAdapter(feed.adapter).fetchFeed(source, feed);
    } catch (err) {
      console.error(`[commander] fetch failed for ${source.key}/${kind}:`, err?.message);
      summary.errors.push({ source: source.key, kind, message: err?.message || String(err) });
      continue; // leave this feed's stored items untouched
    }
    try {
      let added = 0;
      for (const item of items) {
        if (await upsertItem(source, kind, item)) added++;
      }
      summary.added += added;
      summary.feeds.push({ source: source.key, kind, fetched: items.length, added });
      if (added > 0) summary.touched.push({ company: source.label, kind });
      console.log(`[commander] ${source.key}/${kind}: ${items.length} fetched, ${added} new`);
    } catch (err) {
      console.error(`[commander] store failed for ${source.key}/${kind}:`, err?.message);
      summary.errors.push({ source: source.key, kind, message: err?.message || String(err) });
    }
  }
  return summary;
}
