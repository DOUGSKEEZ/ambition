-- meddic schema: campaign engine + the tracker columns on Sniper's people table.
-- Shares the 'sniper' database. Reuses the set_updated_at() trigger fn Sniper already defined.
-- Everything here is idempotent so it can run alongside / after Sniper without conflict.

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Tracker columns meddic owns on `people`. Sniper never writes these; meddic
-- never writes Sniper's identity/enrichment columns. (my_notes is the one shared
-- field — Doug's own notes, editable from both; Sniper recapture preserves it.)
-- ---------------------------------------------------------------------------
ALTER TABLE people ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive'));
ALTER TABLE people ADD COLUMN IF NOT EXISTS hot_cold TEXT
    CHECK (hot_cold IN ('hot', 'warm', 'cold'));
ALTER TABLE people ADD COLUMN IF NOT EXISTS priority_score INTEGER;
ALTER TABLE people ADD COLUMN IF NOT EXISTS next_action_date DATE;
ALTER TABLE people ADD COLUMN IF NOT EXISTS last_action_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- campaigns: reusable skeletons. category is a free label (recruiter/peer/HM are
-- just common quick-picks, not an enum).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS campaigns (
    id         SERIAL PRIMARY KEY,
    name       TEXT NOT NULL,
    category   TEXT,
    goal       TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS campaigns_set_updated_at ON campaigns;
CREATE TRIGGER campaigns_set_updated_at BEFORE UPDATE ON campaigns
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS campaign_steps (
    id                 SERIAL PRIMARY KEY,
    campaign_id        INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    step_order         INTEGER NOT NULL,
    channel            TEXT,
    purpose            TEXT,
    skeleton_text      TEXT,
    default_delay_days INTEGER,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_campaign_steps_campaign ON campaign_steps(campaign_id, step_order);

-- ---------------------------------------------------------------------------
-- person_campaigns: a person's RUN (assignment of a campaign, or bespoke run with
-- campaign_id NULL). One active run per person.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS person_campaigns (
    id           SERIAL PRIMARY KEY,
    person_id    INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    campaign_id  INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
    status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    current_step INTEGER NOT NULL DEFAULT 1,
    started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_person_campaigns_one_active
    ON person_campaigns(person_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_person_campaigns_person ON person_campaigns(person_id);

-- ---------------------------------------------------------------------------
-- person_campaign_steps: the customized copy of each step + send/response tracking.
-- delay_days is copied from campaign_steps.default_delay_days and drives the
-- next_action_date suggestion (deliberate extension of the spec so cadence survives
-- per-person edits).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS person_campaign_steps (
    id                 SERIAL PRIMARY KEY,
    person_campaign_id INTEGER NOT NULL REFERENCES person_campaigns(id) ON DELETE CASCADE,
    step_order         INTEGER NOT NULL,
    channel            TEXT,
    purpose            TEXT,
    customized_text    TEXT,
    delay_days         INTEGER,
    sent               BOOLEAN NOT NULL DEFAULT FALSE,
    sent_at            TIMESTAMPTZ,
    response_received  BOOLEAN NOT NULL DEFAULT FALSE,
    response_at        TIMESTAMPTZ,
    step_notes         TEXT,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS pcs_set_updated_at ON person_campaign_steps;
CREATE TRIGGER pcs_set_updated_at BEFORE UPDATE ON person_campaign_steps
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS idx_pcs_run ON person_campaign_steps(person_campaign_id, step_order);
