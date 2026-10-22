import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import type { Request, Response } from 'express';
import type { Pool, PoolClient } from 'pg';
import type { User } from '@gym-log/contracts';
import type { Config } from '../config.js';
import { HttpError } from '../errors.js';

export const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
export const ADMIN_LOCK = 620260321;
const PREAUTH_MS = 10 * 60 * 1000;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
export const randomToken = () => randomBytes(32).toString('base64url');
export const tokenHash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
export interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  role: User['role'];
  is_active: boolean;
  must_change_password: boolean;
  time_zone: string;
  created_at: Date;
  updated_at: Date;
}
export interface AuthContext {
  user: UserRow;
  sessionId: string;
  csrfToken: string;
  tokenHash: string;
}
export function publicUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    isActive: row.is_active,
    mustChangePassword: row.must_change_password,
    timeZone: row.time_zone,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
export function cookieValue(req: Request, name: string): string | undefined {
  let found: string | undefined;
  for (const piece of (req.headers.cookie ?? '').split(';')) {
    const position = piece.indexOf('=');
    if (position < 0 || piece.slice(0, position).trim() !== name) continue;
    if (found !== undefined) return undefined;
    const value = piece.slice(position + 1).trim();
    if (!/^[A-Za-z0-9_.-]+$/.test(value)) return undefined;
    found = value;
  }
  return found;
}
export function equalToken(left: string | undefined, right: string): boolean {
  return (
    !!left &&
    tokenPattern.test(left) &&
    tokenPattern.test(right) &&
    timingSafeEqual(Buffer.from(left), Buffer.from(right))
  );
}
export async function transaction<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? error.code
          : undefined;
      if (code !== '40P01' && code !== '40001') throw error;
      if (attempt === 2)
        throw new HttpError(
          409,
          'CONFLICT',
          'Concurrent update; retry the request',
        );
    } finally {
      client.release();
    }
    await new Promise((resolve) => setTimeout(resolve, 5 * (attempt + 1)));
  }
  throw new Error('Transaction retry exhausted');
}
export async function sessionByHash(
  db: Pool | PoolClient,
  hash: string,
): Promise<AuthContext | null> {
  const result = await db.query<
    UserRow & { session_id: string; csrf_token: string }
  >(
    `SELECT u.*,s.id AS session_id,s.csrf_token FROM app.auth_sessions s JOIN app.users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>statement_timestamp() AND u.is_active`,
    [hash],
  );
  const row = result.rows[0];
  return row
    ? {
        user: row,
        sessionId: row.session_id,
        csrfToken: row.csrf_token,
        tokenHash: hash,
      }
    : null;
}
export async function sessionForRequest(
  db: Pool,
  req: Request,
): Promise<AuthContext | null> {
  const value = cookieValue(req, 'gym_session');
  return value && tokenPattern.test(value)
    ? sessionByHash(db, tokenHash(value))
    : null;
}
export function authCookies(config: Config) {
  const options = {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/api/v1',
  };
  const signature = (value: string) =>
    createHmac('sha256', Buffer.from(config.AUTH_SECRET, 'hex'))
      .update(value)
      .digest('base64url');
  return {
    setSession: (res: Response, token: string) =>
      res.cookie('gym_session', token, { ...options, maxAge: SESSION_MS }),
    clearSession: (res: Response) => res.clearCookie('gym_session', options),
    clearPreauth: (res: Response) =>
      res.clearCookie('gym_preauth', { ...options, path: '/api/v1/auth' }),
    issuePreauth(res: Response): string {
      const token = randomToken(),
        value = `${token}.${Date.now() + PREAUTH_MS}`;
      res.cookie('gym_preauth', `${value}.${signature(value)}`, {
        ...options,
        path: '/api/v1/auth',
        maxAge: PREAUTH_MS,
      });
      return token;
    },
    readPreauth(req: Request): string | undefined {
      const parts = cookieValue(req, 'gym_preauth')?.split('.');
      if (!parts || parts.length !== 3) return undefined;
      const [token, expires, signed] = parts;
      if (
        !token ||
        !expires ||
        !signed ||
        !tokenPattern.test(token) ||
        !/^\d{13}$/.test(expires)
      )
        return undefined;
      const end = Number(expires);
      if (
        end < Date.now() ||
        end > Date.now() + PREAUTH_MS ||
        !equalToken(signed, signature(`${token}.${expires}`))
      )
        return undefined;
      return token;
    },
  };
}
export function requireOrigin(req: Request, config: Config) {
  if (
    req.get('Origin') !== config.APP_ORIGIN ||
    req.get('Sec-Fetch-Site') === 'cross-site'
  )
    throw new HttpError(403, 'FORBIDDEN', 'Origin not permitted');
}
export async function consumeLimit(
  pool: Pool,
  config: Config,
  key: string,
  maximum: number,
): Promise<void> {
  const bucket = createHmac('sha256', Buffer.from(config.AUTH_SECRET, 'hex'))
    .update(key)
    .digest('hex');
  const result = await pool.query<{ hits: number; wait: number }>(
    `INSERT INTO app.auth_rate_limits(bucket_hash,hits,reset_at) VALUES($1,1,statement_timestamp()+interval '15 minutes') ON CONFLICT(bucket_hash) DO UPDATE SET hits=CASE WHEN auth_rate_limits.reset_at<=statement_timestamp() THEN 1 ELSE LEAST(auth_rate_limits.hits+1,$2+1) END,reset_at=CASE WHEN auth_rate_limits.reset_at<=statement_timestamp() THEN statement_timestamp()+interval '15 minutes' ELSE auth_rate_limits.reset_at END RETURNING hits,GREATEST(1,ceil(extract(epoch FROM reset_at-statement_timestamp())))::int AS wait`,
    [bucket, maximum],
  );
  const row = result.rows[0]!;
  if (row.hits > maximum)
    throw new HttpError(
      429,
      'RATE_LIMITED',
      'Too many attempts; try again later',
      undefined,
      row.wait,
    );
}
export async function authorizedTransaction<T>(
  pool: Pool,
  auth: AuthContext,
  options: { admin?: boolean; allowPasswordChange?: boolean },
  work: (db: PoolClient, fresh: AuthContext) => Promise<T>,
): Promise<T> {
  return transaction(pool, async (db) => {
    if (options.admin)
      await db.query('SELECT pg_advisory_xact_lock($1)', [ADMIN_LOCK]);
    // Lock first, then read in a NEW statement snapshot: reset/disable cannot leave stale auth.
    await db.query('SELECT id FROM app.users WHERE id=$1 FOR UPDATE', [
      auth.user.id,
    ]);
    const fresh = await sessionByHash(db, auth.tokenHash);
    if (!fresh)
      throw new HttpError(401, 'UNAUTHENTICATED', 'Authentication required');
    if (fresh.user.must_change_password && !options.allowPasswordChange)
      throw new HttpError(
        403,
        'PASSWORD_CHANGE_REQUIRED',
        'Change your password before continuing',
      );
    if (options.admin && fresh.user.role !== 'admin')
      throw new HttpError(403, 'FORBIDDEN', 'Admin role required');
    return work(db, fresh);
  });
}
export const revokeSessions = (db: PoolClient, userId: string) =>
  db.query(
    'UPDATE app.auth_sessions SET revoked_at=statement_timestamp() WHERE user_id=$1 AND revoked_at IS NULL',
    [userId],
  );
