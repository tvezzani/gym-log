import type { Pool, PoolClient } from 'pg';
import { setupCreateSchema, type SetupCreate } from '@gym-log/contracts';
import { parse, HttpError } from '../errors.js';
import { hashPassword } from './passwords.js';
import {
  transaction,
  ADMIN_LOCK,
  publicUser,
  type UserRow,
} from './service.js';

export async function setupRequired(pool: Pool | PoolClient): Promise<boolean> {
  const row = (
    await pool.query<{ required: boolean }>(
      `SELECT completed_at IS NULL AS required FROM app.installation WHERE id=1`,
    )
  ).rows[0];
  // A missing installation marker is an operator/configuration error, never
  // permission to reopen public setup.
  if (!row) throw new Error('Installation state is missing');
  return row.required;
}
async function createFirstAdmin(
  pool: Pool,
  input: SetupCreate,
  firstRun: boolean,
) {
  const value = parse(setupCreateSchema, input);
  return transaction(pool, async (db) => {
    await db.query('SELECT pg_advisory_xact_lock($1)', [ADMIN_LOCK]);
    if (firstRun) {
      if (!(await setupRequired(db)))
        throw new HttpError(
          409,
          'CONFLICT',
          'Initial setup is already complete. Log in to continue.',
        );
    }
    if (
      (
        await db.query(
          "SELECT id FROM app.users WHERE role='admin' AND is_active LIMIT 1",
        )
      ).rowCount
    )
      throw new HttpError(409, 'CONFLICT', 'An active admin already exists');
    if (
      !(
        await db.query('SELECT 1 FROM pg_timezone_names WHERE name=$1', [
          value.timeZone,
        ])
      ).rowCount
    )
      throw new HttpError(422, 'VALIDATION_ERROR', 'Invalid request', [
        { path: 'timeZone', message: 'Unsupported IANA timezone' },
      ]);
    const hash = await hashPassword(value.password);
    const row = (
      await db.query<UserRow>(
        'INSERT INTO app.users(username,password_hash,role,time_zone,must_change_password) VALUES($1,$2,$3,$4,$5) RETURNING *',
        [value.username, hash, 'admin', value.timeZone, !firstRun],
      )
    ).rows[0]!;
    return publicUser(row);
  });
}
// Explicit local CLI bootstrap/recovery still takes a temporary password.
export const bootstrapAdmin = (pool: Pool, input: SetupCreate) =>
  createFirstAdmin(pool, input, false);
// A browser setup password is chosen by its owner, rather than assigned to them.
export const setupAdmin = (pool: Pool, input: SetupCreate) =>
  createFirstAdmin(pool, input, true);
