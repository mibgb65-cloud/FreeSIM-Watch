PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  name TEXT NOT NULL,
  avatar_url TEXT,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  trust_level INTEGER NOT NULL DEFAULT 0 CHECK (trust_level BETWEEN 0 AND 4),
  privacy_accepted_at TEXT,
  terms_accepted_at TEXT,
  legal_version TEXT,
  banned_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash TEXT PRIMARY KEY,
  return_to TEXT NOT NULL,
  legal_version TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS oauth_states_expires_at_idx ON oauth_states(expires_at);

CREATE TABLE IF NOT EXISTS provider_sessions (
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
CREATE INDEX IF NOT EXISTS provider_sessions_user_updated_idx
  ON provider_sessions(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS provider_import_codes (
  code_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_session_id TEXT REFERENCES provider_sessions(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS provider_import_codes_user_idx ON provider_import_codes(user_id, expires_at);

CREATE TABLE IF NOT EXISTS monitors (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_session_id TEXT NOT NULL REFERENCES provider_sessions(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  url TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'GET',
  headers_json TEXT NOT NULL DEFAULT '{}',
  body TEXT,
  parser_json TEXT NOT NULL,
  filters_json TEXT NOT NULL DEFAULT '{}',
  action_json TEXT,
  notify_email TEXT NOT NULL,
  last_checked_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS monitors_user_created_idx
  ON monitors (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS monitors_provider_session_idx
  ON monitors (provider_session_id);

CREATE TABLE IF NOT EXISTS monitor_quota_rules (
  trust_level INTEGER PRIMARY KEY CHECK (trust_level BETWEEN 0 AND 4),
  max_monitors INTEGER NOT NULL CHECK (max_monitors BETWEEN 0 AND 20),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
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

CREATE TABLE IF NOT EXISTS discoveries (
  id TEXT PRIMARY KEY,
  monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  number TEXT NOT NULL,
  price REAL,
  currency TEXT,
  purchase_url TEXT,
  raw_json TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  notified_at TEXT,
  UNIQUE (monitor_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS discoveries_monitor_seen_idx
  ON discoveries (monitor_id, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  discovery_id TEXT NOT NULL UNIQUE REFERENCES discoveries(id) ON DELETE CASCADE,
  provider_order_id TEXT,
  status TEXT NOT NULL,
  payment_url TEXT,
  total REAL,
  currency TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS orders_status_created_idx
  ON orders (status, created_at DESC);

CREATE TABLE IF NOT EXISTS global_number_inventory (
  number TEXT PRIMARY KEY,
  listed_price REAL,
  price REAL,
  currency TEXT,
  last_seen_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS global_number_inventory_price_idx
  ON global_number_inventory (price);
