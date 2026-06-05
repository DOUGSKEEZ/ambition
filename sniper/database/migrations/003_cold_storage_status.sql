-- Add a 'cold_storage' import_status: imported contacts kept on ice (recruiters for
-- other areas, out-of-reach leadership, different regions) — not in the active queue,
-- not rejected. The CHECK constraint is unnamed inline in 001, so Postgres auto-named
-- it people_import_status_check; drop and recreate it with the extra value.
ALTER TABLE people DROP CONSTRAINT IF EXISTS people_import_status_check;
ALTER TABLE people ADD CONSTRAINT people_import_status_check
    CHECK (import_status IN ('staged', 'active', 'rejected', 'cold_storage'));
