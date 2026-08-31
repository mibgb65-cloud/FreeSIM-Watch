CREATE TABLE IF NOT EXISTS check_runs (
  id TEXT PRIMARY KEY,
  monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  rounds INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'running',
  candidate_count INTEGER NOT NULL DEFAULT 0,
  matched_count INTEGER NOT NULL DEFAULT 0,
  error TEXT
);

CREATE TABLE IF NOT EXISTS check_results (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES check_runs(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL,
  number TEXT NOT NULL,
  listed_price REAL,
  price REAL,
  currency TEXT,
  matched INTEGER NOT NULL DEFAULT 0,
  purchase_url TEXT,
  raw_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS check_runs_monitor_started_idx
  ON check_runs (monitor_id, started_at DESC);

CREATE INDEX IF NOT EXISTS check_results_run_idx
  ON check_results (run_id, round_number, number);
