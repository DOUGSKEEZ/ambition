-- UAV schema: tracks job postings from foundational-model companies' job boards (Anthropic,
-- OpenAI, ...). Lives in the shared `sniper` database. UAV OWNS job_postings + uav_events and
-- references NO other app's tables. Reuses the set_updated_at() trigger fn Sniper already defines
-- (do NOT redefine it). Idempotent so it can run alongside the other apps' migrations.

-- ---------------------------------------------------------------------------
-- job_postings: one row per (source, job_id). The "current known state" of every posting we have
-- ever matched. closed_at IS NULL means the role is currently open + matching; a non-null closed_at
-- means it was seen before but is no longer on the board (or no longer matches the filter). A role
-- that comes back reuses the same row (closed_at reset to NULL) so identity — and the application
-- history below — stays stable across cycles.
--
-- The provider adapters normalize every board into a common shape; `groups` holds the normalized
-- [{type,id?,name}] tags (department/office/team/location) and `raw` keeps the full source object.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS job_postings (
    id                SERIAL PRIMARY KEY,
    source            TEXT    NOT NULL,            -- SOURCES[].key, e.g. 'anthropic'
    job_id            TEXT    NOT NULL,            -- board's job id, stored as text (ids are large/opaque)
    title             TEXT    NOT NULL,
    url               TEXT,                        -- link to the posting
    location          TEXT,                        -- freeform display location
    groups            JSONB   NOT NULL DEFAULT '[]'::jsonb,  -- normalized [{type,id?,name}, ...]
    raw               JSONB,                       -- full source job object, for forensics/future fields
    first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),    -- first time this role matched
    last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),    -- most recent cycle it was present+matching
    closed_at         TIMESTAMPTZ,                 -- NULL = open; set when it drops off the board

    -- application tracking + aging timer (set ONLY by the apply/unapply API, never by the tracker,
    -- so a re-fetch can't wipe your "applied" state).
    applied_at        TIMESTAMPTZ,                 -- first application
    last_applied_at   TIMESTAMPTZ,                 -- most recent (re)application — drives the aging timer
    application_count INTEGER NOT NULL DEFAULT 0,

    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (source, job_id)                        -- natural key; upsert target
);
DROP TRIGGER IF EXISTS job_postings_set_updated_at ON job_postings;
CREATE TRIGGER job_postings_set_updated_at BEFORE UPDATE ON job_postings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS idx_job_postings_source ON job_postings(source);
-- Fast "currently open" lookups for the radar (partial over the common filter).
CREATE INDEX IF NOT EXISTS idx_job_postings_open ON job_postings(source) WHERE closed_at IS NULL;
-- Fast "due for re-apply" scan (only applied rows matter).
CREATE INDEX IF NOT EXISTS idx_job_postings_applied ON job_postings(last_applied_at) WHERE last_applied_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- uav_events: an append-only diff/activity log. Each cycle that changes a posting's open/closed
-- state writes a row; the apply/unapply API writes applied/reapplied rows. Powers the UI history
-- panel and the digest email. Kept separate from job_postings (with a denormalized snapshot) so
-- history renders without a join and survives a posting being reopened/overwritten.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uav_events (
    id          SERIAL PRIMARY KEY,
    posting_id  INTEGER NOT NULL REFERENCES job_postings(id) ON DELETE CASCADE,
    source      TEXT    NOT NULL,            -- denormalized for cheap filtering/display
    job_id      TEXT    NOT NULL,
    title       TEXT    NOT NULL,            -- snapshot of title at event time
    url         TEXT,
    location    TEXT,
    event_type  TEXT    NOT NULL CHECK (event_type IN ('opened', 'closed', 'reopened', 'applied', 'reapplied')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_uav_events_created ON uav_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_uav_events_posting ON uav_events(posting_id);
