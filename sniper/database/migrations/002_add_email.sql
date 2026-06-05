-- Add a manually-entered email address to people (LinkedIn doesn't expose it,
-- so it's filled in via the Sniper review UI and surfaced read-only in meddic).
ALTER TABLE people ADD COLUMN IF NOT EXISTS email TEXT;
