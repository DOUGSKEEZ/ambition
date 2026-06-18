-- Replace the 0–100 priority_score with a freeform emoji "marker" that loosely fills
-- many roles (urgency, vibe, personal mnemonics like 🇨🇦➕👶). priority_score is left in
-- place (shared people table) but no longer read or written by meddic.
ALTER TABLE people ADD COLUMN IF NOT EXISTS emoji TEXT;
