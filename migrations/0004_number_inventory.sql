CREATE TABLE IF NOT EXISTS number_inventory (
  id TEXT PRIMARY KEY,
  monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  number TEXT NOT NULL,
  listed_price REAL,
  price REAL,
  currency TEXT,
  purchase_url TEXT,
  raw_json TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  seen_count INTEGER NOT NULL DEFAULT 1,
  last_run_id TEXT,
  last_round_number INTEGER,
  UNIQUE (monitor_id, number)
);

CREATE INDEX IF NOT EXISTS number_inventory_monitor_price_idx
  ON number_inventory (monitor_id, price, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS number_inventory_monitor_seen_idx
  ON number_inventory (monitor_id, last_seen_at DESC);

-- Backfill one current row per number from the per-round archive created by 0003.
INSERT OR IGNORE INTO number_inventory
  (id, monitor_id, number, listed_price, price, currency, purchase_url, raw_json,
   first_seen_at, last_seen_at, seen_count, last_run_id, last_round_number)
WITH ranked AS (
  SELECT
    r.monitor_id,
    c.number,
    c.listed_price,
    c.price,
    c.currency,
    c.purchase_url,
    c.raw_json,
    MIN(r.started_at) OVER (PARTITION BY r.monitor_id, c.number) AS first_seen_at,
    MAX(r.started_at) OVER (PARTITION BY r.monitor_id, c.number) AS last_seen_at,
    COUNT(*) OVER (PARTITION BY r.monitor_id, c.number) AS seen_count,
    r.id AS last_run_id,
    c.round_number,
    ROW_NUMBER() OVER (
      PARTITION BY r.monitor_id, c.number
      ORDER BY r.started_at DESC, c.round_number DESC, c.id DESC
    ) AS row_number
  FROM check_results c
  JOIN check_runs r ON r.id = c.run_id
)
SELECT
  lower(hex(randomblob(16))), monitor_id, number, listed_price, price, currency, purchase_url, raw_json,
  first_seen_at, last_seen_at, seen_count, last_run_id, round_number
FROM ranked
WHERE row_number = 1;
