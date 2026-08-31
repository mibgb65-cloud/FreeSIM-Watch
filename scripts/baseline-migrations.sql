CREATE TABLE IF NOT EXISTS d1_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

INSERT OR IGNORE INTO d1_migrations (name) VALUES
  ('0002_orders.sql'),
  ('0003_check_history.sql'),
  ('0004_number_inventory.sql'),
  ('0005_multi_user_auth.sql'),
  ('0006_admin_role.sql'),
  ('0007_legal_consent.sql'),
  ('0008_multiple_provider_accounts.sql'),
  ('0009_admin_controls.sql'),
  ('0010_rename_default_monitor.sql'),
  ('0011_global_number_catalog.sql'),
  ('0012_drop_legacy_number_rows.sql'),
  ('0013_app_settings.sql'),
  ('0014_user_bans.sql');
