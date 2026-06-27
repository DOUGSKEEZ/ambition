-- "Ready / staged": Doug has prepared the contact's next outreach and can send it on sight.
-- Surfaced as a ✅ in the Today/Tomorrow/Roster tables and toggled from the Tracker card.
ALTER TABLE people ADD COLUMN IF NOT EXISTS staged BOOLEAN NOT NULL DEFAULT FALSE;
