CREATE TABLE IF NOT EXISTS global_number_inventory (
  number TEXT PRIMARY KEY,
  listed_price REAL,
  price REAL,
  currency TEXT,
  last_seen_at TEXT NOT NULL
);

INSERT INTO global_number_inventory (number, listed_price, price, currency, last_seen_at)
WITH ranked AS (
  SELECT
    number,
    listed_price,
    price,
    currency,
    last_seen_at,
    ROW_NUMBER() OVER (PARTITION BY number ORDER BY last_seen_at DESC, id DESC) AS row_number
  FROM number_inventory
)
SELECT number, listed_price, price, currency, last_seen_at
FROM ranked
WHERE row_number = 1
ON CONFLICT (number) DO UPDATE SET
  listed_price = excluded.listed_price,
  price = excluded.price,
  currency = excluded.currency,
  last_seen_at = excluded.last_seen_at
WHERE excluded.last_seen_at > global_number_inventory.last_seen_at;

CREATE INDEX IF NOT EXISTS global_number_inventory_price_idx
  ON global_number_inventory (price);
