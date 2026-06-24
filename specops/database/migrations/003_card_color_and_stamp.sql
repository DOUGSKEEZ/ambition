-- Card visual status: an "active" accent color + an optional emoji stamp, both per-opportunity.
-- The color is the "I'm actively working this" cue (a small fixed palette that maps to CSS
-- classes); the stamp is a freeform short emoji status marker. Both are optional (NULL = none).
-- Idempotent: ADD COLUMN IF NOT EXISTS is atomic with its inline CHECK, so re-running is a no-op.

-- accent_color: a small fixed palette, kept in lock-step with the CSS .accent-* classes.
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS accent_color TEXT
    CHECK (accent_color IS NULL OR accent_color IN ('blue', 'red', 'green', 'orange'));

-- stamp: an emoji visual cue. The exact set is whitelisted in the app (so it can grow without
-- a migration); the DB just caps the length as a backstop against arbitrary junk being stored.
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS stamp TEXT
    CHECK (stamp IS NULL OR char_length(stamp) <= 8);
