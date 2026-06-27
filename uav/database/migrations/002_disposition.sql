-- UAV: add a user-set DISPOSITION to job_postings — separate from the open/closed board state and
-- from the application tracking. Lets Doug set a role Active (default, on the radar), Rejected, or
-- Not interested; the UI minimizes the latter two into a "Set aside" section. Idempotent.

ALTER TABLE job_postings
    ADD COLUMN IF NOT EXISTS disposition TEXT NOT NULL DEFAULT 'active'
    CHECK (disposition IN ('active', 'rejected', 'not_interested'));

-- Surface dismissed roles fast (most are 'active').
CREATE INDEX IF NOT EXISTS idx_job_postings_disposition ON job_postings(disposition) WHERE disposition <> 'active';

-- Extend the activity log's event_type CHECK to record disposition changes. The original inline
-- constraint is auto-named uav_events_event_type_check; drop + re-add with the new values.
ALTER TABLE uav_events DROP CONSTRAINT IF EXISTS uav_events_event_type_check;
ALTER TABLE uav_events ADD CONSTRAINT uav_events_event_type_check
    CHECK (event_type IN ('opened', 'closed', 'reopened', 'applied', 'reapplied',
                          'rejected', 'not_interested', 'reactivated'));
