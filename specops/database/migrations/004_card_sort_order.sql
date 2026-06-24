-- Manual card ordering within a stage column. Each opportunity gets a sort_order; the board
-- renders a stage's cards by sort_order (then created_at/id as a stable tiebreak). Without this,
-- cards were fixed in creation order and couldn't be dragged above/below each other in a column.
-- Idempotent: ADD COLUMN IF NOT EXISTS, and the backfill only touches rows still NULL.

ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS sort_order INTEGER;

-- Seed existing rows with their current visual order (per stage, by creation) so the first drag
-- starts from what's already on screen rather than reshuffling. New rows stay NULL and sort last.
UPDATE opportunities o
   SET sort_order = ranked.rn
  FROM (
    SELECT id, (row_number() OVER (PARTITION BY stage ORDER BY created_at, id))::int AS rn
    FROM opportunities
  ) ranked
 WHERE o.id = ranked.id AND o.sort_order IS NULL;

CREATE INDEX IF NOT EXISTS idx_opportunities_stage_order ON opportunities(stage, sort_order);
