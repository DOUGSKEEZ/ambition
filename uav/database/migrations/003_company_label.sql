-- UAV: denormalize the human company label onto each posting so OTHER apps (SpecOps) can map a
-- company (matched by companies.name) to its postings without knowing UAV's SOURCES config.
-- Populated at ingest from SOURCES[].label (see tracker.js diffSource upsert). Idempotent.

ALTER TABLE job_postings ADD COLUMN IF NOT EXISTS company TEXT;

-- One-time backfill for the current sources. Open rows also self-heal on the next tracker run
-- (the upsert now writes company=EXCLUDED.company); closed rows that never re-upsert keep this
-- backfilled value. New sources added later are covered automatically by the tracker.
UPDATE job_postings SET company = CASE source
    WHEN 'anthropic' THEN 'Anthropic'
    WHEN 'openai'    THEN 'OpenAI'
    WHEN 'cursor'    THEN 'Cursor'
    ELSE company END
WHERE company IS NULL;
