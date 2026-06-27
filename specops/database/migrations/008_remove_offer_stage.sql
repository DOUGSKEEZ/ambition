-- Remove the 'offer' stage column from the pipeline. Offer was rarely used as a distinct
-- column, so it's folded back into 'screen_interview' (the adjacent active stage) and dropped
-- from the stage set. Idempotent: safe to re-run.

-- 1. Re-home any cards / board dividers parked in 'offer' BEFORE tightening the constraint.
UPDATE opportunities  SET stage = 'screen_interview' WHERE stage = 'offer';
UPDATE board_dividers SET stage = 'screen_interview' WHERE stage = 'offer';

-- 2. Replace the stage CHECK with the offer-less value set. Guarded so the chain stays
--    re-runnable: if a FUTURE migration advances rows past this set, this swap is skipped on
--    re-run rather than failing (same pattern as 002 / 006).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM opportunities
     WHERE stage NOT IN ('lead', 'outreach', 'outreach_today', 'completed_outreach',
                         'hm_reply', 'screen_interview', 'closed')
  ) THEN
    ALTER TABLE opportunities DROP CONSTRAINT IF EXISTS opportunities_stage_check;
    ALTER TABLE opportunities ADD CONSTRAINT opportunities_stage_check
        CHECK (stage IN ('lead', 'outreach', 'outreach_today', 'completed_outreach',
                         'hm_reply', 'screen_interview', 'closed'));
  END IF;
END $$;
