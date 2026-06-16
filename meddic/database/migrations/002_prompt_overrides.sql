-- Editable overrides for the drafting system prompt. One row per prompt section
-- (key matches PROMPT_SECTIONS in src/prompt.js). A non-empty body replaces that
-- section's code default; a missing row or blank body means "use the default".
-- The "Edit drafting prompt" modal reads/writes these via /settings/prompt.
-- Idempotent so it can run alongside Sniper's migrations.

CREATE TABLE IF NOT EXISTS prompt_overrides (
    key        TEXT PRIMARY KEY,
    body       TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_prompt_overrides_updated_at ON prompt_overrides;
CREATE TRIGGER trg_prompt_overrides_updated_at
    BEFORE UPDATE ON prompt_overrides
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
