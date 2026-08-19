-- App-level key/value settings. First use: ai_provider, which model Sniper uses to
-- synthesize contact notes (on capture auto-enrich AND the Regenerate button). Server-side
-- so the keyless background capture worker can read the choice. Defaults to 'local' (qwen3)
-- so capture never silently bills the Claude API — Claude is an explicit opt-in in Settings.
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO settings (key, value) VALUES ('ai_provider', 'local')
  ON CONFLICT (key) DO NOTHING;
