-- SpecOps: link an opportunity to the UAV job posting it was created from. SpecOps owns
-- opportunities and is the SOLE writer of the link; UAV only reads it. job_postings is UAV-owned
-- but lives in the same shared `sniper` DB. job_postings.id is stable across close/reopen (the UAV
-- tracker upserts the same row), so this FK never dangles. ON DELETE SET NULL: a UAV reset/truncate
-- of job_postings clears the link but KEEPS the opportunity (Doug's curated work survives).
-- Idempotent so it re-runs cleanly. Requires UAV's 001_uav.sql (job_postings) already applied.

ALTER TABLE opportunities
    ADD COLUMN IF NOT EXISTS job_posting_id INTEGER REFERENCES job_postings(id) ON DELETE SET NULL;

-- One opportunity per posting (NULLs are unconstrained via the partial index).
CREATE UNIQUE INDEX IF NOT EXISTS idx_opportunities_job_posting
    ON opportunities(job_posting_id) WHERE job_posting_id IS NOT NULL;
