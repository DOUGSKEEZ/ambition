-- Sniper schema: companies + people (staging is a status, not a separate table)

-- Auto-update updated_at on row change (clio-board pattern)
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- companies: created/managed only in the review UI
CREATE TABLE IF NOT EXISTS companies (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    tier        TEXT,
    notes       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- people: one row per LinkedIn profile, keyed on linkedin_slug
CREATE TABLE IF NOT EXISTS people (
    id               SERIAL PRIMARY KEY,
    linkedin_slug    TEXT NOT NULL UNIQUE,
    linkedin_url     TEXT,
    company_id       INTEGER REFERENCES companies(id) ON DELETE SET NULL,
    type             TEXT CHECK (type IN ('recruiter', 'peer', 'hiring_manager')),
    priority         INTEGER,

    name             TEXT,
    title            TEXT,
    location         TEXT,
    about            TEXT,
    current_company  TEXT,
    current_title    TEXT,
    current_tenure   TEXT,
    previous_title   TEXT,
    previous_company TEXT,

    photo_path       TEXT,

    ai_summary       TEXT,
    ai_ins           TEXT,
    my_notes         TEXT,

    raw_html         TEXT,

    import_status    TEXT NOT NULL DEFAULT 'staged'
                     CHECK (import_status IN ('staged', 'active', 'rejected')),

    captured_at      TIMESTAMPTZ,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS people_set_updated_at ON people;
CREATE TRIGGER people_set_updated_at
    BEFORE UPDATE ON people
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_people_status ON people(import_status);
CREATE INDEX IF NOT EXISTS idx_people_company ON people(company_id);
