-- Add a 'support' import_status: personal-network contacts captured via the extension's
-- "→ Support" button. They ride the normal ingest pipeline (parser + photo) but belong to
-- the Support app (:7707) — never shown in Sniper's review queue. Same drop/recreate
-- pattern as 003 (the CHECK is auto-named people_import_status_check).
ALTER TABLE people DROP CONSTRAINT IF EXISTS people_import_status_check;
ALTER TABLE people ADD CONSTRAINT people_import_status_check
    CHECK (import_status IN ('staged', 'active', 'rejected', 'cold_storage', 'support'));
