-- Anti-Tank schema: interview prep per SpecOps opportunity — question bank + drill stats,
-- checklists (reusable templates copied into per-opportunity instances, Meddic-style), a global
-- STAR-story library, opportunity-scoped briefing sections, and an append-only prep-pack import
-- log. Lives in the shared `sniper` database. Anti-Tank OWNS the eight tables below and only READS
-- the other apps' tables (opportunities/opportunity_contacts/companies/people/company_intel/
-- job_postings) — it never writes them. Reuses the set_updated_at() trigger fn Sniper already
-- defines (do NOT redefine it). Idempotent so it can run alongside the other apps' migrations.
--
-- Everything anchors on opportunities.id (SpecOps-owned). ON DELETE CASCADE means deleting an
-- opportunity in SpecOps destroys its prep — accepted: SpecOps closes opportunities (stage='closed')
-- rather than deleting them, and prep for a deleted opportunity is worthless anyway.

-- ---------------------------------------------------------------------------
-- prep_questions: the per-opportunity question bank. Rows arrive from a Claude Code prep pack
-- (source='claude') or by hand (source='manual'). Drill stats live denormalized on the row — a
-- personal tool needs "last grade + counts" (weakest-first ordering), not a drill-log table.
-- Questions are archived, never deleted (suite ethos); mode='replace' pack imports archive the
-- previous claude-sourced set, keeping their history.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS prep_questions (
    id              SERIAL PRIMARY KEY,
    opportunity_id  INTEGER NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
    question        TEXT    NOT NULL,
    category        TEXT    NOT NULL DEFAULT 'general'
                    CHECK (category IN ('behavioral','technical','company','role','logistics','curveball','general')),
    source          TEXT    NOT NULL DEFAULT 'manual' CHECK (source IN ('claude','manual')),
    my_answer_md    TEXT,                            -- prepared answer / talking points (markdown)
    sort_order      INTEGER NOT NULL DEFAULT 0,
    times_drilled   INTEGER NOT NULL DEFAULT 0,
    nailed_count    INTEGER NOT NULL DEFAULT 0,
    shaky_count     INTEGER NOT NULL DEFAULT 0,
    last_grade      TEXT    CHECK (last_grade IN ('nailed','shaky')),
    last_drilled_at TIMESTAMPTZ,
    archived        BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS prep_questions_set_updated_at ON prep_questions;
CREATE TRIGGER prep_questions_set_updated_at BEFORE UPDATE ON prep_questions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS idx_prep_questions_opp ON prep_questions(opportunity_id, archived, sort_order);

-- ---------------------------------------------------------------------------
-- checklist_templates + checklist_template_items: reusable checklist skeletons. Instantiating one
-- COPIES its items into opportunity_checklist_items (the Meddic campaign_steps →
-- person_campaign_steps pattern); instance edits never touch the template.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS checklist_templates (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS checklist_templates_set_updated_at ON checklist_templates;
CREATE TRIGGER checklist_templates_set_updated_at BEFORE UPDATE ON checklist_templates
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS checklist_template_items (
    id          SERIAL PRIMARY KEY,
    template_id INTEGER NOT NULL REFERENCES checklist_templates(id) ON DELETE CASCADE,
    label       TEXT    NOT NULL,
    phase       TEXT    NOT NULL DEFAULT 'before' CHECK (phase IN ('before','day_of','after')),
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_checklist_template_items ON checklist_template_items(template_id, sort_order);

-- ---------------------------------------------------------------------------
-- opportunity_checklist_items: the per-opportunity instances. source_template_id records
-- provenance (NULL = added by hand or via a prep pack); SET NULL so deleting a template never
-- touches live prep. Instance items may be hard-deleted — they're cheap and re-instantiable.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS opportunity_checklist_items (
    id                 SERIAL PRIMARY KEY,
    opportunity_id     INTEGER NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
    label              TEXT    NOT NULL,
    phase              TEXT    NOT NULL DEFAULT 'before' CHECK (phase IN ('before','day_of','after')),
    sort_order         INTEGER NOT NULL DEFAULT 0,
    done               BOOLEAN NOT NULL DEFAULT FALSE,
    done_at            TIMESTAMPTZ,
    note               TEXT,
    source_template_id INTEGER REFERENCES checklist_templates(id) ON DELETE SET NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS opportunity_checklist_items_set_updated_at ON opportunity_checklist_items;
CREATE TRIGGER opportunity_checklist_items_set_updated_at BEFORE UPDATE ON opportunity_checklist_items
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS idx_opp_checklist_opp ON opportunity_checklist_items(opportunity_id, phase, sort_order);

-- ---------------------------------------------------------------------------
-- stories: the GLOBAL STAR-story library — Doug's best material, written once, linked to questions
-- across many interviews. STAR fields are all optional; body_md is the freeform alternative when
-- STAR doesn't fit. Archived, never deleted.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stories (
    id           SERIAL PRIMARY KEY,
    title        TEXT NOT NULL,
    situation_md TEXT,
    task_md      TEXT,
    action_md    TEXT,
    result_md    TEXT,
    body_md      TEXT,
    tags         TEXT[] NOT NULL DEFAULT '{}',
    archived     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS stories_set_updated_at ON stories;
CREATE TRIGGER stories_set_updated_at BEFORE UPDATE ON stories
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- question_stories: M:N — which stories answer which questions.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS question_stories (
    question_id INTEGER NOT NULL REFERENCES prep_questions(id) ON DELETE CASCADE,
    story_id    INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    PRIMARY KEY (question_id, story_id)
);

-- ---------------------------------------------------------------------------
-- opportunity_briefs: Anti-Tank's OWN briefing sections (the rest of the Briefing view is read
-- live cross-app). Section-keyed exactly like Commander's company_intel (company, section) —
-- 'angle' | 'questions_for_them' | 'logistics' | 'notes' | ... — so new blocks need no migration.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS opportunity_briefs (
    id             SERIAL PRIMARY KEY,
    opportunity_id INTEGER NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
    section        TEXT    NOT NULL,
    title          TEXT,
    body_md        TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (opportunity_id, section)
);
DROP TRIGGER IF EXISTS opportunity_briefs_set_updated_at ON opportunity_briefs;
CREATE TRIGGER opportunity_briefs_set_updated_at BEFORE UPDATE ON opportunity_briefs
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- prep_packs: append-only import log. Each Claude Code content pass POSTs a pack; the exact
-- payload is kept for forensics/replay, plus what the import actually did.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS prep_packs (
    id              SERIAL PRIMARY KEY,
    opportunity_id  INTEGER NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
    payload         JSONB   NOT NULL,
    mode            TEXT    NOT NULL DEFAULT 'append' CHECK (mode IN ('append','replace')),
    questions_added INTEGER NOT NULL DEFAULT 0,
    checklist_added INTEGER NOT NULL DEFAULT 0,
    stories_added   INTEGER NOT NULL DEFAULT 0,
    briefs_updated  INTEGER NOT NULL DEFAULT 0,
    imported_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_prep_packs_opp ON prep_packs(opportunity_id, imported_at DESC);

-- ---------------------------------------------------------------------------
-- Seed the default "Screen prep" checklist template (idempotent: items only insert while the
-- template is empty, so a re-run — or a hand-edited template — is never clobbered).
-- ---------------------------------------------------------------------------
INSERT INTO checklist_templates (name)
SELECT 'Screen prep'
WHERE NOT EXISTS (SELECT 1 FROM checklist_templates WHERE name = 'Screen prep');

INSERT INTO checklist_template_items (template_id, label, phase, sort_order)
SELECT t.id, v.label, v.phase, v.sort_order
FROM checklist_templates t,
     (VALUES
        ('Re-read the job posting end-to-end',                          'before', 1),
        ('Review each interviewer''s background (People section)',      'before', 2),
        ('Read the company intel — mission / values / interview guide', 'before', 3),
        ('Map 3 proof points to what this role needs (My Angle)',       'before', 4),
        ('Draft 3 questions to ask them',                               'before', 5),
        ('Prepare the comp / expectations answer',                      'before', 6),
        ('Drill the question bank until mostly nailed',                 'before', 7),
        ('Test video / audio / interview link 15 min early',            'day_of', 8),
        ('Water, notebook, resume + JD in view',                        'day_of', 9),
        ('Re-read My Angle one last time',                              'day_of', 10),
        ('Write a debrief — what they asked, what landed, what to fix', 'after',  11),
        ('Send the thank-you / follow-up within 24h',                   'after',  12)
     ) AS v(label, phase, sort_order)
WHERE t.name = 'Screen prep'
  AND NOT EXISTS (SELECT 1 FROM checklist_template_items i WHERE i.template_id = t.id);
