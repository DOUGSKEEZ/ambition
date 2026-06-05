-- A short freeform label / nickname Doug assigns to a contact to recognise them at a
-- glance (shown as a chip in the Sniper queue and the meddic roster/today lists).
-- Editable from both apps; lives on the shared people row.
ALTER TABLE people ADD COLUMN IF NOT EXISTS label TEXT;
