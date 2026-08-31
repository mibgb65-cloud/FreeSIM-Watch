ALTER TABLE users ADD COLUMN trust_level INTEGER NOT NULL DEFAULT 0
  CHECK (trust_level BETWEEN 0 AND 4);

CREATE TABLE IF NOT EXISTS monitor_quota_rules (
  trust_level INTEGER PRIMARY KEY CHECK (trust_level BETWEEN 0 AND 4),
  max_monitors INTEGER NOT NULL CHECK (max_monitors BETWEEN 0 AND 20),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS resend_api_keys (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  key_hint TEXT NOT NULL,
  from_address TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  last_used_at TEXT,
  cooldown_until TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS resend_api_keys_active_idx
  ON resend_api_keys(active, cooldown_until, last_used_at);
