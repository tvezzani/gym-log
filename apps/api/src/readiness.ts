import { readConfig } from './config.js';
import { createPool } from './db.js';

// Operator command only. Database readiness is never exposed over HTTP.
const pool = createPool(readConfig().DATABASE_URL);
try {
  await pool.query('SELECT 1');
  console.log('Database ready');
} catch {
  console.error('Database unavailable');
  process.exitCode = 1;
} finally {
  await pool.end();
}
