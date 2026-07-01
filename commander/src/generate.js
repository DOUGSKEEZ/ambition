// AI generation over stored data: the per-feed "Today's summary" digest lines and the SITREP
// narratives. Shared by the scheduled pipeline (regenerate everything) and the on-demand refresh
// routes (regenerate a scope). All writes are append-only (feed_digests / sitreps keep history); the
// UI reads the LATEST row per (company,kind) / scope. AI failures are swallowed by ai.js → we simply
// skip inserting, leaving the previous latest digest/sitrep in place.
import { SOURCES } from './sources.js';
import { query } from './db.js';
import { summarizeFeed, writeSitrep } from './ai.js';
import { getCompanyFacts, getAllFacts } from './rollup.js';

const LOOKBACK_DAYS = Number(process.env.FEED_LOOKBACK_DAYS) || 14;
const DIGEST_ITEMS = Number(process.env.DIGEST_ITEM_COUNT) || 6;

// The most recent items in one feed (undated items sort by when we first saw them).
async function recentItems(company, kind, limit = DIGEST_ITEMS) {
  const r = await query(
    `SELECT title, url, summary, published_at
       FROM feed_items
      WHERE company = $1 AND kind = $2
        AND COALESCE(published_at, first_seen_at) > NOW() - make_interval(days => $3::int)
      ORDER BY COALESCE(published_at, first_seen_at) DESC
      LIMIT $4`,
    [company, kind, LOOKBACK_DAYS, limit]
  );
  return r.rows;
}

// Optional grounding for a financial digest: Doug's pasted Bloomberg/Morningstar brief.
async function financialSeed(company) {
  try {
    const r = await query(
      `SELECT body FROM company_intel WHERE company = $1 AND section = 'financial_brief' LIMIT 1`,
      [company]
    );
    return r.rows[0]?.body || null;
  } catch {
    return null;
  }
}

// Regenerate the digest line for one (company, kind). No items in window → no new digest.
export async function regenerateDigest(company, kind) {
  const items = await recentItems(company, kind);
  if (!items.length) return null;
  const seed = kind === 'financial' ? await financialSeed(company) : null;
  const res = await summarizeFeed({ company, kind, items, seed });
  if (!res) return null;
  await query(
    `INSERT INTO feed_digests (company, kind, summary, item_count, provider) VALUES ($1, $2, $3, $4, $5)`,
    [company, kind, res.summary, items.length, res.provider]
  );
  return res.summary;
}

// Regenerate digests for the given sources (default: all), across each source's configured kinds.
export async function regenerateDigests(sources = SOURCES) {
  for (const source of sources) {
    for (const kind of Object.keys(source.feeds || {})) {
      try {
        await regenerateDigest(source.label, kind);
      } catch (err) {
        console.warn(`[generate] digest ${source.label}/${kind}:`, err.message);
      }
    }
  }
}

// Regenerate one SITREP. scope='all' → whole-campaign; else a company name.
export async function regenerateSitrep(scope) {
  const names = SOURCES.map((s) => s.label);
  const facts = scope === 'all' ? await getAllFacts(names) : await getCompanyFacts(scope);
  const res = await writeSitrep({ scope, facts });
  if (!res) return null;
  await query(
    `INSERT INTO sitreps (scope, narrative, facts, provider) VALUES ($1, $2, $3::jsonb, $4)`,
    [scope, res.narrative, JSON.stringify(facts), res.provider]
  );
  return res.narrative;
}

// Regenerate every SITREP: the campaign-wide one plus one per company.
export async function regenerateAllSitreps() {
  await regenerateSitrep('all');
  for (const source of SOURCES) {
    try {
      await regenerateSitrep(source.label);
    } catch (err) {
      console.warn(`[generate] sitrep ${source.label}:`, err.message);
    }
  }
}
