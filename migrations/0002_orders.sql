ALTER TABLE monitors ADD COLUMN action_json TEXT;

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
