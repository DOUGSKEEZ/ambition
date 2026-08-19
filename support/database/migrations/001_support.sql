-- Support: personal network (referrals, recommendations, staying in touch).
-- One row per person; linkedin_slug links them to Sniper's people table at read time
-- (LEFT JOIN), so a manual add and a later capture merge without any write-time sync.
-- set_updated_at() is defined in Sniper's 001 (shared DB) — redefined here identically
-- so this migration is self-sufficient on a fresh database.

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS network_people (
    id             SERIAL PRIMARY KEY,
    linkedin_slug  TEXT UNIQUE,          -- NULL for manual adds without a URL (multiple NULLs allowed)
    name           TEXT,                 -- fallback display name when not linked to people
    note           TEXT,                 -- the one freeform NOTES field (contact info lives here too)
    action         TEXT,                 -- single current action for this person
    action_channel TEXT CHECK (action_channel IN ('linkedin', 'text', 'call', 'email')),
    action_done    BOOLEAN NOT NULL DEFAULT FALSE,
    recc_flag      BOOLEAN NOT NULL DEFAULT FALSE,  -- LinkedIn recommendation owed
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS network_people_set_updated_at ON network_people;
CREATE TRIGGER network_people_set_updated_at
    BEFORE UPDATE ON network_people
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
