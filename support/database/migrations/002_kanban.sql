-- Support v2: the flat list becomes a 3-column Kanban board of PEOPLE (not actions).
-- A card is a person; you drag it between Active / Waiting / Inactive and order it by hand.
--
-- What changes:
--   * status + sort_order   — the column the card sits in, and its manual position in it
--   * company               — free text on the card (the joined Sniper company is only a fallback)
--   * channels TEXT[]       — multi-select badges (call/text/email/linkedin), replacing the single
--                             action_channel dropdown
--   * completed (+via/at)   — the "done" checkbox; dims the card and stamps "✅ Texted" on top
--   * action / action_done  — GONE. The single-action model is what made completed work impossible
--                             to keep (a new action overwrote the old). Existing action text is
--                             folded into the note first, so nothing is lost.
-- Idempotent: re-running is a no-op (the fold is guarded on the old columns still existing).

ALTER TABLE network_people
  ADD COLUMN IF NOT EXISTS status        TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS sort_order    INTEGER,       -- manual order within a column; NULL sorts first (new arrivals)
  ADD COLUMN IF NOT EXISTS company       TEXT,          -- free text; COALESCEd over the joined Sniper company at read time
  ADD COLUMN IF NOT EXISTS channels      TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS completed     BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS completed_via TEXT,          -- which channel it actually happened on -> the verb on the stamp
  ADD COLUMN IF NOT EXISTS completed_at  TIMESTAMPTZ;

-- Drop-then-add so the constraints match this file exactly even on a partially-migrated DB.
ALTER TABLE network_people DROP CONSTRAINT IF EXISTS network_people_status_check;
ALTER TABLE network_people ADD  CONSTRAINT network_people_status_check
  CHECK (status IN ('active', 'waiting', 'inactive'));

ALTER TABLE network_people DROP CONSTRAINT IF EXISTS network_people_channels_check;
ALTER TABLE network_people ADD  CONSTRAINT network_people_channels_check
  CHECK (channels <@ ARRAY['call', 'text', 'email', 'linkedin']::TEXT[]);

ALTER TABLE network_people DROP CONSTRAINT IF EXISTS network_people_completed_via_check;
ALTER TABLE network_people ADD  CONSTRAINT network_people_completed_via_check
  CHECK (completed_via IS NULL OR completed_via IN ('call', 'text', 'email', 'linkedin'));

-- ---------------------------------------------------------------------------
-- Fold the old single-action model into the new one, then drop it. Runs once.
--   note          <- note + "Action: <text>"   (nothing is thrown away)
--   channels      <- action_channel, plus what the action text plainly says ("Call" -> call)
--   completed_*   <- action_done; the verb comes from that same derived channel
-- The `updated_at` read on the right-hand side is the OLD value (the BEFORE trigger only
-- rewrites NEW), so a finished touch keeps the date it was actually ticked.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'network_people' AND column_name = 'action') THEN

    UPDATE network_people SET
      note = CASE WHEN btrim(COALESCE(action, '')) <> ''
                  THEN btrim(COALESCE(note || E'\n', '') || 'Action: ' || btrim(action))
                  ELSE note END,
      channels = ARRAY(
        SELECT ch FROM unnest(ARRAY[
          action_channel,
          CASE WHEN action ILIKE '%text%'     THEN 'text'     END,
          CASE WHEN action ILIKE '%call%'     THEN 'call'     END,
          CASE WHEN action ILIKE '%email%'    THEN 'email'    END,
          CASE WHEN action ILIKE '%linkedin%'
                 OR action ILIKE '%message%'  THEN 'linkedin' END
        ]) AS ch
        WHERE ch IS NOT NULL
        GROUP BY ch ORDER BY ch),
      completed = action_done,
      completed_via = CASE WHEN action_done THEN COALESCE(action_channel,
        CASE WHEN action ILIKE '%text%'    THEN 'text'
             WHEN action ILIKE '%call%'    THEN 'call'
             WHEN action ILIKE '%email%'   THEN 'email'
             WHEN action ILIKE '%linkedin%'
               OR action ILIKE '%message%' THEN 'linkedin' END) END,
      completed_at = CASE WHEN action_done THEN updated_at END;

    ALTER TABLE network_people
      DROP COLUMN action,
      DROP COLUMN action_channel,
      DROP COLUMN action_done;
  END IF;
END $$;

-- Seed the manual order from what was on screen (the old list was updated_at DESC) so the first
-- drag starts from the existing arrangement. Rows added later stay NULL and sort to the TOP of
-- their column — a fresh "→ Support" capture should be the first thing you see, not the last.
UPDATE network_people np
   SET sort_order = ranked.rn
  FROM (
    SELECT id, (row_number() OVER (PARTITION BY status ORDER BY updated_at DESC, id))::int AS rn
    FROM network_people
  ) ranked
 WHERE np.id = ranked.id AND np.sort_order IS NULL;

CREATE INDEX IF NOT EXISTS idx_network_people_status_order ON network_people(status, sort_order);
