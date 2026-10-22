-- Up Migration
-- These exact disabled sample identities/hashes are installed only by the
-- explicit local fixture command. They have never been usable login accounts.
-- Reconcile the previous backfill only for a fixture-only, session-free database.
UPDATE app.installation SET completed_at=NULL WHERE id=1
AND EXISTS(SELECT 1 FROM app.users WHERE id='f1000000-0000-4000-8000-000000000001' AND username='fixture_admin' AND role='admin' AND NOT is_active AND password_hash='$argon2id$disabled-fixture-not-a-login-hash')
AND NOT EXISTS(SELECT 1 FROM app.auth_sessions)
AND NOT EXISTS(
 SELECT 1 FROM app.users WHERE NOT (
  NOT is_active AND password_hash='$argon2id$disabled-fixture-not-a-login-hash' AND (
   (id='f1000000-0000-4000-8000-000000000001' AND username='fixture_admin' AND role='admin') OR
   (id='f1000000-0000-4000-8000-000000000002' AND username='fixture_alice' AND role='user') OR
   (id='f1000000-0000-4000-8000-000000000003' AND username='fixture_bob' AND role='user')
  )
 )
);

CREATE OR REPLACE FUNCTION app.record_installation_setup() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.role='admin' AND NOT (
  NEW.id='f1000000-0000-4000-8000-000000000001' AND NEW.username='fixture_admin'
  AND NOT NEW.is_active AND NEW.password_hash='$argon2id$disabled-fixture-not-a-login-hash'
 ) THEN
  UPDATE app.installation SET completed_at=statement_timestamp() WHERE id=1 AND completed_at IS NULL;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.record_installation_setup() FROM PUBLIC;
DROP TRIGGER users_complete_installation ON app.users;
CREATE TRIGGER users_complete_installation AFTER INSERT OR UPDATE OF role,is_active,password_hash,username ON app.users
FOR EACH ROW EXECUTE FUNCTION app.record_installation_setup();

-- Down Migration
DO $$ BEGIN RAISE EXCEPTION 'Forward-only setup fixture migration: restore a verified backup or add a reviewed forward migration'; END $$;
