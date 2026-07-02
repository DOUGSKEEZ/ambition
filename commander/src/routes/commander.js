// Commander HTTP API. Read endpoints serve the dashboard + per-company view from the stored feed
// items / digests / sitreps / intel; write endpoints run the tracker on demand, regenerate a SITREP,
// edit curated intel, and toggle read state. All JSON.
import { Router } from 'express';
import { SOURCES, getSource, KINDS } from '../sources.js';
import { query } from '../db.js';
import { runTracker } from '../tracker.js';
import { regenerateDigests, regenerateSitrep, regenerateAllSitreps } from '../generate.js';
import { getCompanyFacts } from '../rollup.js';

const router = Router();

// Public shape of a source config (no internal fields the client doesn't need).
const publicSource = (s) => ({
  key: s.key, label: s.label, profile: s.profile, homeUrl: s.homeUrl,
  xListUrl: s.xListUrl || null, links: s.links || [],
  kinds: Object.keys(s.feeds || {}),
  // per-feed column-title overrides (e.g. OpenAI news → "Company")
  kindLabels: Object.fromEntries(
    Object.entries(s.feeds || {}).filter(([, f]) => f.label).map(([k, f]) => [k, f.label])
  ),
});

// --- Latest-per-group helpers (DISTINCT ON reads the newest row per group) ---
async function latestDigests() {
  const r = await query(
    `SELECT DISTINCT ON (company, kind) company, kind, summary, item_count, provider, generated_at
       FROM feed_digests ORDER BY company, kind, generated_at DESC`
  );
  return r.rows;
}
async function latestHeadlines(perFeed = 2) {
  const r = await query(
    `SELECT company, kind, title, url, published_at, first_seen_at FROM (
       SELECT company, kind, title, url, published_at, first_seen_at,
              ROW_NUMBER() OVER (PARTITION BY company, kind
                                 ORDER BY COALESCE(published_at, first_seen_at) DESC) AS rn
       FROM feed_items
     ) t WHERE rn <= $1
     ORDER BY company, kind, COALESCE(published_at, first_seen_at) DESC`,
    [perFeed]
  );
  return r.rows;
}
async function latestSitrep(scope) {
  const r = await query(
    `SELECT scope, narrative, facts, provider, generated_at
       FROM sitreps WHERE scope = $1 ORDER BY generated_at DESC LIMIT 1`,
    [scope]
  );
  return r.rows[0] || null;
}

// GET /api/companies — dashboard: config + latest digest + top headlines per feed + counts +
// the deterministic action flags (rendered as chips — no LLM in the hot path) + campaign SITREP.
router.get('/companies', async (_req, res) => {
  try {
    const [digests, headlines, counts, sitrep] = await Promise.all([
      latestDigests(),
      latestHeadlines(2),
      query(`SELECT company, COUNT(*)::int total, COUNT(*) FILTER (WHERE NOT is_read)::int unread FROM feed_items GROUP BY company`),
      latestSitrep('all'),
    ]);
    const byCompany = (rows) => rows.reduce((m, r) => ((m[r.company] ||= {})[r.kind] = r, m), {});
    const groupHeadlines = (rows) => rows.reduce((m, r) => (((m[r.company] ||= {})[r.kind] ||= []).push(r), m), {});
    const dg = byCompany(digests);
    const hl = groupHeadlines(headlines);
    const cnt = counts.rows.reduce((m, r) => ((m[r.company] = r), m), {});
    const facts = await Promise.all(SOURCES.map((s) => getCompanyFacts(s.label, { appLimit: s.appLimit })));

    const companies = SOURCES.map((s, i) => ({
      ...publicSource(s),
      company_id: facts[i].company_id,
      digests: dg[s.label] || {},
      headlines: hl[s.label] || {},
      counts: cnt[s.label] || { total: 0, unread: 0 },
      actions: facts[i].actions,
    }));
    res.json({ companies, sitrep });
  } catch (err) {
    console.error('[GET /companies]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/company/:key — full view for one company.
router.get('/company/:key', async (req, res) => {
  const source = getSource(req.params.key);
  if (!source) return res.status(404).json({ error: 'unknown company' });
  try {
    const kinds = Object.keys(source.feeds || {});
    const feeds = {};
    for (const kind of kinds) {
      const items = await query(
        `SELECT id, title, url, summary, ai_summary, published_at, event_start, event_location, is_read
           FROM feed_items WHERE company = $1 AND kind = $2
          ORDER BY COALESCE(published_at, first_seen_at) DESC LIMIT 40`,
        [source.label, kind]
      );
      const digest = await query(
        `SELECT summary, generated_at FROM feed_digests WHERE company = $1 AND kind = $2 ORDER BY generated_at DESC LIMIT 1`,
        [source.label, kind]
      );
      feeds[kind] = { items: items.rows, digest: digest.rows[0] || null };
    }
    const intel = await query(
      `SELECT section, title, body, source_url, updated_at FROM company_intel WHERE company = $1 ORDER BY section`,
      [source.label]
    );
    const facts = await getCompanyFacts(source.label, { appLimit: source.appLimit });
    res.json({
      source: publicSource(source),
      company_id: facts.company_id,
      actions: facts.actions,
      intelDocs: source.intelDocs || [],
      feeds,
      intel: intel.rows,
      sitrep: await latestSitrep(source.label),
    });
  } catch (err) {
    console.error('[GET /company/:key]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/feed?company=&kind=&limit= — raw items for one feed.
router.get('/feed', async (req, res) => {
  const { company, kind } = req.query;
  const limit = Math.min(Number(req.query.limit) || 40, 200);
  if (!company || !KINDS.includes(kind)) return res.status(400).json({ error: 'company and a valid kind required' });
  try {
    const r = await query(
      `SELECT id, title, url, summary, ai_summary, published_at, event_start, event_location, is_read
         FROM feed_items WHERE company = $1 AND kind = $2
        ORDER BY COALESCE(published_at, first_seen_at) DESC LIMIT $3`,
      [company, kind, limit]
    );
    res.json({ items: r.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/refresh?company= — run the tracker now (+ regenerate digests & SITREPs). No email.
router.post('/refresh', async (req, res) => {
  const key = req.query.company;
  const source = key ? getSource(key) : null;
  if (key && !source) return res.status(404).json({ error: 'unknown company' });
  try {
    const summary = await runTracker(source ? { sourceKeys: [source.key] } : {});
    await regenerateDigests(source ? [source] : SOURCES);
    if (source) {
      await regenerateSitrep(source.label);
      await regenerateSitrep('all');
    } else {
      await regenerateAllSitreps();
    }
    res.json(summary);
  } catch (err) {
    console.error('[POST /refresh]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sitrep/refresh?scope= — regenerate a single SITREP (scope='all' or a company name).
router.post('/sitrep/refresh', async (req, res) => {
  const scope = req.query.scope || 'all';
  if (scope !== 'all' && !SOURCES.some((s) => s.label === scope)) return res.status(400).json({ error: 'unknown scope' });
  try {
    const narrative = await regenerateSitrep(scope);
    res.json({ scope, narrative, sitrep: await latestSitrep(scope) });
  } catch (err) {
    console.error('[POST /sitrep/refresh]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sitrep?scope= — latest narrative for a scope, plus the facts behind it.
router.get('/sitrep', async (req, res) => {
  const scope = req.query.scope || 'all';
  const source = SOURCES.find((s) => s.label === scope);
  try {
    res.json({
      sitrep: await latestSitrep(scope),
      facts: source ? await getCompanyFacts(source.label, { appLimit: source.appLimit }) : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/intel/:company/:section — upsert one curated intel section.
router.put('/intel/:company/:section', async (req, res) => {
  const { company, section } = req.params;
  const { title, body, source_url } = req.body || {};
  if (!SOURCES.some((s) => s.label === company)) return res.status(404).json({ error: 'unknown company' });
  if (typeof body !== 'string') return res.status(400).json({ error: 'body must be a string' });
  try {
    const r = await query(
      `INSERT INTO company_intel (company, section, title, body, source_url) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (company, section) DO UPDATE
         SET title = EXCLUDED.title, body = EXCLUDED.body, source_url = EXCLUDED.source_url
       RETURNING section, title, body, source_url, updated_at`,
      [company, section, title || null, body, source_url || null]
    );
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/feed/:id/read — set read state ({read:true|false}, default true).
router.post('/feed/:id/read', async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad id' });
  const read = req.body?.read !== false;
  try {
    const r = await query(`UPDATE feed_items SET is_read = $2 WHERE id = $1 RETURNING id, is_read`, [id, read]);
    if (!r.rows.length) return res.status(404).json({ error: 'not found' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
