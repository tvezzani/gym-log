-- Up Migration
ALTER TABLE app.users DROP CONSTRAINT users_role_check;
UPDATE app.users SET role=CASE role WHEN 'member' THEN 'user' WHEN 'superadmin' THEN 'admin' ELSE role END;
ALTER TABLE app.users ALTER COLUMN role SET DEFAULT 'user';
ALTER TABLE app.users ADD CONSTRAINT users_role_check CHECK (role IN ('user','admin'));
DROP INDEX app.users_active_superadmin;
CREATE INDEX users_active_admin ON app.users(id) WHERE is_active AND role='admin';

-- Down Migration
DO $$ BEGIN RAISE EXCEPTION 'Role rename requires matching application code; use a reviewed forward migration'; END $$;
