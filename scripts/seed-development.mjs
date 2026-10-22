import pg from 'pg';
import { createHash } from 'node:crypto';
import { canonicalWorkoutCreate } from '../packages/contracts/dist/index.js';

let connection;
try {
  connection = new URL(process.env.MIGRATION_DATABASE_URL ?? 'invalid:');
} catch {
  throw new Error('Invalid migration database configuration');
}

if (
  process.env.NODE_ENV !== 'development' ||
  !['127.0.0.1', 'localhost', '[::1]'].includes(connection.hostname) ||
  connection.pathname !== '/gym_log' ||
  !process.argv.includes('--confirm-local-fixtures')
) {
  throw new Error(
    'Fixtures require NODE_ENV=development, the local gym_log database, and --confirm-local-fixtures',
  );
}
const client = new pg.Client({ connectionString: connection.href });
const ids = {
  admin: 'f1000000-0000-4000-8000-000000000001',
  alice: 'f1000000-0000-4000-8000-000000000002',
  bob: 'f1000000-0000-4000-8000-000000000003',
  shared: 'f2000000-0000-4000-8000-000000000001',
  pending: 'f2000000-0000-4000-8000-000000000002',
  workout: 'f3000000-0000-4000-8000-000000000001',
  plan: 'f4000000-0000-4000-8000-000000000001',
};
try {
  await client.connect();
  await client.query('BEGIN');
  for (const [id, username, role] of [
    [ids.admin, 'fixture_admin', 'admin'],
    [ids.alice, 'fixture_alice', 'user'],
    [ids.bob, 'fixture_bob', 'user'],
  ]) {
    await client.query(
      'INSERT INTO app.users(id,username,password_hash,role,is_active,time_zone) VALUES($1,$2,$3,$4,false,$5) ON CONFLICT(id) DO NOTHING',
      [
        id,
        username,
        '$argon2id$disabled-fixture-not-a-login-hash',
        role,
        'America/Denver',
      ],
    );
    const existing = (
      await client.query(
        'SELECT username,is_active,role FROM app.users WHERE id=$1',
        [id],
      )
    ).rows[0];
    if (
      existing.username !== username ||
      existing.is_active ||
      existing.role !== role
    )
      throw new Error(
        'Fixture account conflicts with existing data; nothing changed',
      );
  }
  await client.query(
    "INSERT INTO app.exercises(id,name,status,submitted_by,reviewed_by,reviewed_at) VALUES($1,'Fixture barbell squat','approved',$2,$3,'2026-10-21T18:34:56.123Z') ON CONFLICT(id) DO NOTHING",
    [ids.shared, ids.alice, ids.admin],
  );
  await client.query(
    "INSERT INTO app.exercises(id,name,submitted_by) VALUES($1,'Fixture pending press',$2) ON CONFLICT(id) DO NOTHING",
    [ids.pending, ids.alice],
  );
  const input = {
    id: ids.workout,
    exerciseId: ids.shared,
    performedAt: '2026-10-21T18:34:56.123Z',
    reps: 10,
    weight: '135.125',
    setNumber: 1,
    rpe: 5,
  };
  const digest = createHash('sha256')
    .update(canonicalWorkoutCreate(input))
    .digest('hex');
  await client.query(
    'INSERT INTO app.workout_create_requests(id,user_id,request_hash) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING',
    [ids.workout, ids.alice, digest],
  );
  await client.query(
    'INSERT INTO app.workouts(id,user_id,exercise_id,performed_at,reps,weight,set_number,rpe) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO NOTHING',
    [
      ids.workout,
      ids.alice,
      ids.shared,
      input.performedAt,
      input.reps,
      input.weight,
      input.setNumber,
      input.rpe,
    ],
  );
  await client.query(
    "INSERT INTO app.planned_exercises(id,user_id,exercise_id,planned_date,notes,sort_order) VALUES($1,$2,$3,'2026-10-21','3x10; development fixture',0) ON CONFLICT(id) DO NOTHING",
    [ids.plan, ids.alice, ids.shared],
  );
  await client.query('COMMIT');
  console.log(
    'Local fixtures ready: three disabled accounts, shared/pending exercises, one set and one plan. No usable passwords were created.',
  );
} catch {
  await client.query('ROLLBACK').catch(() => {});
  console.error('Fixture transaction failed; no changes committed');
  process.exitCode = 1;
} finally {
  await client.end();
}
