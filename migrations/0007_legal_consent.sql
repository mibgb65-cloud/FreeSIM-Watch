ALTER TABLE users ADD COLUMN privacy_accepted_at TEXT;
ALTER TABLE users ADD COLUMN terms_accepted_at TEXT;
ALTER TABLE users ADD COLUMN legal_version TEXT;
ALTER TABLE oauth_states ADD COLUMN legal_version TEXT;
