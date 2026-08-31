ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'
  CHECK (role IN ('user', 'admin'));

-- Configure administrators with the ADMIN_USER_IDS Worker variable.
