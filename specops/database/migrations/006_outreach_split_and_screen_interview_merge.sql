-- Pipeline tweak: split outreach into three columns (outreach -> outreach_today -> completed_outreach)
-- so the daily send queue is visible, and merge 'screen' + 'interview' into one 'screen_interview'
-- column (they were too granular to drag between in practice). Idempotent: safe to re-run.

-- 1. Migrate existing screen/interview rows into the merged stage BEFORE tightening the constraint.
--    Both the cards and any board dividers parked in those columns move together.
UPDATE opportunities  SET stage = 'screen_interview' WHERE stage IN ('screen', 'interview');
UPDATE board_dividers SET stage = 'screen_interview' WHERE stage IN ('screen', 'interview');

-- 2. Replace the stage CHECK with the new value set (adds outreach_today / completed_outreach,
--    drops the separate screen / interview, adds the merged screen_interview). Guarded so the chain
--    stays re-runnable: if a FUTURE migration advances rows past this set, this swap is skipped on
--    re-run rather than failing (same pattern as 002). On current/fresh data it applies normally.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM opportunities
     WHERE stage NOT IN ('lead', 'outreach', 'outreach_today', 'completed_outreach',
                         'hm_reply', 'screen_interview', 'offer', 'closed')
  ) THEN
    ALTER TABLE opportunities DROP CONSTRAINT IF EXISTS opportunities_stage_check;
    ALTER TABLE opportunities ADD CONSTRAINT opportunities_stage_check
        CHECK (stage IN ('lead', 'outreach', 'outreach_today', 'completed_outreach',
                         'hm_reply', 'screen_interview', 'offer', 'closed'));
  END IF;
END $$;
