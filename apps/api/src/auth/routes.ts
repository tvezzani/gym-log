import { Router, type Request, type Response } from 'express';
import type { Pool, PoolClient } from 'pg';
import type { ZodType } from 'zod';
import {
  setupCreateSchema,
  loginSchema,
  passwordChangeSchema,
  accountCreateSchema,
  accountPatchSchema,
  accountResetSchema,
  accountListQuerySchema,
  preferencesPatchSchema,
  idSchema,
} from '@gym-log/contracts';
import type { Config } from '../config.js';
import { HttpError, parse } from '../errors.js';
import { setupAdmin, setupRequired } from './bootstrap.js';
import { hashPassword, verifyPassword } from './passwords.js';
import {
  authCookies,
  authorizedTransaction,
  consumeLimit,
  cookieValue,
  equalToken,
  publicUser,
  randomToken,
  requireOrigin,
  revokeSessions,
  sessionForRequest,
  tokenHash,
  transaction,
  type AuthContext,
  type UserRow,
} from './service.js';

function body<T>(req: Request, schema: ZodType<T>): T {
  if (!req.is('application/json'))
    throw new HttpError(
      415,
      'UNSUPPORTED_ENCODING',
      'Content-Type must be application/json',
    );
  return parse(schema, req.body);
}
const context = (res: Response) => res.locals.auth as AuthContext;
async function validTimezone(db: PoolClient, zone: string) {
  if (
    !(await db.query('SELECT 1 FROM pg_timezone_names WHERE name=$1', [zone]))
      .rowCount
  )
    throw new HttpError(422, 'VALIDATION_ERROR', 'Invalid request', [
      { path: 'timeZone', message: 'Unsupported IANA timezone' },
    ]);
}
function preliminaryAdmin(res: Response) {
  if (context(res).user.role !== 'admin')
    throw new HttpError(403, 'FORBIDDEN', 'Admin role required');
}
export function createAuthRouter(pool: Pool, config: Config) {
  const router = Router(),
    cookies = authCookies(config);
  const dummyHash = hashPassword(randomToken());
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Cross-Origin-Resource-Policy', 'same-origin');
    if (config.NODE_ENV === 'production' && !req.secure)
      throw new HttpError(403, 'FORBIDDEN', 'HTTPS required');
    next();
  });
  router.get('/auth/csrf', async (req, res) => {
    if (
      req.get('Sec-Fetch-Site') === 'cross-site' ||
      (req.get('Origin') && req.get('Origin') !== config.APP_ORIGIN)
    )
      throw new HttpError(403, 'FORBIDDEN', 'Origin not permitted');
    await consumeLimit(pool, config, `csrf:${req.ip}`, 60);
    const auth = await sessionForRequest(pool, req);
    if (!auth && cookieValue(req, 'gym_session')) cookies.clearSession(res);
    const token =
      auth?.csrfToken ?? cookies.readPreauth(req) ?? cookies.issuePreauth(res);
    res.json({ csrfToken: token });
  });
  router.get('/auth/setup', async (req, res) => {
    if (
      req.get('Sec-Fetch-Site') === 'cross-site' ||
      (req.get('Origin') && req.get('Origin') !== config.APP_ORIGIN)
    )
      throw new HttpError(403, 'FORBIDDEN', 'Origin not permitted');
    res.json({ setupRequired: await setupRequired(pool) });
  });
  router.post('/auth/setup', async (req, res) => {
    requireOrigin(req, config);
    await consumeLimit(pool, config, `setup:${req.ip}`, 10);
    const expected = cookies.readPreauth(req);
    if (!expected || !equalToken(req.get('X-CSRF-Token'), expected))
      throw new HttpError(403, 'FORBIDDEN', 'Invalid CSRF token');
    const input = body(req, setupCreateSchema);
    const user = await setupAdmin(pool, input);
    cookies.clearPreauth(res);
    res.status(201).json(user);
  });
  router.post('/auth/login', async (req, res) => {
    requireOrigin(req, config);
    await consumeLimit(pool, config, `login-ip:${req.ip}`, 30);
    const input = body(req, loginSchema);
    await consumeLimit(
      pool,
      config,
      `login-pair:${req.ip}:${input.username}`,
      10,
    );
    const oldAuth = await sessionForRequest(pool, req);
    const expected = oldAuth?.csrfToken ?? cookies.readPreauth(req);
    if (!expected || !equalToken(req.get('X-CSRF-Token'), expected))
      throw new HttpError(403, 'FORBIDDEN', 'Invalid CSRF token');
    const before = (
      await pool.query<UserRow>('SELECT * FROM app.users WHERE username=$1', [
        input.username,
      ])
    ).rows[0];
    const fallback = await dummyHash;
    const verified = await verifyPassword(
      before?.password_hash ?? fallback,
      input.password,
    );
    if (!before || !before.is_active || !verified)
      throw new HttpError(
        401,
        'UNAUTHENTICATED',
        'Invalid username or password',
      );
    const secret = randomToken(),
      csrfToken = randomToken();
    const user = await transaction(pool, async (db) => {
      const fresh = (
        await db.query<UserRow>(
          'SELECT * FROM app.users WHERE id=$1 FOR UPDATE',
          [before.id],
        )
      ).rows[0];
      if (!fresh?.is_active || fresh.password_hash !== before.password_hash)
        throw new HttpError(
          401,
          'UNAUTHENTICATED',
          'Invalid username or password',
        );
      if (oldAuth?.user.id === fresh.id)
        await db.query(
          'UPDATE app.auth_sessions SET revoked_at=statement_timestamp() WHERE id=$1 AND revoked_at IS NULL',
          [oldAuth.sessionId],
        );
      await db.query(
        "INSERT INTO app.auth_sessions(user_id,token_hash,csrf_token,expires_at) VALUES($1,$2,$3,statement_timestamp()+interval '2592000 seconds')",
        [fresh.id, tokenHash(secret), csrfToken],
      );
      return publicUser(fresh);
    });
    cookies.clearPreauth(res);
    cookies.setSession(res, secret);
    res.json({ user, csrfToken });
  });
  router.use(async (req, res, next) => {
    const auth = await sessionForRequest(pool, req);
    if (!auth) {
      cookies.clearSession(res);
      throw new HttpError(401, 'UNAUTHENTICATED', 'Authentication required');
    }
    res.locals.auth = auth;
    if (
      auth.user.must_change_password &&
      !['/auth/me', '/auth/password', '/auth/logout'].includes(req.path)
    )
      throw new HttpError(
        403,
        'PASSWORD_CHANGE_REQUIRED',
        'Change your password before continuing',
      );
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      requireOrigin(req, config);
      if (!equalToken(req.get('X-CSRF-Token'), auth.csrfToken))
        throw new HttpError(403, 'FORBIDDEN', 'Invalid CSRF token');
    }
    next();
  });
  router.get('/auth/me', async (_req, res) => {
    const value = await authorizedTransaction(
      pool,
      context(res),
      { allowPasswordChange: true },
      async (_db, fresh) => ({
        user: publicUser(fresh.user),
        csrfToken: fresh.csrfToken,
      }),
    );
    res.json(value);
  });
  router.post('/auth/logout', async (_req, res) => {
    await authorizedTransaction(
      pool,
      context(res),
      { allowPasswordChange: true },
      async (db, fresh) => {
        await db.query(
          'UPDATE app.auth_sessions SET revoked_at=statement_timestamp() WHERE id=$1',
          [fresh.sessionId],
        );
      },
    );
    cookies.clearSession(res);
    cookies.clearPreauth(res);
    res.sendStatus(204);
  });
  router.patch('/auth/password', async (req, res) => {
    const input = body(req, passwordChangeSchema);
    await consumeLimit(pool, config, `password:${context(res).user.id}`, 10);
    await authorizedTransaction(
      pool,
      context(res),
      { allowPasswordChange: true },
      async (db, fresh) => {
        if (
          !(await verifyPassword(
            fresh.user.password_hash,
            input.currentPassword,
          ))
        )
          throw new HttpError(
            401,
            'UNAUTHENTICATED',
            'Invalid current password',
          );
        const hash = await hashPassword(input.newPassword);
        await db.query(
          'UPDATE app.users SET password_hash=$2,must_change_password=false WHERE id=$1',
          [fresh.user.id, hash],
        );
        await revokeSessions(db, fresh.user.id);
      },
    );
    cookies.clearSession(res);
    cookies.clearPreauth(res);
    res.sendStatus(204);
  });
  router.patch('/preferences', async (req, res) => {
    const input = body(req, preferencesPatchSchema);
    const user = await authorizedTransaction(
      pool,
      context(res),
      {},
      async (db, fresh) => {
        await validTimezone(db, input.timeZone);
        return publicUser(
          (
            await db.query<UserRow>(
              'UPDATE app.users SET time_zone=$2 WHERE id=$1 RETURNING *',
              [fresh.user.id, input.timeZone],
            )
          ).rows[0]!,
        );
      },
    );
    res.json(user);
  });
  router.get('/admin/users', async (req, res) => {
    preliminaryAdmin(res);
    const input = parse(accountListQuerySchema, req.query);
    const rows = await authorizedTransaction(
      pool,
      context(res),
      { admin: true },
      async (db) =>
        (
          await db.query<UserRow>(
            'SELECT * FROM app.users ORDER BY username,id LIMIT $1 OFFSET $2',
            [input.limit + 1, input.offset],
          )
        ).rows,
    );
    res.json({
      items: rows.slice(0, input.limit).map(publicUser),
      pagination: { ...input, hasMore: rows.length > input.limit },
    });
  });
  router.post('/admin/users', async (req, res) => {
    preliminaryAdmin(res);
    const input = body(req, accountCreateSchema),
      hash = await hashPassword(input.password);
    const user = await authorizedTransaction(
      pool,
      context(res),
      { admin: true },
      async (db) => {
        await validTimezone(db, input.timeZone);
        return publicUser(
          (
            await db.query<UserRow>(
              'INSERT INTO app.users(username,password_hash,role,time_zone,must_change_password) VALUES($1,$2,$3,$4,true) RETURNING *',
              [input.username, hash, input.role, input.timeZone],
            )
          ).rows[0]!,
        );
      },
    );
    res.status(201).json(user);
  });
  router.patch('/admin/users/:id', async (req, res) => {
    preliminaryAdmin(res);
    const id = parse(idSchema, req.params.id).toLowerCase(),
      input = body(req, accountPatchSchema);
    const user = await authorizedTransaction(
      pool,
      context(res),
      { admin: true },
      async (db) => {
        const old = (
          await db.query<UserRow>(
            'SELECT * FROM app.users WHERE id=$1 FOR UPDATE',
            [id],
          )
        ).rows[0];
        if (!old) throw new HttpError(404, 'NOT_FOUND', 'Account not found');
        const role = input.role ?? old.role,
          active = input.isActive ?? old.is_active;
        if (
          old.is_active &&
          old.role === 'admin' &&
          (!active || role !== 'admin')
        ) {
          const count = await db.query<{ count: number }>(
            "SELECT count(*)::int AS count FROM app.users WHERE role='admin' AND is_active AND id<>$1",
            [id],
          );
          if (!count.rows[0]!.count)
            throw new HttpError(
              409,
              'CONFLICT',
              'Keep at least one active admin',
            );
        }
        const row = (
          await db.query<UserRow>(
            'UPDATE app.users SET role=$2,is_active=$3 WHERE id=$1 RETURNING *',
            [id, role, active],
          )
        ).rows[0]!;
        if (!active || role !== old.role) await revokeSessions(db, id);
        return publicUser(row);
      },
    );
    if (
      id === context(res).user.id &&
      (!user.isActive || user.role !== context(res).user.role)
    )
      cookies.clearSession(res);
    res.json(user);
  });
  router.post('/admin/users/:id/reset-password', async (req, res) => {
    preliminaryAdmin(res);
    const id = parse(idSchema, req.params.id).toLowerCase(),
      input = body(req, accountResetSchema),
      hash = await hashPassword(input.temporaryPassword);
    await authorizedTransaction(
      pool,
      context(res),
      { admin: true },
      async (db) => {
        if (
          !(
            await db.query('SELECT id FROM app.users WHERE id=$1 FOR UPDATE', [
              id,
            ])
          ).rowCount
        )
          throw new HttpError(404, 'NOT_FOUND', 'Account not found');
        await db.query(
          'UPDATE app.users SET password_hash=$2,must_change_password=true WHERE id=$1',
          [id, hash],
        );
        await revokeSessions(db, id);
      },
    );
    if (id === context(res).user.id) cookies.clearSession(res);
    res.sendStatus(204);
  });
  return router;
}
