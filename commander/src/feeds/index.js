// Feed-adapter dispatch. Each feed config names an `adapter`; this maps it to a module exporting
// `fetchFeed(source, feed) => FeedItem[]`. Adding a company is a config edit in sources.js; adding a
// NEW way to fetch (a bespoke parser for a stubborn board) is a new module registered here.
import * as rss from './rss.js';
import * as html from './html.js';

export const ADAPTERS = { rss, html };

export function getAdapter(name) {
  const a = ADAPTERS[name];
  if (!a) throw new Error(`unknown feed adapter: ${name}`);
  return a;
}
