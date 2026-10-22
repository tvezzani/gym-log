import { parseArgs } from 'node:util';
import { readConfig } from '../config.js';
import { createPool } from '../db.js';
import { bootstrapAdmin } from './bootstrap.js';

async function main() {
  const { values } = parseArgs({
    options: { username: { type: 'string' }, 'time-zone': { type: 'string' } },
    strict: true,
  });
  if (!values.username || !values['time-zone'] || process.stdin.isTTY)
    throw new Error(
      'Supply --username, --time-zone and the password on stdin (see docs/AUTH.md)',
    );
  process.stdin.setEncoding('utf8');
  let password = '';
  for await (const chunk of process.stdin) {
    password += String(chunk);
    if (Buffer.byteLength(password) > 1024)
      throw new Error('Password input is too long');
  }
  const pool = createPool(readConfig().DATABASE_URL);
  try {
    await bootstrapAdmin(pool, {
      username: values.username,
      timeZone: values['time-zone'],
      password,
    });
    console.log(
      'First admin created. Log in and immediately choose a new password.',
    );
  } finally {
    await pool.end();
  }
}
main().catch(() => {
  console.error(
    'Bootstrap failed: check the arguments, password policy, database, and whether an active admin already exists. No secret was logged.',
  );
  process.exitCode = 1;
});
