import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import pg from 'pg';

test('real PostgreSQL migration and runtime permissions', async () => {
  const operator = new pg.Client({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  const app = new pg.Client({ connectionString: process.env.DATABASE_URL });
  const table = `scaffold_probe_${randomUUID().replaceAll('-', '')}`;
  let created = false;
  try {
    await operator.connect();
    await app.connect();
    const roles = await app.query(
      'SELECT current_user, rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = current_user',
    );
    assert.deepEqual(roles.rows[0], {
      current_user: 'gym_app',
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
    });
    const migrations = await operator.query(
      'SELECT count(*)::int AS count FROM public.pgmigrations',
    );
    assert.ok(migrations.rows[0].count >= 1);
    for (const sql of [
      'CREATE TABLE app.denied_probe (id int)',
      'CREATE TABLE public.denied_probe (id int)',
      'SELECT * FROM public.pgmigrations',
    ]) {
      // The transaction also removes anything created if a permission regresses.
      await app.query('BEGIN');
      try {
        await assert.rejects(
          app.query(sql),
          (error: unknown) =>
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            error.code === '42501',
        );
      } finally {
        await app.query('ROLLBACK');
      }
    }
    await operator.query(
      `CREATE TABLE app.${table} (value numeric(8,3) NOT NULL)`,
    );
    created = true;
    await app.query(`INSERT INTO app.${table} (value) VALUES ($1)`, ['12.125']);
    const result = await app.query(`SELECT value FROM app.${table}`);
    assert.equal(result.rows[0].value, '12.125');
  } finally {
    if (created) await operator.query(`DROP TABLE app.${table}`);
    await app.end();
    await operator.end();
  }
});
