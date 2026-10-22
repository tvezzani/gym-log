-- Up Migration
CREATE TABLE app.installation (
  id smallint PRIMARY KEY CHECK (id=1),
  completed_at timestamptz(3) CHECK (isfinite(completed_at))
);
INSERT INTO app.installation(id,completed_at)
SELECT 1,CASE WHEN EXISTS(SELECT 1 FROM app.users WHERE role='admin') THEN statement_timestamp() ELSE NULL END;
REVOKE ALL ON app.installation FROM gym_app;
GRANT SELECT ON app.installation TO gym_app;

-- An admin created by the browser, CLI, or operator permanently closes first-run
-- setup. Disabling/demoting/deleting admins must never reopen public setup.
CREATE FUNCTION app.record_installation_setup() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF NEW.role='admin' THEN
    UPDATE app.installation SET completed_at=statement_timestamp()
    WHERE id=1 AND completed_at IS NULL;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.record_installation_setup() FROM PUBLIC;
CREATE TRIGGER users_complete_installation AFTER INSERT OR UPDATE OF role ON app.users
FOR EACH ROW EXECUTE FUNCTION app.record_installation_setup();

-- Down Migration
DO $$ BEGIN RAISE EXCEPTION 'Forward-only installation setup migration: restore a verified backup or add a reviewed forward migration'; END $$;
