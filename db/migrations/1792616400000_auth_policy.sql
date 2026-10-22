-- Up Migration
ALTER TABLE app.users ADD COLUMN must_change_password boolean NOT NULL DEFAULT true;
CREATE TABLE app.auth_rate_limits (
  bucket_hash text PRIMARY KEY CHECK (bucket_hash ~ '^[0-9a-f]{64}$'),
  hits integer NOT NULL CHECK (hits>0),
  reset_at timestamptz(3) NOT NULL CHECK (isfinite(reset_at))
);
CREATE INDEX auth_rate_limits_expiry ON app.auth_rate_limits(reset_at);

-- Down Migration
DO $$ BEGIN RAISE EXCEPTION 'Forward-only auth policy: use a reviewed forward migration'; END $$;
