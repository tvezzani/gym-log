import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, cp, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import pg from 'pg';

test(
  'empty PostgreSQL migrations, constraints, historical references, ordering and rollback',
  { timeout: 60000 },
  async () => {
    assert.ok(process.env.MIGRATION_DATABASE_URL);
    assert.ok(process.env.DATABASE_URL);
    const database = `gym_log_verify_${randomUUID().replaceAll('-', '')}`;
    assert.match(database, /^gym_log_verify_[a-f0-9]{32}$/);
    const admin = new pg.Client({
      connectionString: process.env.MIGRATION_DATABASE_URL,
    });
    const operatorUrl = new URL(process.env.MIGRATION_DATABASE_URL);
    const appUrl = new URL(process.env.DATABASE_URL);
    operatorUrl.pathname = `/${database}`;
    appUrl.pathname = `/${database}`;
    const operator = new pg.Client({ connectionString: operatorUrl.href });
    const app = new pg.Client({ connectionString: appUrl.href });
    let created = false;
    let temporary = '';
    let legacyDirectory = '';
    const migrationFiles = (await readdir('db/migrations')).filter((name) =>
      /^\d+_.*\.sql$/.test(name),
    );
    const migrationCount = migrationFiles.length;
    const run = promisify(execFile);
    const migrate = async (directory = 'db/migrations') =>
      run(
        process.execPath,
        [
          'node_modules/node-pg-migrate/bin/node-pg-migrate.js',
          '--database-url-var',
          'MIGRATION_DATABASE_URL',
          '--migrations-dir',
          directory,
          'up',
        ],
        {
          env: { ...process.env, MIGRATION_DATABASE_URL: operatorUrl.href },
          timeout: 20000,
        },
      );
    try {
      await admin.connect();
      await admin.query(`CREATE DATABASE ${database}`);
      created = true;
      await operator.connect();
      await operator.query(`REVOKE ALL ON DATABASE ${database} FROM PUBLIC`);
      await operator.query(`GRANT CONNECT ON DATABASE ${database} TO gym_app`);
      await operator.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');

      // Prove the upgrade preserves existing identities and security state.
      legacyDirectory = await mkdtemp(join(tmpdir(), 'gym-log-legacy-roles-'));
      for (const name of migrationFiles.filter(
        (file) => Number(file.split('_')[0]) < 1792620000000,
      ))
        await cp(join('db/migrations', name), join(legacyDirectory, name));
      await migrate(legacyDirectory);
      const legacyUser = randomUUID(),
        legacyAdmin = randomUUID();
      const oldHash = '$argon2id$disabled-fixture-not-a-login-hash';
      await operator.query(
        "INSERT INTO app.users(id,username,password_hash,role,is_active,time_zone,must_change_password) VALUES($1,'legacy_user',$3,'member',false,'UTC',false),($2,'legacy_admin',$3,'superadmin',false,'UTC',true)",
        [legacyUser, legacyAdmin, oldHash],
      );
      await operator.query(
        "INSERT INTO app.auth_sessions(user_id,token_hash,csrf_token,expires_at) VALUES($1,$2,$3,statement_timestamp()+interval '30 days')",
        [legacyUser, 'd'.repeat(64), 'c'.repeat(43)],
      );
      await migrate();
      assert.ok(
        (
          await operator.query(
            'SELECT completed_at FROM app.installation WHERE id=1',
          )
        ).rows[0].completed_at,
      );
      const upgraded = (
        await operator.query(
          'SELECT id,role,password_hash,is_active,must_change_password FROM app.users WHERE id=ANY($1::uuid[]) ORDER BY username',
          [[legacyUser, legacyAdmin]],
        )
      ).rows;
      assert.deepEqual(upgraded, [
        {
          id: legacyAdmin,
          role: 'admin',
          password_hash: oldHash,
          is_active: false,
          must_change_password: true,
        },
        {
          id: legacyUser,
          role: 'user',
          password_hash: oldHash,
          is_active: false,
          must_change_password: false,
        },
      ]);
      assert.equal(
        (
          await operator.query(
            'SELECT user_id FROM app.auth_sessions WHERE token_hash=$1',
            ['d'.repeat(64)],
          )
        ).rows[0].user_id,
        legacyUser,
      );
      assert.match(
        (
          await operator.query(
            "SELECT indexdef FROM pg_indexes WHERE schemaname='app' AND indexname='users_active_admin'",
          )
        ).rows[0].indexdef,
        /role = 'admin'/,
      );
      assert.match((await migrate()).stdout, /No migrations to run/);
      assert.equal(
        (
          await operator.query(
            'SELECT count(*)::int AS n FROM public.pgmigrations',
          )
        ).rows[0].n,
        migrationCount,
      );
      await app.connect();
      await app.query('BEGIN');
      async function rejected(sql: string, values: unknown[], code: string) {
        await app.query('SAVEPOINT invalid_input');
        try {
          await assert.rejects(
            app.query(sql, values),
            (error: unknown) =>
              typeof error === 'object' &&
              error !== null &&
              'code' in error &&
              error.code === code,
          );
        } finally {
          await app.query('ROLLBACK TO SAVEPOINT invalid_input');
          await app.query('RELEASE SAVEPOINT invalid_input');
        }
      }
      for (const legacyRole of ['member', 'superadmin'])
        await rejected(
          'INSERT INTO app.users(username,password_hash,role,time_zone) VALUES($1,$2,$3,$4)',
          ['invalid_role', oldHash, legacyRole, 'UTC'],
          '23514',
        );
      const defaultUser = (
        await app.query(
          'INSERT INTO app.users(username,password_hash,time_zone) VALUES($1,$2,$3) RETURNING role',
          ['default_user', oldHash, 'UTC'],
        )
      ).rows[0];
      assert.equal(defaultUser.role, 'user');
      const alice = randomUUID(),
        bob = randomUUID(),
        exercise = randomUUID();
      const hash = '$argon2id$disabled-fixture-not-a-login-hash';
      await app.query(
        'INSERT INTO app.users(id,username,password_hash,role,time_zone) VALUES ($1,$2,$3,$4,$5),($6,$7,$3,$8,$5)',
        [alice, 'alice', hash, 'admin', 'America/Denver', bob, 'bob', 'user'],
      );
      await rejected(
        'INSERT INTO app.users(username,password_hash,time_zone) VALUES ($1,$2,$3)',
        ['ALICE', hash, 'UTC'],
        '23514',
      );
      await rejected(
        'INSERT INTO app.users(username,password_hash,time_zone) VALUES ($1,$2,$3)',
        ['charlie', hash, 'Definitely/Unknown'],
        '23514',
      );
      await rejected(
        'INSERT INTO app.users(username,password_hash,time_zone) VALUES ($1,$2,$3)',
        ['alice', hash, 'UTC'],
        '23505',
      );
      await app.query(
        'INSERT INTO app.exercises(id,name,submitted_by) VALUES($1,$2,$3)',
        [exercise, 'Barbell squat', alice],
      );
      await rejected(
        "UPDATE app.exercises SET status='approved' WHERE id=$1",
        [exercise],
        '23514',
      );
      const workout = randomUUID();
      await app.query(
        'INSERT INTO app.workout_create_requests(id,user_id,request_hash) VALUES($1,$2,$3)',
        [workout, alice, 'a'.repeat(64)],
      );
      const insert =
        'INSERT INTO app.workouts(id,user_id,exercise_id,performed_at,reps,weight,set_number,rpe) VALUES($1,$2,$3,$4,$5,$6,$7,$8)';
      const values: unknown[] = [
        workout,
        alice,
        exercise,
        '2026-10-21T12:34:56.123-06:00',
        10,
        '135.125',
        1,
        5,
      ];
      for (const [index, value, code] of [
        [4, 0, '23514'],
        [4, 1.5, '23514'],
        [4, 2147483648, '23514'],
        [5, '-1', '23514'],
        [5, 'NaN', '23514'],
        [5, '100000', '22003'],
        [6, 0, '23514'],
        [6, 1.5, '23514'],
        [7, 0, '23514'],
        [7, 11, '23514'],
        [7, 5.5, '23514'],
        [3, 'infinity', '23514'],
      ] as const) {
        const invalid = [...values];
        invalid[index] = value;
        await rejected(insert, invalid, code);
      }
      await rejected(insert, [workout, bob, ...values.slice(2)], '23503');
      await app.query(insert, values);
      const stored = (
        await app.query(
          'SELECT weight, performed_at, rpe FROM app.workouts WHERE id=$1',
          [workout],
        )
      ).rows[0];
      assert.equal(stored.weight, '135.125');
      assert.equal(stored.rpe, '5');
      assert.equal(
        stored.performed_at.toISOString(),
        '2026-10-21T18:34:56.123Z',
      );
      await rejected(insert, values, '23505');
      const second = randomUUID();
      await app.query(
        'INSERT INTO app.workout_create_requests(id,user_id,request_hash) VALUES($1,$2,$3)',
        [second, alice, 'b'.repeat(64)],
      );
      await app.query(
        'INSERT INTO app.workouts(id,user_id,exercise_id,performed_at,reps,weight) VALUES($1,$2,$3,$4,$5,$6)',
        [second, alice, exercise, values[3], 10, '0'],
      );
      assert.equal(
        (await app.query('SELECT rpe FROM app.workouts WHERE id=$1', [second]))
          .rows[0].rpe,
        '5',
      );
      assert.equal(
        (
          await app.query(
            'SELECT count(*)::int AS n FROM app.workouts WHERE user_id=$1 AND set_number=1',
            [alice],
          )
        ).rows[0].n,
        2,
      );
      const plan1 = randomUUID(),
        plan2 = randomUUID();
      await app.query(
        "INSERT INTO app.planned_exercises(id,user_id,exercise_id,planned_date,sort_order) VALUES($1,$2,$3,'2026-10-21',0),($4,$2,$3,'2026-10-21',1)",
        [plan1, alice, exercise, plan2],
      );
      await rejected(
        "INSERT INTO app.planned_exercises(user_id,exercise_id,planned_date,sort_order) VALUES($1,$2,'2026-10-21',0)",
        [alice, exercise],
        '23505',
      );
      await rejected(
        "INSERT INTO app.planned_exercises(user_id,exercise_id,planned_date,sort_order) VALUES($1,$2,'2026-02-30',2)",
        [alice, exercise],
        '22008',
      );
      await app.query('SET CONSTRAINTS app.plans_owner_date_order DEFERRED');
      await app.query(
        'UPDATE app.planned_exercises SET sort_order=1-sort_order WHERE user_id=$1',
        [alice],
      );
      await app.query('SET CONSTRAINTS app.plans_owner_date_order IMMEDIATE');
      assert.equal(
        (
          await app.query(
            'SELECT id FROM app.planned_exercises WHERE user_id=$1 ORDER BY sort_order,id',
            [alice],
          )
        ).rows[0].id,
        plan2,
      );
      await app.query("SET LOCAL TIME ZONE 'Pacific/Auckland'");
      assert.equal(
        (
          await app.query(
            'SELECT planned_date::text AS day FROM app.planned_exercises WHERE id=$1',
            [plan1],
          )
        ).rows[0].day,
        '2026-10-21',
      );
      await app.query(
        "UPDATE app.exercises SET status='rejected',reviewed_by=$1,reviewed_at=statement_timestamp(),archived_at=statement_timestamp() WHERE id=$2",
        [alice, exercise],
      );
      assert.equal(
        (
          await app.query(
            'SELECT count(*)::int AS n FROM app.workouts WHERE exercise_id=$1',
            [exercise],
          )
        ).rows[0].n,
        2,
      );
      await app.query('UPDATE app.workouts SET reps=12 WHERE id=$1', [workout]);
      await rejected(
        'DELETE FROM app.exercises WHERE id=$1',
        [exercise],
        '23503',
      );
      await rejected('DELETE FROM app.users WHERE id=$1', [alice], '23503');
      await app.query('DELETE FROM app.workouts WHERE id=$1', [workout]);
      assert.equal(
        (
          await app.query(
            'SELECT count(*)::int AS n FROM app.workout_create_requests WHERE id=$1',
            [workout],
          )
        ).rows[0].n,
        1,
      );
      await rejected(
        'DELETE FROM app.workout_create_requests WHERE id=$1',
        [workout],
        '42501',
      );
      await rejected(
        'UPDATE app.workout_create_requests SET request_hash=$2 WHERE id=$1',
        [workout, 'c'.repeat(64)],
        '42501',
      );
      await rejected(
        "INSERT INTO app.auth_sessions(user_id,token_hash,csrf_token,expires_at) VALUES($1,$2,$3,'2000-01-01')",
        [alice, 'a'.repeat(64), 'c'.repeat(43)],
        '23514',
      );
      await app.query(
        "INSERT INTO app.auth_sessions(user_id,token_hash,csrf_token,expires_at) VALUES($1,$2,$3,statement_timestamp()+interval '1 day')",
        [alice, 'a'.repeat(64), 'c'.repeat(43)],
      );
      await rejected(
        "INSERT INTO app.auth_sessions(user_id,token_hash,csrf_token,expires_at) VALUES($1,$2,$3,statement_timestamp()+interval '1 day')",
        [alice, 'a'.repeat(64), 'c'.repeat(43)],
        '23505',
      );
      await app.query('ROLLBACK');
      // Prove a failed migration does not leave its DDL or migration record behind.
      temporary = await mkdtemp(join(tmpdir(), 'gym-log-migrations-'));
      await cp('db/migrations', temporary, { recursive: true });
      await writeFile(
        join(
          temporary,
          `${Math.max(...migrationFiles.map((name) => Number(name.split('_')[0]))) + 1}_intentional_failure.sql`,
        ),
        '-- Up Migration\nCREATE TABLE app.rollback_probe(id integer);\nSELECT 1/0;\n-- Down Migration\nSELECT 1;\n',
      );
      await assert.rejects(
        migrate(temporary),
        (error: unknown) =>
          typeof error === 'object' &&
          error !== null &&
          'stderr' in error &&
          String(error.stderr).includes('division by zero'),
      );
      assert.equal(
        (
          await operator.query(
            "SELECT to_regclass('app.rollback_probe') AS name",
          )
        ).rows[0].name,
        null,
      );
      assert.equal(
        (
          await operator.query(
            'SELECT count(*)::int AS n FROM public.pgmigrations',
          )
        ).rows[0].n,
        migrationCount,
      );
    } finally {
      await app.end();
      await operator.end();
      if (created) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
      await admin.end();
      if (temporary) await rm(temporary, { recursive: true, force: true });
      if (legacyDirectory)
        await rm(legacyDirectory, { recursive: true, force: true });
    }
  },
);
