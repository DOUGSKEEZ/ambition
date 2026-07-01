-- Commander schema: strategic company intelligence over the target companies (Anthropic, OpenAI,
-- Cursor, Google, NVIDIA, Arize, ...). Lives in the shared `sniper` database. Commander OWNS the four
-- tables below and only READS the other apps' tables (people/opportunities/job_postings) for the
-- SITREP rollup — it never writes them. Reuses the set_updated_at() trigger fn Sniper already defines
-- (do NOT redefine it). Idempotent so it can run alongside the other apps' migrations.
--
-- The canonical company list stays the sniper-owned `companies` table; Commander is config-driven
-- (src/sources.js) and denormalizes a `company` label (matching companies.name) onto its rows so the
-- UI and the cross-app rollup can join by name, exactly like UAV's job_postings.company.

-- ---------------------------------------------------------------------------
-- feed_items: one row per (source_key, kind, external_id). The aggregated inbound signal — company
-- news, blog posts, events, and financial briefs — kept as SEPARATE feeds via the `kind` column
-- (never merged into one noisy stream). Append-on-new; a re-fetch of the same item just bumps
-- last_seen_at. We store lightweight metadata + an optional AI per-item summary and link OUT for the
-- body (raw article text is never copied). `event_*` columns are populated for kind='event' only.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS feed_items (
    id             SERIAL PRIMARY KEY,
    company        TEXT    NOT NULL,           -- SOURCES[].label, matches companies.name (e.g. 'Anthropic')
    source_key     TEXT    NOT NULL,           -- SOURCES[].key, e.g. 'anthropic'
    kind           TEXT    NOT NULL CHECK (kind IN ('news', 'blog', 'event', 'financial')),
    external_id    TEXT    NOT NULL,           -- stable feed guid, else the item URL (dedupe key)
    title          TEXT    NOT NULL,
    url            TEXT,                        -- link OUT to the full item
    summary        TEXT,                        -- source-provided description/excerpt (raw)
    ai_summary     TEXT,                        -- optional qwen3 one-line summary of this item
    published_at   TIMESTAMPTZ,                 -- item date (may be NULL, e.g. undated Arize posts)
    event_start    TIMESTAMPTZ,                 -- kind='event': when it happens
    event_location TEXT,                        -- kind='event': where
    raw            JSONB,                       -- full normalized source object, for forensics
    is_read        BOOLEAN NOT NULL DEFAULT FALSE,
    first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (source_key, kind, external_id)      -- natural key; upsert target
);
DROP TRIGGER IF EXISTS feed_items_set_updated_at ON feed_items;
CREATE TRIGGER feed_items_set_updated_at BEFORE UPDATE ON feed_items
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS idx_feed_items_company_kind ON feed_items(company, kind, published_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_feed_items_source ON feed_items(source_key);

-- ---------------------------------------------------------------------------
-- feed_digests: the "Today's summary:" line shown atop each feed. One append-only row per
-- (company, kind) generation; the UI reads the LATEST per pair. History is retained so a digest is
-- never destroyed by a re-run (feeds are appended, not overwritten — Doug's rule).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS feed_digests (
    id           SERIAL PRIMARY KEY,
    company      TEXT    NOT NULL,
    kind         TEXT    NOT NULL CHECK (kind IN ('news', 'blog', 'event', 'financial')),
    summary      TEXT    NOT NULL,             -- qwen3 1-2 sentence digest of the recent items
    item_count   INTEGER NOT NULL DEFAULT 0,   -- how many items were summarized
    provider     TEXT,                          -- 'local' or 'anthropic'
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_feed_digests_latest ON feed_digests(company, kind, generated_at DESC);

-- ---------------------------------------------------------------------------
-- company_intel: curated, editable per-company reference — mission, values, hiring/AI policy,
-- interview guides (e.g. OpenAI's interview guide, Anthropic's candidate-AI-guidance), a financial
-- brief, and Doug's own notes. One row per (company, section); edited in the UI. Markdown body.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS company_intel (
    id          SERIAL PRIMARY KEY,
    company     TEXT    NOT NULL,              -- matches companies.name
    section     TEXT    NOT NULL,              -- 'mission'|'values'|'policy'|'interview_guide'|'financial_brief'|'notes'|...
    title       TEXT,                           -- optional display heading
    body        TEXT,                           -- markdown
    source_url  TEXT,                           -- where it came from (if seeded from a page)
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (company, section)
);
DROP TRIGGER IF EXISTS company_intel_set_updated_at ON company_intel;
CREATE TRIGGER company_intel_set_updated_at BEFORE UPDATE ON company_intel
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS idx_company_intel_company ON company_intel(company);

-- ---------------------------------------------------------------------------
-- sitreps: append-only AI rollup narratives. scope = 'all' (whole-campaign, shown on the dashboard)
-- or a company name (shown on that company's page). `facts` keeps the structured inputs fed to the
-- model (read-only cross-app aggregates) for transparency. The UI reads the LATEST per scope.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sitreps (
    id           SERIAL PRIMARY KEY,
    scope        TEXT    NOT NULL,             -- 'all' or a company name (matches companies.name)
    narrative    TEXT    NOT NULL,
    facts        JSONB,                         -- the aggregates handed to the model
    provider     TEXT,                          -- 'local' or 'anthropic'
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sitreps_latest ON sitreps(scope, generated_at DESC);
