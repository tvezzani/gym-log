import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { test } from 'node:test';
import { chromium, expect, type Browser } from '@playwright/test';
import { preview, type PreviewServer } from 'vite';
import pg from 'pg';
import { createApp } from '../../api/src/app.ts';
import { readConfig } from '../../api/src/config.ts';

test(
  'first visit creates an admin through the real browser setup flow',
  { timeout: 60000 },
  async () => {
    assert.ok(process.env.MIGRATION_DATABASE_URL);
    assert.ok(process.env.DATABASE_URL);
    const database = `gym_log_setup_web_${randomUUID().replaceAll('-', '')}`,
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
        APP_ORIGIN: 'http://127.0.0.1:5173',
      }),
      server = createApp({ pool, config }).listen(0, '127.0.0.1');
    let created = false,
      browser: Browser | undefined,
      vite: PreviewServer | undefined;
    const password = 'Chosen-browser-setup-password!';
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
      if (!server.listening) await once(server, 'listening');
      const address = server.address();
      assert.ok(address && typeof address === 'object');
      vite = await preview({
        configFile: false,
        root: 'apps/web',
        logLevel: 'error',
        preview: {
          host: '127.0.0.1',
          port: 0,
          proxy: { '/api': `http://127.0.0.1:${address.port}` },
        },
      });
      config.APP_ORIGIN = vite.resolvedUrls!.local[0]!.replace(/\/$/, '');
      browser = await chromium.launch();
      const context = await browser.newContext({
          viewport: { width: 390, height: 844 },
        }),
        other = await browser.newContext({
          viewport: { width: 390, height: 844 },
        }),
        page = await context.newPage(),
        stale = await other.newPage();
      page.setDefaultTimeout(7000);
      stale.setDefaultTimeout(7000);
      await Promise.all([
        page.goto(config.APP_ORIGIN),
        stale.goto(config.APP_ORIGIN),
      ]);
      await expect(
        page.getByRole('heading', { name: 'Your log starts here.' }),
      ).toBeVisible();
      await expect(
        stale.getByRole('heading', { name: 'Your log starts here.' }),
      ).toBeVisible();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth,
        ),
        false,
      );
      await mkdir('apps/web/test-results', { recursive: true });
      await page.screenshot({
        path: 'apps/web/test-results/setup.png',
        fullPage: true,
      });
      await page.getByLabel('Username', { exact: true }).fill('MY_ADMIN');
      await page.getByLabel('Password', { exact: true }).fill(password);
      await page
        .getByLabel('Confirm password', { exact: true })
        .fill('A-different-confirmation!');
      await page.getByLabel('Timezone', { exact: true }).fill('America/Denver');
      await page.getByRole('button', { name: 'Create admin account' }).click();
      await expect(page.getByRole('alert')).toContainText(
        'Passwords must match',
      );
      assert.equal(
        (await operator.query('SELECT count(*)::int AS n FROM app.users'))
          .rows[0].n,
        0,
      );
      await page.getByLabel('Confirm password', { exact: true }).fill(password);
      await page.getByRole('button', { name: 'Create admin account' }).click();
      await expect(
        page.getByRole('heading', { name: 'Let’s get to work.' }),
      ).toBeVisible();
      const createdUser = (
        await operator.query(
          'SELECT username,role,must_change_password,time_zone FROM app.users',
        )
      ).rows[0];
      assert.deepEqual(createdUser, {
        username: 'my_admin',
        role: 'admin',
        must_change_password: false,
        time_zone: 'America/Denver',
      });
      await stale.getByLabel('Username', { exact: true }).fill('late_admin');
      await stale.getByLabel('Password', { exact: true }).fill(password);
      await stale
        .getByLabel('Confirm password', { exact: true })
        .fill(password);
      await stale.getByRole('button', { name: 'Create admin account' }).click();
      await expect(
        stale.getByRole('button', { name: 'Continue to log in' }),
      ).toBeVisible();
      await stale.getByRole('button', { name: 'Continue to log in' }).click();
      await expect(
        stale.getByRole('heading', { name: 'Let’s get to work.' }),
      ).toBeVisible();
      assert.equal(
        (await operator.query('SELECT count(*)::int AS n FROM app.users'))
          .rows[0].n,
        1,
      );
      await page.getByLabel('Username', { exact: true }).fill('my_admin');
      await page.getByLabel('Password', { exact: true }).fill(password);
      await page.getByRole('button', { name: 'Log in', exact: true }).click();
      await expect(
        page.getByRole('heading', { name: 'Let’s put in the work.' }),
      ).toBeVisible();
      await page.reload();
      await expect(
        page.getByRole('heading', { name: 'Let’s put in the work.' }),
      ).toBeVisible();
      await expect(
        page.getByRole('heading', { name: 'Your log starts here.' }),
      ).toHaveCount(0);
      await context.close();
      await other.close();
    } finally {
      await browser?.close();
      if (vite)
        await new Promise<void>((resolve) =>
          vite!.httpServer.close(() => resolve()),
        );
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await pool.end();
      await operator.end();
      if (created)
        await administrator.query(`DROP DATABASE ${database} WITH (FORCE)`);
      await administrator.end();
    }
  },
);
