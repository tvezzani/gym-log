-- Up Migration
CREATE FUNCTION app.touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = statement_timestamp(); RETURN NEW; END $$;

CREATE TABLE app.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9_]{3,32}$'),
  password_hash text NOT NULL CHECK (length(password_hash) BETWEEN 30 AND 512 AND password_hash LIKE '$argon2id$%'),
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('member','superadmin')),
  is_active boolean NOT NULL DEFAULT true,
  time_zone text NOT NULL CHECK (length(time_zone) BETWEEN 1 AND 100),
  created_at timestamptz(3) NOT NULL DEFAULT statement_timestamp() CHECK (isfinite(created_at)),
  updated_at timestamptz(3) NOT NULL DEFAULT statement_timestamp() CHECK (isfinite(updated_at))
);
CREATE FUNCTION app.validate_user_timezone() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.time_zone) THEN
    RAISE EXCEPTION 'Invalid timezone' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER users_timezone BEFORE INSERT OR UPDATE OF time_zone ON app.users FOR EACH ROW EXECUTE FUNCTION app.validate_user_timezone();
CREATE TRIGGER users_updated BEFORE UPDATE ON app.users FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE INDEX users_active_superadmin ON app.users(id) WHERE is_active AND role='superadmin';

CREATE TABLE app.exercises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120 AND name = btrim(name) AND name !~ '[[:cntrl:]]'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  submitted_by uuid NOT NULL REFERENCES app.users(id) ON DELETE RESTRICT,
  reviewed_by uuid REFERENCES app.users(id) ON DELETE RESTRICT,
  reviewed_at timestamptz(3) CHECK (isfinite(reviewed_at)),
  archived_at timestamptz(3) CHECK (isfinite(archived_at)),
  created_at timestamptz(3) NOT NULL DEFAULT statement_timestamp() CHECK (isfinite(created_at)),
  updated_at timestamptz(3) NOT NULL DEFAULT statement_timestamp() CHECK (isfinite(updated_at)),
  CONSTRAINT exercise_review_metadata CHECK (
    (status='pending' AND reviewed_by IS NULL AND reviewed_at IS NULL) OR
    (status IN ('approved','rejected') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  )
);
CREATE INDEX exercises_shared_name ON app.exercises(lower(name),id) WHERE status='approved' AND archived_at IS NULL;
CREATE INDEX exercises_submitter ON app.exercises(submitted_by,created_at DESC,id DESC);
CREATE INDEX exercises_review_queue ON app.exercises(status,created_at,id);
CREATE INDEX exercises_reviewer ON app.exercises(reviewed_by);
CREATE TRIGGER exercises_updated BEFORE UPDATE ON app.exercises FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- Retain only the original normalized-request hash and owner after deletion.
-- This makes retries safe after edits/deletion without keeping deleted set values.
CREATE TABLE app.workout_create_requests (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE RESTRICT,
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz(3) NOT NULL DEFAULT statement_timestamp() CHECK (isfinite(created_at)),
  UNIQUE(id,user_id)
);
CREATE INDEX workout_create_requests_owner ON app.workout_create_requests(user_id);
REVOKE UPDATE, DELETE ON app.workout_create_requests FROM gym_app;

CREATE TABLE app.workouts (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE RESTRICT,
  exercise_id uuid NOT NULL REFERENCES app.exercises(id) ON DELETE RESTRICT,
  performed_at timestamptz(3) NOT NULL CHECK (isfinite(performed_at)),
  reps numeric NOT NULL CHECK (reps BETWEEN 1 AND 2147483647 AND reps=trunc(reps)),
  weight numeric(8,3) NOT NULL CHECK (weight BETWEEN 0 AND 99999.999),
  set_number numeric NOT NULL DEFAULT 1 CHECK (set_number BETWEEN 1 AND 2147483647 AND set_number=trunc(set_number)),
  rpe numeric NOT NULL DEFAULT 5 CHECK (rpe BETWEEN 1 AND 10 AND rpe=trunc(rpe)),
  created_at timestamptz(3) NOT NULL DEFAULT statement_timestamp() CHECK (isfinite(created_at)),
  updated_at timestamptz(3) NOT NULL DEFAULT statement_timestamp() CHECK (isfinite(updated_at)),
  FOREIGN KEY(id,user_id) REFERENCES app.workout_create_requests(id,user_id) ON DELETE RESTRICT
);
CREATE INDEX workouts_owner_time ON app.workouts(user_id,performed_at DESC,id DESC);
CREATE INDEX workouts_owner_exercise_time ON app.workouts(user_id,exercise_id,performed_at DESC,id DESC);
CREATE INDEX workouts_exercise ON app.workouts(exercise_id);
CREATE TRIGGER workouts_updated BEFORE UPDATE ON app.workouts FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE TABLE app.planned_exercises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE RESTRICT,
  exercise_id uuid NOT NULL REFERENCES app.exercises(id) ON DELETE RESTRICT,
  planned_date date NOT NULL CHECK (planned_date BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
  notes text NOT NULL DEFAULT '' CHECK (length(notes)<=2000),
  sort_order integer NOT NULL CHECK (sort_order>=0),
  created_at timestamptz(3) NOT NULL DEFAULT statement_timestamp() CHECK (isfinite(created_at)),
  updated_at timestamptz(3) NOT NULL DEFAULT statement_timestamp() CHECK (isfinite(updated_at)),
  CONSTRAINT plans_owner_date_order UNIQUE(user_id,planned_date,sort_order) DEFERRABLE INITIALLY IMMEDIATE
);
CREATE INDEX plans_owner_date ON app.planned_exercises(user_id,planned_date,sort_order,id);
CREATE INDEX plans_exercise ON app.planned_exercises(exercise_id);
CREATE TRIGGER plans_updated BEFORE UPDATE ON app.planned_exercises FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE TABLE app.auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE RESTRICT,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  csrf_token text NOT NULL CHECK (csrf_token ~ '^[A-Za-z0-9_-]{43}$'),
  created_at timestamptz(3) NOT NULL DEFAULT statement_timestamp() CHECK (isfinite(created_at)),
  expires_at timestamptz(3) NOT NULL CHECK (isfinite(expires_at) AND expires_at>created_at),
  revoked_at timestamptz(3) CHECK (isfinite(revoked_at) AND revoked_at>=created_at)
);
CREATE INDEX auth_sessions_user ON app.auth_sessions(user_id);
CREATE INDEX auth_sessions_expiry ON app.auth_sessions(expires_at);

-- Down Migration
DO $$ BEGIN RAISE EXCEPTION 'Forward-only domain migration: restore a verified backup or add a reviewed forward migration'; END $$;
