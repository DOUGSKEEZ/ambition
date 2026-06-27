-- Pipeline tweak: add a pre-outreach 'lead' stage (opportunities identified but not started —
-- no HM ID'd yet) and merge 'onsite' into 'interview' (onsite is just the big-deal interview).
-- Idempotent: safe to re-run.

-- 1. Migrate any existing onsite rows into interview BEFORE tightening the constraint.
UPDATE opportunities SET stage = 'interview' WHERE stage = 'onsite';

-- 2. Replace the stage CHECK with this migration's value set — but ONLY if the data still fits it.
--    A later migration (006) advances some rows to stages outside this set (e.g. screen_interview,
--    outreach_today). When the whole chain is re-run end-to-end on already-migrated data, this guard
--    skips the now-stale intermediate constraint instead of failing on those rows; on a fresh DB the
--    data fits this set and it applies normally. This keeps `npm run migrate` re-runnable.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM opportunities
     WHERE stage NOT IN ('lead', 'outreach', 'hm_reply', 'screen', 'interview', 'offer', 'closed')
  ) THEN
    ALTER TABLE opportunities DROP CONSTRAINT IF EXISTS opportunities_stage_check;
    ALTER TABLE opportunities ADD CONSTRAINT opportunities_stage_check
        CHECK (stage IN ('lead', 'outreach', 'hm_reply', 'screen', 'interview', 'offer', 'closed'));
  END IF;
END $$;

-- 3. New opportunities start as a lead (they're added before outreach begins).
ALTER TABLE opportunities ALTER COLUMN stage SET DEFAULT 'lead';
