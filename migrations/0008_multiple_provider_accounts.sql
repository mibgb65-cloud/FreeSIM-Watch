PRAGMA foreign_keys = OFF;

ALTER TABLE provider_sessions RENAME TO provider_sessions_single;

CREATE TABLE provider_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL COLLATE NOCASE,
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, label)
);

INSERT INTO provider_sessions
  (id, user_id, label, ciphertext, iv, expires_at, created_at, updated_at)
SELECT lower(hex(randomblob(16))), user_id, 'esim.gg 账号 1', ciphertext, iv,
       expires_at, created_at, updated_at
FROM provider_sessions_single;

DROP TABLE provider_sessions_single;

ALTER TABLE provider_import_codes ADD COLUMN provider_session_id TEXT;
ALTER TABLE provider_import_codes ADD COLUMN label TEXT;

ALTER TABLE monitors ADD COLUMN provider_session_id TEXT REFERENCES provider_sessions(id) ON DELETE RESTRICT;

UPDATE monitors
SET provider_session_id = (
  SELECT ps.id
  FROM provider_sessions ps
  WHERE ps.user_id = monitors.user_id
  ORDER BY ps.created_at ASC
  LIMIT 1
)
WHERE provider_session_id IS NULL;

CREATE INDEX provider_sessions_user_updated_idx
  ON provider_sessions(user_id, updated_at DESC);
CREATE INDEX monitors_provider_session_idx
  ON monitors(provider_session_id);

PRAGMA foreign_keys = ON;
