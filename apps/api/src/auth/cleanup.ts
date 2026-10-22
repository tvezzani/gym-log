import { readConfig } from '../config.js';
import { createPool } from '../db.js';
import { transaction } from './service.js';
const pool = createPool(readConfig().DATABASE_URL);
try {
  const counts = await transaction(pool, async (db) => {
    const sessions = await db.query(
      'DELETE FROM app.auth_sessions WHERE expires_at<=statement_timestamp()',
    );
    const limits = await db.query(
      'DELETE FROM app.auth_rate_limits WHERE reset_at<=statement_timestamp()',
    );
    return { sessions: sessions.rowCount, rateLimits: limits.rowCount };
  });
  console.log('Removed expired auth rows:', counts);
} catch {
  console.error('Auth cleanup failed');
  process.exitCode = 1;
} finally {
  await pool.end();
}
