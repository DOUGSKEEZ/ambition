-- SpecOps schema: the Opportunity entity (a role Doug is pursuing) + its target contacts.
-- Lives in the shared `sniper` database; references companies + people (Sniper-owned) and
-- reuses the set_updated_at() trigger fn Sniper/Medic already define. Idempotent so it can
-- run alongside the other apps' migrations.

-- ---------------------------------------------------------------------------
-- opportunities: one row per role Doug is pursuing. The company is the only hard anchor —
-- a role may not be publicly listed (role_title is a freeform placeholder, job_posting_url
-- is optional) and the hiring manager may be unknown/guessed (tracked in opportunity_contacts).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS opportunities (
    id               SERIAL PRIMARY KEY,
    -- ON DELETE CASCADE: deleting a target company in Sniper also deletes its opportunities here
    -- (and their contact links). Deliberate — you wouldn't delete a company you're still pursuing.
    company_id       INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    role_title       TEXT,                 -- freeform; a placeholder is fine when nothing is posted
    job_posting_url  TEXT,                 -- optional — many target roles aren't publicly listed
    stage            TEXT NOT NULL DEFAULT 'outreach'
                     CHECK (stage IN ('outreach', 'hm_reply', 'screen', 'interview', 'onsite', 'offer', 'closed')),
    outcome          TEXT CHECK (outcome IN ('accepted', 'rejected', 'withdrawn')),  -- only when closed
    -- an outcome only makes sense on a closed opportunity; the app also clears it on re-open
    CONSTRAINT outcome_only_when_closed CHECK (stage = 'closed' OR outcome IS NULL),
    comp_range       TEXT,                 -- freeform ("$200–240k", "TBD")
    location         TEXT,                 -- freeform ("SF", "NY", "Remote")
    first_message_at DATE,                 -- first outreach to an HM on this opportunity
    first_reply_at   DATE,                 -- first real reply from an HM
    notes            TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS opportunities_set_updated_at ON opportunities;
CREATE TRIGGER opportunities_set_updated_at BEFORE UPDATE ON opportunities
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS idx_opportunities_company ON opportunities(company_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_stage ON opportunities(stage);

-- ---------------------------------------------------------------------------
-- opportunity_contacts: an opportunity's target contacts (many-to-many with people). Doug may
-- be targeting several HMs per role and often guessing; is_primary marks his main bet. `role`
-- is a freeform label (hiring manager / recruiter / referrer / champion). Deleting either side
-- removes the link, not the opportunity or the person.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS opportunity_contacts (
    opportunity_id INTEGER NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
    person_id      INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    role           TEXT,
    is_primary     BOOLEAN NOT NULL DEFAULT FALSE,
    added_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (opportunity_id, person_id)
);
CREATE INDEX IF NOT EXISTS idx_opportunity_contacts_person ON opportunity_contacts(person_id);
-- At most one primary contact per opportunity.
CREATE UNIQUE INDEX IF NOT EXISTS idx_opportunity_contacts_one_primary
    ON opportunity_contacts(opportunity_id) WHERE is_primary;
