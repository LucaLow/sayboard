-- PostgreSQL storage schema v1. Apply deliberately with a migration-owner role.
-- No accounts, credentials, role grants or defaults for authentication are seeded.
BEGIN;
CREATE SCHEMA IF NOT EXISTS sayboard;
CREATE TABLE IF NOT EXISTS sayboard.schema_version (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  version INTEGER NOT NULL
);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM sayboard.schema_version WHERE version <> 1) THEN
    RAISE EXCEPTION 'Unsupported Sayboard schema version';
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS sayboard.accounts (
  id UUID PRIMARY KEY,
  username TEXT NOT NULL UNIQUE CHECK (username ~ '^[a-zA-Z0-9_-]{1,64}$' AND lower(username) <> 'admin'),
  password_hash TEXT NOT NULL CHECK (password_hash ~ '^scrypt\$131072\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{128}$'),
  local_only BOOLEAN NOT NULL DEFAULT FALSE CHECK (local_only = FALSE)
);
CREATE TABLE IF NOT EXISTS sayboard.sessions (
  token_hash TEXT PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  account_id UUID NOT NULL REFERENCES sayboard.accounts(id) ON DELETE CASCADE,
  expires_at BIGINT NOT NULL CHECK (expires_at BETWEEN 0 AND 9007199254740991)
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sayboard.sessions(expires_at);
CREATE TABLE IF NOT EXISTS sayboard.boards (
  account_id UUID PRIMARY KEY REFERENCES sayboard.accounts(id) ON DELETE CASCADE,
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND payload @> '{"version":1}'::jsonb),
  revision INTEGER NOT NULL CHECK (revision > 0)
);
CREATE TABLE IF NOT EXISTS sayboard.login_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL CHECK (count BETWEEN 1 AND 11),
  expires_at BIGINT NOT NULL CHECK (expires_at BETWEEN 0 AND 9007199254740991)
);
CREATE INDEX IF NOT EXISTS login_limits_expiry ON sayboard.login_limits(expires_at);
INSERT INTO sayboard.schema_version(singleton, version) VALUES (TRUE, 1)
  ON CONFLICT (singleton) DO NOTHING;
COMMIT;
