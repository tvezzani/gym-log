import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { test } from 'node:test';
import pg from 'pg';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { bootstrapAdmin } from '../src/auth/bootstrap.js';
import { tokenHash, SESSION_MS } from '../src/auth/service.js';

test(
  'PostgreSQL-backed authentication and two-role account administration',
  { timeout: 60000 },
  async (t) => {
    assert.ok(process.env.MIGRATION_DATABASE_URL);
    assert.ok(process.env.DATABASE_URL);
    const database = `gym_log_auth_${randomUUID().replaceAll('-', '')}`;
    assert.match(database, /^gym_log_auth_[a-f0-9]{32}$/);
    const operatorUrl = new URL(process.env.MIGRATION_DATABASE_URL),
      appUrl = new URL(process.env.DATABASE_URL);
    operatorUrl.pathname = `/${database}`;
    appUrl.pathname = `/${database}`;
    const admin = new pg.Client({
      connectionString: process.env.MIGRATION_DATABASE_URL,
    });
    const operator = new pg.Client({ connectionString: operatorUrl.href });
    const pool = new pg.Pool({ connectionString: appUrl.href, max: 8 });
    const config = readConfig({
      NODE_ENV: 'test',
      DATABASE_URL: appUrl.href,
      AUTH_SECRET: randomBytes(32).toString('hex'),
      APP_ORIGIN: 'http://127.0.0.1:3000',
    });
    const app = createApp({ pool, config });
    const origin = config.APP_ORIGIN;
    const initial = 'Initial-example-password!',
      changed = 'Changed-example-password!',
      temporary = 'Temporary-example-password!',
      memberPass = 'User-changed-password!';
    const cookies = (response: request.Response) =>
      response.headers['set-cookie'] as unknown as string[];
    const sessionCookie = (response: request.Response) =>
      cookies(response)
        .find((value) => value.startsWith('gym_session='))!
        .split(';')[0]!;
    async function login(
      username: string,
      password: string,
      status = 200,
      application = app,
    ) {
      const agent = request.agent(application),
        csrf = await agent.get('/api/v1/auth/csrf').expect(200);
      const response = await agent
        .post('/api/v1/auth/login')
        .set('Origin', origin)
        .set('X-CSRF-Token', csrf.body.csrfToken)
        .send({ username, password })
        .expect(status);
      return {
        agent,
        token: response.body.csrfToken as string,
        response,
        username,
      };
    }
    type Actor = Awaited<ReturnType<typeof login>>;
    const mutate = (actor: Actor, method: 'post' | 'patch', path: string) =>
      actor.agent[method](path)
        .set('Origin', origin)
        .set('X-CSRF-Token', actor.token);
    async function change(
      actor: Actor,
      oldPassword: string,
      newPassword: string,
    ) {
      await mutate(actor, 'patch', '/api/v1/auth/password')
        .send({ currentPassword: oldPassword, newPassword })
        .expect(204);
      await actor.agent.get('/api/v1/auth/me').expect(401);
      const result = await login(actor.username, newPassword);
      assert.equal(result.response.body.user.mustChangePassword, false);
      return result;
    }
    let created = false;
    try {
      await admin.connect();
      await admin.query(`CREATE DATABASE ${database}`);
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
      await t.test(
        'bootstrap CLI takes a secret over stdin and creates a restricted first admin',
        async () => {
          const child = spawn(
            process.execPath,
            [
              '--import',
              'tsx',
              'apps/api/src/auth/bootstrap-cli.ts',
              '--username',
              'admin_one',
              '--time-zone',
              'America/Denver',
            ],
            {
              env: {
                ...process.env,
                DATABASE_URL: appUrl.href,
                AUTH_SECRET: config.AUTH_SECRET,
                APP_ORIGIN: origin,
                NODE_ENV: 'test',
              },
              stdio: ['pipe', 'pipe', 'pipe'],
            },
          );
          let output = '';
          child.stdout.on('data', (data) => {
            output += String(data);
          });
          child.stderr.on('data', (data) => {
            output += String(data);
          });
          const exited = new Promise<number | null>((resolve, reject) => {
            child.once('exit', resolve);
            child.once('error', reject);
          });
          child.stdin.end(initial);
          assert.equal(await exited, 0);
          assert.ok(output.includes('First admin created'));
          assert.equal(output.includes(initial), false);
          const row = (
            await operator.query(
              "SELECT * FROM app.users WHERE username='admin_one'",
            )
          ).rows[0];
          assert.equal(row.role, 'admin');
          assert.equal(row.must_change_password, true);
          assert.match(row.password_hash, /^\$argon2id\$/);
          assert.notEqual(row.password_hash, initial);
          await assert.rejects(
            bootstrapAdmin(pool, {
              username: 'not_allowed',
              password: initial,
              timeZone: 'UTC',
            }),
          );
        },
      );
      let owner = await login('admin_one', initial);
      const ownerId = owner.response.body.user.id as string;
      await t.test(
        'forced change restricts admins too, validates current/new passwords, and revokes the session',
        async () => {
          assert.equal(owner.response.body.user.mustChangePassword, true);
          await owner.agent.get('/api/v1/auth/me').expect(200);
          const blocked = await owner.agent
            .get('/api/v1/admin/users')
            .expect(403);
          assert.equal(blocked.body.error.code, 'PASSWORD_CHANGE_REQUIRED');
          await owner.agent.get('/api/v1/workouts').expect(403);
          await mutate(owner, 'patch', '/api/v1/auth/password')
            .send({ currentPassword: initial, newPassword: initial })
            .expect(422);
          await mutate(owner, 'patch', '/api/v1/auth/password')
            .send({
              currentPassword: 'Wrong-current-password!',
              newPassword: changed,
            })
            .expect(401);
          owner = await change(owner, initial, changed);
        },
      );
      await t.test(
        'sessions rotate, store only a hash, and expire after an absolute 30 days',
        async () => {
          const oldCookie = sessionCookie(owner.response),
            before = oldCookie.split('=')[1]!;
          const csrf = await owner.agent.get('/api/v1/auth/csrf').expect(200);
          const response = await owner.agent
            .post('/api/v1/auth/login')
            .set('Origin', origin)
            .set('X-CSRF-Token', csrf.body.csrfToken)
            .send({ username: owner.username, password: changed })
            .expect(200);
          const next = sessionCookie(response).split('=')[1]!;
          assert.notEqual(next, before);
          await request(app)
            .get('/api/v1/auth/me')
            .set('Cookie', oldCookie)
            .expect(401);
          const stored = (
            await operator.query(
              'SELECT token_hash,extract(epoch FROM expires_at-created_at)*1000 AS duration FROM app.auth_sessions WHERE token_hash=$1',
              [tokenHash(next)],
            )
          ).rows[0];
          assert.notEqual(stored.token_hash, next);
          assert.equal(Number(stored.duration), SESSION_MS);
          assert.match(
            cookies(response).find((value) =>
              value.startsWith('gym_session='),
            )!,
            /HttpOnly/,
          );
          assert.match(
            cookies(response).find((value) =>
              value.startsWith('gym_session='),
            )!,
            /SameSite=Lax/,
          );
          owner = { ...owner, token: response.body.csrfToken, response };
        },
      );
      let user: Actor;
      let memberId = '';
      await t.test(
        'admin-created users must change passwords; all outputs are deliberately shaped',
        async () => {
          await mutate(owner, 'post', '/api/v1/admin/users')
            .send({
              username: 'bad_role',
              password: initial,
              timeZone: 'UTC',
              role: 'owner',
            })
            .expect(422);
          await mutate(owner, 'post', '/api/v1/admin/users')
            .send({
              username: 'bad_owner',
              password: initial,
              timeZone: 'UTC',
              userId: ownerId,
            })
            .expect(422);
          const response = await mutate(owner, 'post', '/api/v1/admin/users')
            .send({
              username: 'member_one',
              password: initial,
              timeZone: 'America/Denver',
            })
            .expect(201);
          memberId = response.body.id;
          assert.equal(response.body.role, 'user');
          assert.equal(response.body.mustChangePassword, true);
          user = await login('member_one', initial);
          await user.agent.get('/api/v1/workouts').expect(403);
          user = await change(user, initial, memberPass);
          await user.agent.get('/api/v1/admin/users').expect(403);
          await mutate(user, 'post', '/api/v1/admin/users')
            .send({ username: 'sneaky', password: initial, timeZone: 'UTC' })
            .expect(403);
          const users = await owner.agent
            .get('/api/v1/admin/users?limit=1')
            .expect(200);
          assert.equal(users.body.items.length, 1);
          assert.equal(users.body.pagination.hasMore, true);
          for (const user of users.body.items)
            assert.deepEqual(
              Object.keys(user).sort(),
              [
                'id',
                'username',
                'role',
                'isActive',
                'mustChangePassword',
                'timeZone',
                'createdAt',
                'updatedAt',
              ].sort(),
            );
          assert.equal(JSON.stringify(users.body).includes('$argon2'), false);
          assert.equal(JSON.stringify(response.body).includes(initial), false);
          await owner.agent
            .get('/api/v1/admin/users?userId=' + memberId)
            .expect(422);
          const preference = await mutate(user, 'patch', '/api/v1/preferences')
            .send({ timeZone: 'UTC' })
            .expect(200);
          assert.equal(preference.body.id, memberId);
          assert.equal(preference.body.timeZone, 'UTC');
        },
      );
      await t.test(
        'mutations require the signed cookie context, matching CSRF token and exact origin',
        async () => {
          await user.agent
            .patch('/api/v1/preferences')
            .set('Origin', origin)
            .send({ timeZone: 'UTC' })
            .expect(403);
          await user.agent
            .patch('/api/v1/preferences')
            .set('X-CSRF-Token', user.token)
            .send({ timeZone: 'UTC' })
            .expect(403);
          await mutate(user, 'patch', '/api/v1/preferences')
            .set('Origin', 'https://evil.invalid')
            .send({ timeZone: 'UTC' })
            .expect(403);
          await mutate(user, 'patch', '/api/v1/preferences')
            .set('X-CSRF-Token', 'x'.repeat(43))
            .send({ timeZone: 'UTC' })
            .expect(403);
          const unknown = request.agent(app);
          await unknown.get('/api/v1/auth/csrf').expect(200);
          await unknown
            .post('/api/v1/auth/login')
            .set('Origin', origin)
            .send({ username: 'admin_one', password: changed })
            .expect(403);
          await request(app)
            .post('/api/v1/auth/login')
            .set('Origin', origin)
            .set(
              'Cookie',
              `gym_preauth=${'x'.repeat(43)}.${Date.now() + 60000}.${'y'.repeat(43)}`,
            )
            .set('X-CSRF-Token', 'x'.repeat(43))
            .send({ username: 'admin_one', password: changed })
            .expect(403);
          await request(app)
            .get('/api/v1/auth/csrf')
            .set('Sec-Fetch-Site', 'cross-site')
            .expect(403);
        },
      );
      await t.test(
        'disable/reset revoke every old session, and a reset immediately restores the restriction',
        async () => {
          const other = await login('member_one', memberPass);
          await mutate(owner, 'patch', `/api/v1/admin/users/${memberId}`)
            .send({ isActive: false })
            .expect(200);
          await user.agent.get('/api/v1/auth/me').expect(401);
          await other.agent.get('/api/v1/auth/me').expect(401);
          await login('member_one', memberPass, 401);
          await mutate(owner, 'patch', `/api/v1/admin/users/${memberId}`)
            .send({ isActive: true })
            .expect(200);
          user = await login('member_one', memberPass);
          await mutate(
            owner,
            'post',
            `/api/v1/admin/users/${memberId}/reset-password`,
          )
            .send({ temporaryPassword: temporary })
            .expect(204);
          await user.agent.get('/api/v1/auth/me').expect(401);
          await login('member_one', memberPass, 401);
          user = await login('member_one', temporary);
          assert.equal(user.response.body.user.mustChangePassword, true);
          await user.agent.get('/api/v1/workouts').expect(403);
          user = await change(user, temporary, memberPass);
          // A login that overlaps reset must either fail or leave a revoked old-password session.
          const [reset, racing] = await Promise.all([
            mutate(
              owner,
              'post',
              `/api/v1/admin/users/${memberId}/reset-password`,
            ).send({ temporaryPassword: temporary }),
            (async () => {
              const agent = request.agent(app),
                csrf = await agent.get('/api/v1/auth/csrf');
              const response = await agent
                .post('/api/v1/auth/login')
                .set('Origin', origin)
                .set('X-CSRF-Token', csrf.body.csrfToken)
                .send({ username: 'member_one', password: memberPass });
              return { agent, response };
            })(),
          ]);
          assert.equal(reset.status, 204);
          assert.ok([200, 401].includes(racing.response.status));
          if (racing.response.status === 200)
            await racing.agent.get('/api/v1/auth/me').expect(401);
        },
      );
      await t.test(
        'expiry and logout invalidate server-side sessions',
        async () => {
          const actor = await login('admin_one', changed);
          await mutate(actor, 'post', '/api/v1/auth/logout').expect(204);
          await actor.agent.get('/api/v1/auth/me').expect(401);
          const expired = await login('admin_one', changed),
            secret = sessionCookie(expired.response).split('=')[1]!;
          await operator.query(
            "UPDATE app.auth_sessions SET created_at=statement_timestamp()-interval '31 days',expires_at=statement_timestamp()-interval '1 second' WHERE token_hash=$1",
            [tokenHash(secret)],
          );
          await expired.agent.get('/api/v1/auth/me').expect(401);
        },
      );
      await t.test(
        'role changes revoke sessions and concurrent self-disables cannot remove the final admin',
        async () => {
          const response = await mutate(owner, 'post', '/api/v1/admin/users')
            .send({
              username: 'admin_two',
              password: initial,
              role: 'admin',
              timeZone: 'UTC',
            })
            .expect(201);
          const secondId = response.body.id as string;
          let second = await change(
            await login('admin_two', initial),
            initial,
            changed,
          );
          await mutate(owner, 'patch', `/api/v1/admin/users/${secondId}`)
            .send({ role: 'user' })
            .expect(200);
          await second.agent.get('/api/v1/auth/me').expect(401);
          second = await login('admin_two', changed);
          await second.agent.get('/api/v1/admin/users').expect(403);
          await mutate(owner, 'patch', `/api/v1/admin/users/${secondId}`)
            .send({ role: 'admin' })
            .expect(200);
          second = await login('admin_two', changed);
          const results = await Promise.all([
            mutate(owner, 'patch', `/api/v1/admin/users/${ownerId}`).send({
              isActive: false,
            }),
            mutate(second, 'patch', `/api/v1/admin/users/${secondId}`).send({
              isActive: false,
            }),
          ]);
          assert.deepEqual(
            results.map((value) => value.status).sort(),
            [200, 409],
          );
          const remaining = (
            await operator.query(
              "SELECT id FROM app.users WHERE is_active AND role='admin'",
            )
          ).rows;
          assert.equal(remaining.length, 1);
          const survivor = remaining[0].id === ownerId ? owner : second;
          await mutate(
            survivor,
            'patch',
            `/api/v1/admin/users/${remaining[0].id}`,
          )
            .send({ role: 'user' })
            .expect(409);
        },
      );
      await t.test(
        'production cookies require HTTPS and an explicitly trusted proxy',
        async () => {
          const productionOrigin = 'https://gym.example.test';
          const secured = createApp({
            pool,
            config: {
              ...config,
              NODE_ENV: 'production',
              APP_ORIGIN: productionOrigin,
              TRUST_PROXY: 'loopback',
            },
          });
          await request(secured).get('/api/v1/auth/csrf').expect(403);
          const csrf = await request(secured)
            .get('/api/v1/auth/csrf')
            .set('X-Forwarded-Proto', 'https')
            .expect(200);
          const preauth = cookies(csrf).find((value) =>
            value.startsWith('gym_preauth='),
          )!;
          assert.match(preauth, /Secure/);
          assert.match(preauth, /HttpOnly/);
          const active = (
            await operator.query(
              "SELECT username FROM app.users WHERE is_active AND role='admin'",
            )
          ).rows[0].username as string;
          const response = await request(secured)
            .post('/api/v1/auth/login')
            .set('X-Forwarded-Proto', 'https')
            .set('Origin', productionOrigin)
            .set('Cookie', preauth.split(';')[0]!)
            .set('X-CSRF-Token', csrf.body.csrfToken)
            .send({ username: active, password: changed })
            .expect(200);
          assert.match(
            cookies(response).find((value) =>
              value.startsWith('gym_session='),
            )!,
            /Secure/,
          );
          const untrusted = createApp({
            pool,
            config: {
              ...config,
              NODE_ENV: 'production',
              APP_ORIGIN: productionOrigin,
              TRUST_PROXY: 'none',
            },
          });
          await request(untrusted)
            .get('/api/v1/auth/csrf')
            .set('X-Forwarded-Proto', 'https')
            .expect(403);
        },
      );
      await t.test(
        'login throttles are database-backed and ignore spoofed forwarding headers by default',
        async () => {
          const limitedConfig = {
              ...config,
              AUTH_SECRET: randomBytes(32).toString('hex'),
            },
            limited = createApp({ pool, config: limitedConfig }),
            agent = request.agent(limited);
          const csrf = await agent.get('/api/v1/auth/csrf').expect(200);
          for (let attempt = 0; attempt < 11; attempt++) {
            const response = await agent
              .post('/api/v1/auth/login')
              .set('Origin', origin)
              .set('X-CSRF-Token', csrf.body.csrfToken)
              .set('X-Forwarded-For', `192.0.2.${attempt}`)
              .send({ username: 'unknown_user', password: initial })
              .expect(attempt < 10 ? 401 : 429);
            if (attempt === 10)
              assert.ok(Number(response.headers['retry-after']) > 0);
          }
          const restarted = request.agent(
            createApp({ pool, config: limitedConfig }),
          );
          const fresh = await restarted.get('/api/v1/auth/csrf').expect(200);
          await restarted
            .post('/api/v1/auth/login')
            .set('Origin', origin)
            .set('X-CSRF-Token', fresh.body.csrfToken)
            .send({ username: 'unknown_user', password: initial })
            .expect(429);
        },
      );
      await t.test(
        'concurrent bootstrap attempts create only one first active admin',
        async () => {
          await operator.query('UPDATE app.users SET is_active=false');
          const attempts = await Promise.allSettled(
            ['new_admin_one', 'new_admin_two'].map((username) =>
              bootstrapAdmin(pool, {
                username,
                password: initial,
                timeZone: 'UTC',
              }),
            ),
          );
          assert.equal(
            attempts.filter((value) => value.status === 'fulfilled').length,
            1,
          );
          assert.equal(
            attempts.filter((value) => value.status === 'rejected').length,
            1,
          );
        },
      );
    } finally {
      await pool.end();
      await operator.end();
      if (created) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
      await admin.end();
    }
  },
);
