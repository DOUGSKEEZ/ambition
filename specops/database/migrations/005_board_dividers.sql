-- Board dividers: horizontal separators a user can drop into a stage column to group its cards
-- (e.g. a "Today" / "Tomorrow" split). A divider carries optional text above and below the line and
-- optional up/down chevrons. It lives in the SAME per-stage sort_order space as the cards, so it
-- interleaves with them and is dragged into place exactly like a card (see /opportunities/reorder).
-- Idempotent so it can run alongside the other apps' migrations.
CREATE TABLE IF NOT EXISTS board_dividers (
    id           SERIAL PRIMARY KEY,
    stage        TEXT NOT NULL,          -- which column; validated app-side against the live stage set
    sort_order   INTEGER,                -- shared with opportunities.sort_order within a stage
    label_above  TEXT,                   -- optional caption shown above the line
    label_below  TEXT,                   -- optional caption shown below the line
    chevron_up   BOOLEAN NOT NULL DEFAULT FALSE,
    chevron_down BOOLEAN NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS board_dividers_set_updated_at ON board_dividers;
CREATE TRIGGER board_dividers_set_updated_at BEFORE UPDATE ON board_dividers
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS idx_board_dividers_stage_order ON board_dividers(stage, sort_order);
