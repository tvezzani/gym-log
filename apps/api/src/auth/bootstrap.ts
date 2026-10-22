import type { Pool } from 'pg';
import { accountCreateSchema } from '@gym-log/contracts';
import { parse, HttpError } from '../errors.js';
import { hashPassword } from './passwords.js';
import {
  transaction,
  ADMIN_LOCK,
  publicUser,
  type UserRow,
} from './service.js';

export async function bootstrapAdmin(
  pool: Pool,
  input: { username: string; password: string; timeZone: string },
) {
  const value = parse(accountCreateSchema, { ...input, role: 'admin' });
  const hash = await hashPassword(value.password);
  return transaction(pool, async (db) => {
    await db.query('SELECT pg_advisory_xact_lock($1)', [ADMIN_LOCK]);
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
      throw new Error('Unsupported timezone');
    const row = (
      await db.query<UserRow>(
        'INSERT INTO app.users(username,password_hash,role,time_zone,must_change_password) VALUES($1,$2,$3,$4,true) RETURNING *',
        [value.username, hash, 'admin', value.timeZone],
      )
    ).rows[0]!;
    return publicUser(row);
  });
}
