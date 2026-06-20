-- Pipeline tweak: add a pre-outreach 'lead' stage (opportunities identified but not started —
-- no HM ID'd yet) and merge 'onsite' into 'interview' (onsite is just the big-deal interview).
-- Idempotent: safe to re-run.

-- 1. Migrate any existing onsite rows into interview BEFORE tightening the constraint.
UPDATE opportunities SET stage = 'interview' WHERE stage = 'onsite';

-- 2. Replace the stage CHECK with the new value set (drops 'onsite', adds 'lead').
ALTER TABLE opportunities DROP CONSTRAINT IF EXISTS opportunities_stage_check;
ALTER TABLE opportunities ADD CONSTRAINT opportunities_stage_check
    CHECK (stage IN ('lead', 'outreach', 'hm_reply', 'screen', 'interview', 'offer', 'closed'));

-- 3. New opportunities start as a lead (they're added before outreach begins).
ALTER TABLE opportunities ALTER COLUMN stage SET DEFAULT 'lead';
