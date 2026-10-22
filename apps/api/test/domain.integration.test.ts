import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test } from 'node:test';
import pg from 'pg';
import request from 'supertest';
import {
  exerciseSchema,
  exerciseListSchema,
  workoutSchema,
  workoutListSchema,
  planSchema,
  planListSchema,
  apiErrorSchema,
} from '@gym-log/contracts';
import { createApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { bootstrapAdmin } from '../src/auth/bootstrap.js';
import { transaction } from '../src/auth/service.js';

test(
  'domain API gate against real PostgreSQL',
  { timeout: 90000 },
  async (t) => {
    assert.ok(process.env.MIGRATION_DATABASE_URL);
    assert.ok(process.env.DATABASE_URL);
    const database = `gym_log_domain_${randomUUID().replaceAll('-', '')}`;
    assert.match(database, /^gym_log_domain_[a-f0-9]{32}$/);
    const operatorUrl = new URL(process.env.MIGRATION_DATABASE_URL),
      appUrl = new URL(process.env.DATABASE_URL);
    operatorUrl.pathname = `/${database}`;
    appUrl.pathname = `/${database}`;
    const administrator = new pg.Client({
        connectionString: process.env.MIGRATION_DATABASE_URL,
      }),
      operator = new pg.Client({ connectionString: operatorUrl.href });
    const pool = new pg.Pool({
      connectionString: appUrl.href,
      max: 12,
      connectionTimeoutMillis: 3000,
      statement_timeout: 5000,
    });
    const config = readConfig({
        NODE_ENV: 'test',
        DATABASE_URL: appUrl.href,
        AUTH_SECRET: randomBytes(32).toString('hex'),
        APP_ORIGIN: 'http://127.0.0.1:3000',
      }),
      app = createApp({ pool, config });
    const initial = 'Initial-domain-password!',
      password = 'Changed-domain-password!';
    async function login(username: string, secret: string) {
      const agent = request.agent(app),
        csrf = await agent.get('/api/v1/auth/csrf').expect(200);
      const response = await agent
        .post('/api/v1/auth/login')
        .set('Origin', config.APP_ORIGIN)
        .set('X-CSRF-Token', csrf.body.csrfToken)
        .send({ username, password: secret })
        .expect(200);
      return {
        cookie: (response.headers['set-cookie'] as unknown as string[])
          .find((value) => value.startsWith('gym_session='))!
          .split(';')[0]!,
        agent,
        csrf: response.body.csrfToken as string,
        id: response.body.user.id as string,
        username,
      };
    }
    type Actor = Awaited<ReturnType<typeof login>>;
    const write = (
      actor: Actor,
      method: 'post' | 'patch' | 'put' | 'delete',
      path: string,
    ) =>
      actor.agent[method](path)
        .set('Origin', config.APP_ORIGIN)
        .set('X-CSRF-Token', actor.csrf);
    async function ready(username: string) {
      const actor = await login(username, initial);
      await write(actor, 'patch', '/api/v1/auth/password')
        .send({ currentPassword: initial, newPassword: password })
        .expect(204);
      return login(username, password);
    }
    async function submit(actor: Actor, name: string) {
      const response = await write(actor, 'post', '/api/v1/exercises')
        .send({ name })
        .expect(201);
      return exerciseSchema.parse(response.body);
    }
    const input = (
      exerciseId: string,
      extra: Record<string, unknown> = {},
    ): { id: string; exerciseId: string } & Record<string, unknown> => ({
      id: randomUUID(),
      exerciseId,
      performedAt: '2026-10-21T18:34:56.123Z',
      reps: 10,
      weight: '135.125',
      ...extra,
    });
    async function save(
      actor: Actor,
      value: ReturnType<typeof input>,
      status = 201,
    ) {
      const response = await write(actor, 'post', '/api/v1/workouts')
        .send(value)
        .expect(status);
      return workoutSchema.parse(response.body);
    }
    async function plans(actor: Actor, date: string) {
      const response = await actor.agent
        .get('/api/v1/planned-exercises')
        .query({ plannedDate: date, limit: 100 })
        .expect(200);
      return planListSchema.parse(response.body);
    }
    async function plan(
      actor: Actor,
      exerciseId: string,
      date: string,
      notes = '3x10',
    ) {
      const response = await write(actor, 'post', '/api/v1/planned-exercises')
        .send({ exerciseId, plannedDate: date, notes })
        .expect(201);
      return planSchema.parse(response.body);
    }
    let created = false;
    try {
      await administrator.connect();
      await administrator.query(`CREATE DATABASE ${database}`);
      created = true;
      await operator.connect();
      await operator.query(`REVOKE ALL ON DATABASE ${database} FROM PUBLIC`);
      await operator.query(`GRANT CONNECT ON DATABASE ${database} TO gym_app`);
      await operator.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
      await promisify(execFile)(
        process.execPath,
        [
          'node_modules/node-pg-migrate/bin/node-pg-migrate.js',
          '--database-url-var',
          'MIGRATION_DATABASE_URL',
          '--migrations-dir',
          'db/migrations',
          'up',
        ],
        { env: { ...process.env, MIGRATION_DATABASE_URL: operatorUrl.href } },
      );
      await bootstrapAdmin(pool, {
        username: 'admin',
        password: initial,
        timeZone: 'America/Denver',
      });
      const admin = await ready('admin');
      for (const username of ['alice', 'bob'])
        await write(admin, 'post', '/api/v1/admin/users')
          .send({ username, password: initial, timeZone: 'America/Denver' })
          .expect(201);
      const alice = await ready('alice'),
        bob = await ready('bob');
      const pending = await submit(alice, 'Barbell squat');
      await t.test(
        'domain routes require authentication, same-origin writes and session CSRF',
        async () => {
          for (const path of [
            '/exercises',
            '/workouts',
            '/planned-exercises?plannedDate=2026-10-21',
          ])
            await request(app)
              .get('/api/v1' + path)
              .expect(401);
          await request(app)
            .post('/api/v1/exercises')
            .send({ name: 'Anonymous' })
            .expect(401);
          await alice.agent
            .post('/api/v1/workouts')
            .set('Origin', config.APP_ORIGIN)
            .send(input(pending.id))
            .expect(403);
          await write(alice, 'post', '/api/v1/workouts')
            .set('Origin', 'https://evil.invalid')
            .send(input(pending.id))
            .expect(403);
        },
      );
      const privateRequest = input(pending.id);
      let shared = pending;
      await t.test(
        'own pending exercises work privately; approval shares only the catalog ID',
        async () => {
          assert.equal(pending.submittedBy, alice.id);
          assert.equal(pending.status, 'pending');
          assert.equal(
            exerciseListSchema.parse(
              (await bob.agent.get('/api/v1/exercises').expect(200)).body,
            ).items.length,
            0,
          );
          assert.ok(
            exerciseListSchema
              .parse(
                (
                  await alice.agent
                    .get('/api/v1/exercise-submissions')
                    .expect(200)
                ).body,
              )
              .items.some((row) => row.id === pending.id),
          );
          assert.equal(
            (await bob.agent.get('/api/v1/exercise-submissions').expect(200))
              .body.items.length,
            0,
          );
          await bob.agent.get('/api/v1/admin/exercises').expect(403);
          const queue = exerciseListSchema.parse(
            (await admin.agent.get('/api/v1/admin/exercises').expect(200)).body,
          );
          assert.ok(queue.items.some((row) => row.id === pending.id));
          await save(alice, privateRequest);
          await plan(alice, pending.id, '2026-10-21');
          for (const stranger of [bob, admin]) {
            await write(stranger, 'post', '/api/v1/workouts')
              .send(input(pending.id))
              .expect(404);
            await write(stranger, 'post', '/api/v1/planned-exercises')
              .send({ exerciseId: pending.id, plannedDate: '2026-10-21' })
              .expect(404);
          }
          await write(
            alice,
            'post',
            `/api/v1/admin/exercises/${pending.id}/approve`,
          ).expect(403);
          await write(alice, 'patch', `/api/v1/exercises/${pending.id}`)
            .send({ name: 'Private rename' })
            .expect(403);
          shared = exerciseSchema.parse(
            (
              await write(
                admin,
                'post',
                `/api/v1/admin/exercises/${pending.id}/approve`,
              ).expect(200)
            ).body,
          );
          assert.equal(shared.id, pending.id);
          assert.equal(shared.reviewedBy, admin.id);
          assert.ok(shared.reviewedAt);
          assert.ok(
            (
              await bob.agent.get('/api/v1/exercises').expect(200)
            ).body.items.some((row: { id: string }) => row.id === shared.id),
          );
          assert.equal(
            (
              await bob.agent
                .get('/api/v1/workouts')
                .query({ exerciseId: shared.id, limit: 1 })
                .expect(200)
            ).body.items.length,
            0,
          );
          await write(
            admin,
            'post',
            `/api/v1/admin/exercises/${pending.id}/reject`,
          ).expect(409);
        },
      );
      await t.test(
        'sets and plans stay owner-scoped for two users and admin across all entry points',
        async () => {
          const actors = [alice, bob, admin],
            date = '2026-10-22';
          const rows = [];
          for (const owner of actors)
            rows.push({
              owner,
              set: await save(owner, input(shared.id)),
              plan: await plan(owner, shared.id, date),
            });
          for (const { owner, set, plan: entry } of rows)
            for (const other of actors.filter((actor) => actor !== owner)) {
              const hidden = await other.agent
                .get(`/api/v1/workouts/${set.id}`)
                .expect(404);
              apiErrorSchema.parse(hidden.body);
              await write(other, 'patch', `/api/v1/workouts/${set.id}`)
                .send({ reps: 99 })
                .expect(404);
              await write(other, 'delete', `/api/v1/workouts/${set.id}`).expect(
                404,
              );
              assert.ok(
                !(
                  await other.agent.get('/api/v1/workouts').expect(200)
                ).body.items.some((row: { id: string }) => row.id === set.id),
              );
              await write(
                other,
                'patch',
                `/api/v1/planned-exercises/${entry.id}`,
              )
                .send({ notes: 'stolen' })
                .expect(404);
              await write(
                other,
                'delete',
                `/api/v1/planned-exercises/${entry.id}`,
              ).expect(404);
              assert.ok(
                !(await plans(other, date)).items.some(
                  (row) => row.id === entry.id,
                ),
              );
              const own = (await plans(other, date)).items.map((row) => row.id);
              await write(other, 'put', '/api/v1/planned-exercises/order')
                .send({ plannedDate: date, orderedIds: [...own, entry.id] })
                .expect(409);
            }
          await alice.agent
            .get('/api/v1/workouts')
            .query({ userId: bob.id })
            .expect(422);
          await alice.agent
            .get('/api/v1/planned-exercises')
            .query({ plannedDate: date, userId: bob.id })
            .expect(422);
          await write(alice, 'post', '/api/v1/workouts')
            .send({ ...input(shared.id), userId: bob.id })
            .expect(422);
          await write(alice, 'post', '/api/v1/planned-exercises')
            .send({ exerciseId: shared.id, plannedDate: date, userId: bob.id })
            .expect(422);
          await write(alice, 'post', '/api/v1/exercises')
            .send({ name: 'Spoofed', submittedBy: bob.id })
            .expect(422);
        },
      );
      await t.test(
        'create retries normalize values, serialize races, preserve edits and cannot resurrect deleted sets',
        async () => {
          const original = input(shared.id, {
            weight: '135.500',
            performedAt: '2026-10-21T12:34:56.123-06:00',
          });
          const createdSet = await save(alice, original);
          const reloaded = createApp({ pool, config });
          const readBack = await request(reloaded)
            .get(`/api/v1/workouts/${original.id}`)
            .set('Cookie', alice.cookie)
            .expect(200);
          assert.equal(workoutSchema.parse(readBack.body).id, createdSet.id);
          const replay = await request(reloaded)
            .post('/api/v1/workouts')
            .set('Cookie', alice.cookie)
            .set('Origin', config.APP_ORIGIN)
            .set('X-CSRF-Token', alice.csrf)
            .send(original)
            .expect(200);
          assert.equal(replay.body.id, createdSet.id);

          assert.equal(createdSet.weight, '135.5');
          assert.equal(createdSet.rpe, 5);
          assert.equal(createdSet.setNumber, 1);
          assert.equal(createdSet.performedAt, '2026-10-21T18:34:56.123Z');
          await save(
            alice,
            {
              ...original,
              id: original.id.toUpperCase(),
              exerciseId: shared.id.toUpperCase(),
              weight: '135.5',
              performedAt: '2026-10-21T18:34:56.123Z',
              rpe: 5,
              setNumber: 1,
            },
            200,
          );
          const conflict = await write(alice, 'post', '/api/v1/workouts')
            .send({ ...original, reps: 11 })
            .expect(409);
          assert.deepEqual(
            (
              await write(bob, 'post', '/api/v1/workouts')
                .send(original)
                .expect(409)
            ).body,
            conflict.body,
          );
          const edited = workoutSchema.parse(
            (
              await write(alice, 'patch', `/api/v1/workouts/${original.id}`)
                .send({ weight: '140.125', reps: 12 })
                .expect(200)
            ).body,
          );
          assert.equal(
            (await save(alice, original, 200)).weight,
            edited.weight,
          );
          assert.equal((await save(alice, original, 200)).reps, 12);
          await write(
            alice,
            'delete',
            `/api/v1/workouts/${original.id}`,
          ).expect(204);
          await write(alice, 'post', '/api/v1/workouts')
            .send(original)
            .expect(410);
          assert.equal(
            (
              await operator.query(
                'SELECT count(*)::int AS n FROM app.workouts WHERE id=$1',
                [original.id],
              )
            ).rows[0].n,
            0,
          );
          assert.equal(
            (
              await operator.query(
                'SELECT count(*)::int AS n FROM app.workout_create_requests WHERE id=$1',
                [original.id],
              )
            ).rows[0].n,
            1,
          );
          const repeated = input(shared.id);
          const responses = await Promise.all(
            Array.from({ length: 6 }, () =>
              write(alice, 'post', '/api/v1/workouts').send(repeated),
            ),
          );
          assert.equal(responses.filter((row) => row.status === 201).length, 1);
          assert.equal(responses.filter((row) => row.status === 200).length, 5);
          const clash = input(shared.id),
            collision = await Promise.all([
              write(alice, 'post', '/api/v1/workouts').send(clash),
              write(bob, 'post', '/api/v1/workouts').send(clash),
            ]);
          assert.deepEqual(
            collision.map((row) => row.status).sort(),
            [201, 409],
          );
          assert.equal(
            (
              await operator.query(
                'SELECT count(*)::int AS n FROM app.workouts WHERE id=$1',
                [clash.id],
              )
            ).rows[0].n,
            1,
          );
          const different = input(shared.id),
            competition = await Promise.all(
              [10, 11].map((reps) =>
                write(alice, 'post', '/api/v1/workouts').send({
                  ...different,
                  reps,
                }),
              ),
            );
          assert.deepEqual(
            competition.map((row) => row.status).sort(),
            [201, 409],
          );
        },
      );
      await t.test(
        'rejection and archival preserve references; only changed/new exercise selections need eligibility',
        async () => {
          const rejected = await submit(alice, 'Rejected press'),
            original = input(rejected.id),
            saved = await save(alice, original),
            entry = await plan(alice, rejected.id, '2026-10-23');
          const decision = exerciseSchema.parse(
            (
              await write(
                admin,
                'post',
                `/api/v1/admin/exercises/${rejected.id}/reject`,
              ).expect(200)
            ).body,
          );
          assert.equal(decision.status, 'rejected');
          assert.equal(
            (await alice.agent.get(`/api/v1/workouts/${saved.id}`).expect(200))
              .body.exercise.status,
            'rejected',
          );
          await save(alice, original, 200);
          await write(alice, 'patch', `/api/v1/workouts/${saved.id}`)
            .send({ exerciseId: rejected.id.toUpperCase(), reps: 11 })
            .expect(200);
          await write(alice, 'patch', `/api/v1/planned-exercises/${entry.id}`)
            .send({ notes: 'still historical' })
            .expect(200);
          assert.equal(
            (
              await write(alice, 'post', '/api/v1/workouts')
                .send(input(rejected.id))
                .expect(409)
            ).body.error.code,
            'EXERCISE_UNAVAILABLE',
          );
          await write(alice, 'post', '/api/v1/planned-exercises')
            .send({ exerciseId: rejected.id, plannedDate: '2026-10-23' })
            .expect(409);
          await write(bob, 'post', '/api/v1/workouts')
            .send(input(rejected.id))
            .expect(404);
          const renamed = exerciseSchema.parse(
            (
              await write(admin, 'patch', `/api/v1/exercises/${rejected.id}`)
                .send({ name: 'Renamed rejected press' })
                .expect(200)
            ).body,
          );
          assert.equal(
            (await alice.agent.get(`/api/v1/workouts/${saved.id}`).expect(200))
              .body.exercise.name,
            renamed.name,
          );
          await write(admin, 'patch', `/api/v1/exercises/${shared.id}`)
            .send({ isArchived: true })
            .expect(200);
          await write(alice, 'patch', `/api/v1/workouts/${saved.id}`)
            .send({ exerciseId: shared.id })
            .expect(409);
          await write(alice, 'patch', `/api/v1/planned-exercises/${entry.id}`)
            .send({ exerciseId: shared.id })
            .expect(409);
          await save(alice, privateRequest, 200);
          await write(bob, 'post', '/api/v1/workouts')
            .send(input(shared.id))
            .expect(409);
          await write(bob, 'post', '/api/v1/planned-exercises')
            .send({ exerciseId: shared.id, plannedDate: '2026-10-23' })
            .expect(409);
          assert.ok(
            !(
              await bob.agent.get('/api/v1/exercises').expect(200)
            ).body.items.some((row: { id: string }) => row.id === shared.id),
          );
          await write(admin, 'delete', `/api/v1/exercises/${shared.id}`).expect(
            404,
          );
          await write(admin, 'patch', `/api/v1/exercises/${shared.id}`)
            .send({ isArchived: false, name: 'Barbell back squat' })
            .expect(200);
          await write(alice, 'patch', `/api/v1/workouts/${saved.id}`)
            .send({ exerciseId: shared.id })
            .expect(200);
          await write(alice, 'patch', `/api/v1/workouts/${saved.id}`)
            .send({ exerciseId: rejected.id })
            .expect(409);
        },
      );
      await t.test(
        'numeric/date validation rejects corrupt input before any retry identity is committed',
        async () => {
          for (const invalid of [
            { weight: 135.5 },
            { weight: '1.0001' },
            { weight: '100000' },
            { weight: '-1' },
            { weight: '1e2' },
            { weight: '01' },
            { reps: 0 },
            { reps: 1.5 },
            { setNumber: 0 },
            { setNumber: 2.5 },
            { rpe: 0 },
            { rpe: 11 },
            { rpe: 5.5 },
            { performedAt: '2026-10-21T18:34:56.1234Z' },
            { performedAt: '2026-10-21T18:34:56.123' },
          ]) {
            const value = input(shared.id, invalid);
            await write(alice, 'post', '/api/v1/workouts')
              .send(value)
              .expect(422);
            assert.equal(
              (
                await operator.query(
                  'SELECT count(*)::int AS n FROM app.workout_create_requests WHERE id=$1',
                  [value.id],
                )
              ).rows[0].n,
              0,
            );
          }
          const maximum = await save(
            alice,
            input(shared.id, {
              weight: '99999.999',
              reps: 2147483647,
              rpe: 10,
            }),
          );
          assert.equal(maximum.weight, '99999.999');
          const zero = await save(alice, input(shared.id, { weight: '0.000' }));
          assert.equal(zero.weight, '0');
          assert.equal(zero.setNumber, 1);
          for (const date of ['2026-02-29', '2026-04-31', '0000-01-01'])
            await write(alice, 'post', '/api/v1/planned-exercises')
              .send({ exerciseId: shared.id, plannedDate: date })
              .expect(422);
          await write(alice, 'patch', `/api/v1/workouts/${zero.id}`)
            .send({})
            .expect(422);
          await write(alice, 'patch', `/api/v1/workouts/${zero.id}`)
            .send({ createdAt: '2026-01-01T00:00:00.000Z' })
            .expect(422);
          await alice.agent
            .get('/api/v1/workouts')
            .query({ limit: 101 })
            .expect(422);
          await alice.agent
            .get('/api/v1/workouts')
            .query({
              start: '2026-10-22T00:00:00.000Z',
              end: '2026-10-21T00:00:00.000Z',
            })
            .expect(422);
        },
      );
      await t.test(
        'history uses performed time, stable ties, owner/exercise filters and 23/25-hour DST ranges',
        async () => {
          const exercise = await submit(alice, 'History exercise');
          await write(
            admin,
            'post',
            `/api/v1/admin/exercises/${exercise.id}/approve`,
          ).expect(200);
          for (const [start, end, hours] of [
            ['2026-03-08T07:00:00.000Z', '2026-03-09T06:00:00.000Z', 23],
            ['2026-11-01T06:00:00.000Z', '2026-11-02T07:00:00.000Z', 25],
          ] as const) {
            assert.equal(
              (Date.parse(end) - Date.parse(start)) / 3600000,
              hours,
            );
            const samples = [
              new Date(Date.parse(start) - 1).toISOString(),
              start,
              new Date(Date.parse(end) - 1).toISOString(),
              end,
            ];
            const rows = [];
            for (const time of samples)
              rows.push(
                await save(alice, input(exercise.id, { performedAt: time })),
              );
            await save(bob, input(exercise.id, { performedAt: start }));
            const listed = workoutListSchema.parse(
              (
                await alice.agent
                  .get('/api/v1/workouts')
                  .query({ exerciseId: exercise.id, start, end })
                  .expect(200)
              ).body,
            );
            assert.deepEqual(
              listed.items.map((row) => row.id),
              [rows[2]!.id, rows[1]!.id],
            );
          }
          const same = '2027-01-01T00:00:00.000Z',
            tied = [];
          for (let n = 0; n < 3; n++)
            tied.push(
              (await save(alice, input(exercise.id, { performedAt: same }))).id,
            );
          await save(
            alice,
            input(exercise.id, { performedAt: '2000-01-01T00:00:00.000Z' }),
          );
          const expected = [...tied].sort().reverse(),
            actual = [];
          for (let offset = 0; offset < 3; offset++)
            actual.push(
              (
                await alice.agent
                  .get('/api/v1/workouts')
                  .query({ exerciseId: exercise.id, limit: 1, offset })
                  .expect(200)
              ).body.items[0].id,
            );
          assert.deepEqual(actual, expected);
          assert.equal(
            (
              await alice.agent
                .get('/api/v1/workouts')
                .query({ exerciseId: exercise.id, limit: 1 })
                .expect(200)
            ).body.items[0].id,
            expected[0],
          );
          const catalog = exerciseListSchema.parse(
            (await alice.agent.get('/api/v1/exercises').expect(200)).body,
          );
          assert.ok(
            catalog.items.every(
              (row) => row.status === 'approved' && row.archivedAt === null,
            ),
          );
        },
      );
      await t.test(
        'plan CRUD preserves calendar dates and notes, orders atomically and never creates workouts',
        async () => {
          const date = '2030-01-01',
            before = (
              await operator.query(
                'SELECT count(*)::int AS n FROM app.workouts',
              )
            ).rows[0].n;
          const first = await plan(alice, shared.id, date),
            second = await plan(alice, shared.id, date, '3x8'),
            third = await plan(alice, shared.id, date, 'plain notes');
          assert.deepEqual(
            (await plans(alice, date)).items.map((row) => row.sortOrder),
            [0, 1, 2],
          );
          const ids = [third.id, first.id, second.id];
          await write(alice, 'put', '/api/v1/planned-exercises/order')
            .send({ plannedDate: date, orderedIds: ids })
            .expect(204);
          assert.deepEqual(
            (await plans(alice, date)).items.map((row) => row.id),
            ids,
          );
          await write(alice, 'put', '/api/v1/planned-exercises/order')
            .send({
              plannedDate: date,
              orderedIds: [first.id, first.id, second.id],
            })
            .expect(422);
          await write(alice, 'put', '/api/v1/planned-exercises/order')
            .send({ plannedDate: date, orderedIds: [first.id] })
            .expect(409);
          assert.deepEqual(
            (await plans(alice, date)).items.map((row) => row.id),
            ids,
          );
          await write(alice, 'patch', '/api/v1/preferences')
            .send({ timeZone: 'Asia/Tokyo' })
            .expect(200);
          assert.ok(
            (await plans(alice, date)).items.every(
              (row) => row.plannedDate === date,
            ),
          );
          const moved = planSchema.parse(
            (
              await write(
                alice,
                'patch',
                `/api/v1/planned-exercises/${first.id}`,
              )
                .send({ plannedDate: '2030-01-02', notes: 'changed' })
                .expect(200)
            ).body,
          );
          assert.equal(moved.plannedDate, '2030-01-02');
          assert.equal(moved.notes, 'changed');
          assert.equal(moved.sortOrder, 0);
          await write(
            alice,
            'delete',
            `/api/v1/planned-exercises/${first.id}`,
          ).expect(204);
          assert.equal((await plans(alice, '2030-01-02')).items.length, 0);
          await write(alice, 'put', '/api/v1/planned-exercises/order')
            .send({ plannedDate: '2030-01-02', orderedIds: [] })
            .expect(204);
          assert.equal(
            (
              await operator.query(
                'SELECT count(*)::int AS n FROM app.workouts',
              )
            ).rows[0].n,
            before,
          );
          await alice.agent.get('/api/v1/planned-exercises').expect(422);
        },
      );
      await t.test(
        'concurrent appends, reorders, creates and date moves produce complete owner-scoped orders',
        async () => {
          const date = '2030-02-01';
          const responses = await Promise.all(
            Array.from({ length: 6 }, () =>
              write(alice, 'post', '/api/v1/planned-exercises').send({
                exerciseId: shared.id,
                plannedDate: date,
              }),
            ),
          );
          assert.ok(responses.every((row) => row.status === 201));
          const original = (await plans(alice, date)).items.map(
            (row) => row.id,
          );
          assert.equal(
            new Set(responses.map((row) => row.body.sortOrder)).size,
            6,
          );
          const reverse = [...original].reverse(),
            rotated = [...original.slice(1), original[0]!];
          const reorders = await Promise.all(
            [reverse, rotated].map((orderedIds) =>
              write(alice, 'put', '/api/v1/planned-exercises/order').send({
                plannedDate: date,
                orderedIds,
              }),
            ),
          );
          assert.ok(reorders.every((row) => row.status === 204));
          const current = (await plans(alice, date)).items.map((row) => row.id);
          assert.ok(
            JSON.stringify(current) === JSON.stringify(reverse) ||
              JSON.stringify(current) === JSON.stringify(rotated),
          );
          const [append, reorder] = await Promise.all([
            write(alice, 'post', '/api/v1/planned-exercises').send({
              exerciseId: shared.id,
              plannedDate: date,
            }),
            write(alice, 'put', '/api/v1/planned-exercises/order').send({
              plannedDate: date,
              orderedIds: [...current].reverse(),
            }),
          ]);
          assert.equal(append.status, 201);
          assert.ok([204, 409].includes(reorder.status));
          const final = (await plans(alice, date)).items;
          assert.equal(final.length, 7);
          assert.equal(new Set(final.map((row) => row.sortOrder)).size, 7);
          const left = await plan(alice, shared.id, '2030-02-02'),
            right = await plan(alice, shared.id, '2030-02-03');
          const moves = await Promise.all([
            write(alice, 'patch', `/api/v1/planned-exercises/${left.id}`).send({
              plannedDate: '2030-02-03',
            }),
            write(alice, 'patch', `/api/v1/planned-exercises/${right.id}`).send(
              { plannedDate: '2030-02-02' },
            ),
          ]);
          assert.ok(moves.every((row) => row.status === 200));
          assert.equal(
            (await plans(alice, '2030-02-02')).items[0]!.id,
            right.id,
          );
          assert.equal(
            (await plans(alice, '2030-02-03')).items[0]!.id,
            left.id,
          );
        },
      );
      await t.test(
        'daily plan bounds and 500-entry reorder are enforced without partial moves',
        async () => {
          const date = '2031-01-01';
          await operator.query(
            'INSERT INTO app.planned_exercises(user_id,exercise_id,planned_date,sort_order) SELECT $1,$2,$3::date,n FROM generate_series(0,498) AS n',
            [alice.id, shared.id, date],
          );
          const last = await plan(alice, shared.id, date);
          assert.equal(last.sortOrder, 499);
          await write(alice, 'post', '/api/v1/planned-exercises')
            .send({ exerciseId: shared.id, plannedDate: date })
            .expect(409);
          const other = await plan(alice, shared.id, '2031-01-02');
          await write(alice, 'patch', `/api/v1/planned-exercises/${other.id}`)
            .send({ plannedDate: date })
            .expect(409);
          assert.equal(
            (await plans(alice, '2031-01-02')).items[0]!.id,
            other.id,
          );
          const ids = (
            await operator.query<{ id: string }>(
              'SELECT id FROM app.planned_exercises WHERE user_id=$1 AND planned_date=$2::date ORDER BY sort_order DESC',
              [alice.id, date],
            )
          ).rows.map((row) => row.id);
          await write(alice, 'put', '/api/v1/planned-exercises/order')
            .send({ plannedDate: date, orderedIds: ids })
            .expect(204);
          const firstPage = await plans(alice, date);
          assert.equal(firstPage.items.length, 100);
          assert.equal(firstPage.pagination.hasMore, true);
          assert.deepEqual(
            firstPage.items.map((row) => row.id),
            ids.slice(0, 100),
          );
          const tail = planListSchema.parse(
            (
              await alice.agent
                .get('/api/v1/planned-exercises')
                .query({ plannedDate: date, limit: 100, offset: 400 })
                .expect(200)
            ).body,
          );
          assert.equal(tail.items.length, 100);
          assert.equal(tail.pagination.hasMore, false);
        },
      );
      await t.test(
        'exercise row locks prevent stale archive decisions from admitting new sets or plans',
        async () => {
          const exercise = await submit(alice, 'Race exercise');
          await write(
            admin,
            'post',
            `/api/v1/admin/exercises/${exercise.id}/approve`,
          ).expect(200);
          async function waitForExerciseLock() {
            for (let n = 0; n < 100; n++) {
              await operator.query('SELECT pg_stat_clear_snapshot()');
              const waiting = await operator.query(
                "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FROM app.exercises WHERE id=$1 FOR SHARE%'",
              );
              if (waiting.rowCount) return;
              await new Promise((resolve) => setTimeout(resolve, 10));
            }
            throw new Error(
              'Expected exercise eligibility check to wait for the archive transaction',
            );
          }
          for (const kind of ['set', 'plan']) {
            await operator.query(
              'UPDATE app.exercises SET archived_at=NULL WHERE id=$1',
              [exercise.id],
            );
            await operator.query('BEGIN');
            try {
              await operator.query(
                'UPDATE app.exercises SET archived_at=statement_timestamp() WHERE id=$1',
                [exercise.id],
              );
              const value = input(exercise.id),
                pending = (
                  kind === 'set'
                    ? write(alice, 'post', '/api/v1/workouts').send(value)
                    : write(alice, 'post', '/api/v1/planned-exercises').send({
                        exerciseId: exercise.id,
                        plannedDate: '2032-01-01',
                      })
                ).then((response) => response);
              await waitForExerciseLock();
              await operator.query('COMMIT');
              const response = await pending;
              assert.equal(response.status, 409);
              if (kind === 'set')
                assert.equal(
                  (
                    await operator.query(
                      'SELECT count(*)::int AS n FROM app.workout_create_requests WHERE id=$1',
                      [value.id],
                    )
                  ).rows[0].n,
                  0,
                );
              else
                assert.equal(
                  (
                    await operator.query(
                      'SELECT count(*)::int AS n FROM app.planned_exercises WHERE exercise_id=$1',
                      [exercise.id],
                    )
                  ).rows[0].n,
                  0,
                );
            } finally {
              await operator.query('ROLLBACK');
            }
          }
          const review = await submit(bob, 'Review race');
          const outcomes = await Promise.all(
            ['approve', 'reject'].map((action) =>
              write(
                admin,
                'post',
                `/api/v1/admin/exercises/${review.id}/${action}`,
              ),
            ),
          );
          assert.deepEqual(
            outcomes.map((row) => row.status).sort(),
            [200, 409],
          );
        },
      );
      await t.test(
        'serialization retries roll back the whole transaction and stop after three attempts',
        async () => {
          let attempts = 0;
          await transaction(pool, async (db) => {
            attempts++;
            await db.query(
              "INSERT INTO app.exercises(id,name,submitted_by) VALUES($1,'Retry probe',$2)",
              ['f9999999-0000-4000-8000-000000000001', alice.id],
            );
            if (attempts === 1)
              await db.query(
                "DO $$ BEGIN RAISE EXCEPTION 'test serialization' USING ERRCODE='40001'; END $$",
              );
          });
          assert.equal(attempts, 2);
          assert.equal(
            (
              await operator.query(
                "SELECT count(*)::int AS n FROM app.exercises WHERE id='f9999999-0000-4000-8000-000000000001'",
              )
            ).rows[0].n,
            1,
          );
          attempts = 0;
          await assert.rejects(
            transaction(pool, async (db) => {
              attempts++;
              await db.query(
                "DO $$ BEGIN RAISE EXCEPTION 'test deadlock' USING ERRCODE='40P01'; END $$",
              );
            }),
            (error: unknown) =>
              error instanceof Error &&
              'status' in error &&
              error.status === 409,
          );
          assert.equal(attempts, 3);
        },
      );
    } finally {
      await operator.query('ROLLBACK').catch(() => {});
      await pool.end();
      await operator.end();
      if (created)
        await administrator.query(`DROP DATABASE ${database} WITH (FORCE)`);
      await administrator.end();
    }
  },
);
