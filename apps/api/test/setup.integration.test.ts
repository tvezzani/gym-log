import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test } from 'node:test';
import pg from 'pg';
import request from 'supertest';
import { setupStatusSchema, userSchema } from '@gym-log/contracts';
import { createApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { bootstrapAdmin } from '../src/auth/bootstrap.js';

test(
  'one-time first-run admin setup with real PostgreSQL',
  { timeout: 60000 },
  async (t) => {
    assert.ok(process.env.MIGRATION_DATABASE_URL);
    assert.ok(process.env.DATABASE_URL);
    const database = `gym_log_setup_${randomUUID().replaceAll('-', '')}`,
      opUrl = new URL(process.env.MIGRATION_DATABASE_URL),
      appUrl = new URL(process.env.DATABASE_URL);
    opUrl.pathname = `/${database}`;
    appUrl.pathname = `/${database}`;
    const administrator = new pg.Client({
        connectionString: process.env.MIGRATION_DATABASE_URL,
      }),
      operator = new pg.Client({ connectionString: opUrl.href }),
      pool = new pg.Pool({ connectionString: appUrl.href });
    const config = readConfig({
        NODE_ENV: 'test',
        DATABASE_URL: appUrl.href,
        AUTH_SECRET: randomBytes(32).toString('hex'),
        APP_ORIGIN: 'http://127.0.0.1:3000',
      }),
      app = createApp({ pool, config });
    const password = 'Chosen-first-run-password!',
      input = { username: 'first_admin', password, timeZone: 'America/Denver' };
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
          'SETUP_TEST_URL',
          '--migrations-dir',
          'db/migrations',
          'up',
        ],
        { env: { ...process.env, SETUP_TEST_URL: opUrl.href } },
      );
      async function actor(target = app) {
        const agent = request.agent(target),
          csrf = await agent.get('/api/v1/auth/csrf').expect(200);
        return { agent, token: csrf.body.csrfToken as string };
      }
      type Actor = Awaited<ReturnType<typeof actor>>;
      const write = (a: Actor) =>
        a.agent
          .post('/api/v1/auth/setup')
          .set('Origin', config.APP_ORIGIN)
          .set('X-CSRF-Token', a.token);
      await t.test(
        'status is minimal; origin, signed CSRF and strict validation protect account creation',
        async () => {
          assert.deepEqual(
            setupStatusSchema.parse(
              (await request(app).get('/api/v1/auth/setup').expect(200)).body,
            ),
            { setupRequired: true },
          );
          await request(app)
            .get('/api/v1/auth/setup')
            .set('Sec-Fetch-Site', 'cross-site')
            .expect(403);
          const a = await actor();
          await a.agent
            .post('/api/v1/auth/setup')
            .set('Origin', config.APP_ORIGIN)
            .send(input)
            .expect(403);
          await write(a)
            .set('Origin', 'https://evil.invalid')
            .send(input)
            .expect(403);
          await write(a)
            .set('Sec-Fetch-Site', 'cross-site')
            .send(input)
            .expect(403);
          await write(a)
            .send({ ...input, password: '1234' })
            .expect(422);
          await write(a)
            .send({ ...input, role: 'admin' })
            .expect(422);
          await write(a)
            .send({ ...input, timeZone: 'Invalid/Timezone' })
            .expect(422);
          assert.equal(
            (await operator.query('SELECT count(*)::int AS n FROM app.users'))
              .rows[0].n,
            0,
          );
          assert.equal(
            (await request(app).get('/api/v1/auth/setup')).body.setupRequired,
            true,
          );
        },
      );
      await t.test(
        'disabled development fixtures do not configure an installation',
        async () => {
          await operator.query(
            "INSERT INTO app.users(id,username,password_hash,role,is_active,time_zone) VALUES('f1000000-0000-4000-8000-000000000001','fixture_admin','$argon2id$disabled-fixture-not-a-login-hash','admin',false,'UTC')",
          );
          assert.equal(
            (await request(app).get('/api/v1/auth/setup').expect(200)).body
              .setupRequired,
            true,
          );
          assert.equal(
            (
              await operator.query(
                'SELECT completed_at FROM app.installation WHERE id=1',
              )
            ).rows[0].completed_at,
            null,
          );
        },
      );
      await t.test(
        'concurrent setup requests produce exactly one admin with a final chosen password',
        async () => {
          const [a, b] = await Promise.all([actor(), actor()]);
          const responses = await Promise.all([
            write(a).send(input),
            write(b).send({ ...input, username: 'other_admin' }),
          ]);
          assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
          const winner = userSchema.parse(
            responses.find((r) => r.status === 201)!.body,
          );
          assert.equal(winner.role, 'admin');
          assert.equal(winner.mustChangePassword, false);
          assert.ok(!JSON.stringify(winner).includes(password));
          assert.equal(
            (
              await operator.query(
                'SELECT count(*)::int AS n FROM app.users WHERE is_active',
              )
            ).rows[0].n,
            1,
          );
          const stored = (
            await operator.query(
              'SELECT password_hash FROM app.users WHERE is_active',
            )
          ).rows[0].password_hash;
          assert.match(stored, /^\$argon2id\$/);
          assert.notEqual(stored, password);
          const login = await actor();
          const session = await login.agent
            .post('/api/v1/auth/login')
            .set('Origin', config.APP_ORIGIN)
            .set('X-CSRF-Token', login.token)
            .send({ username: winner.username, password })
            .expect(200);
          assert.equal(session.body.user.mustChangePassword, false);
          await login.agent.get('/api/v1/workouts').expect(200);
        },
      );
      await t.test(
        'completion persists across app restarts, disabled/demoted admins and expired sessions',
        async () => {
          assert.equal(
            (
              await request(createApp({ pool, config }))
                .get('/api/v1/auth/setup')
                .expect(200)
            ).body.setupRequired,
            false,
          );
          await operator.query(
            "UPDATE app.users SET is_active=false,role='user'",
          );
          assert.equal(
            (await request(app).get('/api/v1/auth/setup')).body.setupRequired,
            false,
          );
          await write(await actor())
            .send({ ...input, username: 'takeover' })
            .expect(409);
          // Explicit local CLI recovery remains available; it assigns a temporary password.
          const recovered = await bootstrapAdmin(pool, {
            ...input,
            username: 'recovered_admin',
          });
          assert.equal(recovered.mustChangePassword, true);
          assert.equal(
            (await request(app).get('/api/v1/auth/setup')).body.setupRequired,
            false,
          );
        },
      );
      await t.test(
        'runtime credentials cannot reopen setup or call its privileged marker function',
        async () => {
          for (const sql of [
            'UPDATE app.installation SET completed_at=NULL WHERE id=1',
            'DELETE FROM app.installation',
            'INSERT INTO app.installation(id) VALUES(1)',
            'SELECT app.record_installation_setup()',
          ])
            await assert.rejects(
              pool.query(sql),
              (e: unknown) =>
                typeof e === 'object' &&
                e !== null &&
                'code' in e &&
                e.code === '42501',
            );
        },
      );
      await t.test(
        'setup throttles persist across API instances and missing state fails closed',
        async () => {
          const isolated = {
              ...config,
              AUTH_SECRET: randomBytes(32).toString('hex'),
            },
            a = await actor(createApp({ pool, config: isolated }));
          for (let n = 0; n < 11; n++) {
            const response = await a.agent
              .post('/api/v1/auth/setup')
              .set('Origin', config.APP_ORIGIN)
              .set('X-CSRF-Token', a.token)
              .send({})
              .expect(n < 10 ? 422 : 429);
            if (n === 10)
              assert.ok(Number(response.headers['retry-after']) > 0);
          }
          const restarted = await actor(createApp({ pool, config: isolated }));
          await restarted.agent
            .post('/api/v1/auth/setup')
            .set('Origin', config.APP_ORIGIN)
            .set('X-CSRF-Token', restarted.token)
            .send({})
            .expect(429);
          await operator.query('DELETE FROM app.installation');
          await request(app).get('/api/v1/auth/setup').expect(500);
        },
      );
    } finally {
      await pool.end();
      await operator.end();
      if (created)
        await administrator.query(`DROP DATABASE ${database} WITH (FORCE)`);
      await administrator.end();
    }
  },
);
