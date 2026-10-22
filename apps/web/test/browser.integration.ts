import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { test } from 'node:test';
import { chromium, expect, type Browser, type Page } from '@playwright/test';
import { preview, type PreviewServer } from 'vite';
import pg from 'pg';
import { createApp } from '../../api/src/app.ts';
import { readConfig } from '../../api/src/config.ts';
import { bootstrapAdmin } from '../../api/src/auth/bootstrap.ts';
import { dayBounds, todayIn } from '../src/time.ts';

test(
  'phone logging UI against real sessions and PostgreSQL',
  { timeout: 180000 },
  async (t) => {
    assert.ok(process.env.MIGRATION_DATABASE_URL);
    assert.ok(process.env.DATABASE_URL);
    const database = `gym_log_web_${randomUUID().replaceAll('-', '')}`;
    const opUrl = new URL(process.env.MIGRATION_DATABASE_URL),
      appUrl = new URL(process.env.DATABASE_URL);
    opUrl.pathname = `/${database}`;
    appUrl.pathname = `/${database}`;
    const admin = new pg.Client({
        connectionString: process.env.MIGRATION_DATABASE_URL,
      }),
      operator = new pg.Client({ connectionString: opUrl.href }),
      pool = new pg.Pool({ connectionString: appUrl.href });
    const config = readConfig({
      NODE_ENV: 'test',
      DATABASE_URL: appUrl.href,
      AUTH_SECRET: randomBytes(32).toString('hex'),
      APP_ORIGIN: 'http://127.0.0.1:5173',
    });
    const server = createApp({ pool, config }).listen(0, '127.0.0.1');
    let vite: PreviewServer | undefined,
      browser: Browser | undefined,
      created = false;
    const initial = 'Initial-browser-password!',
      password = 'Changed-browser-password!';
    const screenshots = 'apps/web/test-results';
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
          'WEB_TEST_DATABASE_URL',
          '--migrations-dir',
          'db/migrations',
          'up',
        ],
        { env: { ...process.env, WEB_TEST_DATABASE_URL: opUrl.href } },
      );
      const user = await bootstrapAdmin(pool, {
        username: 'browser_admin',
        password: initial,
        timeZone: 'America/Denver',
      });
      const bench = randomUUID(),
        incline = randomUUID();
      await operator.query(
        "INSERT INTO app.exercises(id,name,submitted_by,status,reviewed_by,reviewed_at) VALUES($1,'Bench Press',$2,'approved',$2,statement_timestamp())",
        [bench, user.id],
      );
      await operator.query(
        "INSERT INTO app.exercises(id,name,submitted_by) VALUES($1,'Incline Dumbbells',$2)",
        [incline, user.id],
      );
      if (!server.listening) await once(server, 'listening');
      const apiAddress = server.address();
      assert.ok(apiAddress && typeof apiAddress === 'object');
      vite = await preview({
        configFile: false,
        root: 'apps/web',
        logLevel: 'error',
        preview: {
          host: '127.0.0.1',
          port: 0,
          proxy: { '/api': `http://127.0.0.1:${apiAddress.port}` },
        },
      });
      config.APP_ORIGIN = vite.resolvedUrls!.local[0]!.replace(/\/$/, '');
      browser = await chromium.launch();
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        timezoneId: 'Asia/Tokyo',
      });
      const page = await context.newPage();
      page.setDefaultTimeout(7000);
      const pageErrors: string[] = [];
      page.on('pageerror', (e) => pageErrors.push(e.message));
      await mkdir(screenshots, { recursive: true });
      async function login(secret: string) {
        await page
          .getByLabel('Username', { exact: true })
          .fill('BROWSER_ADMIN');
        await page.getByLabel('Password', { exact: true }).fill(secret);
        await page.getByRole('button', { name: 'Log in', exact: true }).click();
      }
      const open = () =>
        page
          .getByRole('button', { name: 'Log a set', exact: true })
          .last()
          .click();
      async function fields(weight = '135.125', reps = '10') {
        await page.getByLabel('Exercise', { exact: true }).selectOption(bench);
        await page.getByLabel('Weight (lbs)', { exact: true }).fill(weight);
        await page.getByLabel('Reps', { exact: true }).fill(reps);
      }
      const rowCount = async () =>
        Number(
          (
            await operator.query(
              'SELECT count(*)::int AS n FROM app.workouts WHERE user_id=$1',
              [user.id],
            )
          ).rows[0].n,
        );
      async function noOverflow(p: Page) {
        assert.equal(
          await p.evaluate(
            () => document.documentElement.scrollWidth > window.innerWidth,
          ),
          false,
        );
      }
      async function scenario(name: string, work: () => Promise<void>) {
        let failure: unknown;
        await t.test(name, async () => {
          try {
            await work();
          } catch (error) {
            await page.screenshot({
              path: `${screenshots}/failure.png`,
              fullPage: true,
            });
            failure = error;
            throw error;
          }
        });
        if (failure) throw failure;
      }
      await scenario(
        'username login, mandatory password change and real session restoration',
        async () => {
          await page.clock.setFixedTime(new Date('2026-10-21T18:00:00.000Z'));
          await page.goto(config.APP_ORIGIN);
          await expect(
            page.getByRole('heading', { name: 'Let’s get to work.' }),
          ).toBeVisible();
          await noOverflow(page);
          await page.screenshot({ path: `${screenshots}/login.png` });
          await login(initial);
          await expect(
            page.getByRole('heading', { name: 'Make it yours.' }),
          ).toBeVisible();
          await page
            .getByLabel('Current password', { exact: true })
            .fill(initial);
          await page.getByLabel('New password', { exact: true }).fill(password);
          await page
            .getByLabel('Confirm new password', { exact: true })
            .fill(password);
          await page
            .getByRole('button', { name: 'Change password', exact: true })
            .click();
          await expect(
            page.getByRole('button', { name: 'Log in', exact: true }),
          ).toBeVisible();
          await login(password);
          await expect(
            page.getByRole('heading', { name: 'Let’s put in the work.' }),
          ).toBeVisible();
          await expect(
            page.getByRole('button', { name: 'Refresh', exact: true }),
          ).toBeEnabled();
          await page.reload();
          await expect(
            page.getByRole('heading', { name: 'Let’s put in the work.' }),
          ).toBeVisible();
        },
      );
      await scenario(
        'save/reload, decimal precision, copy 3 to 4 and independent defaults',
        async () => {
          await open();
          await fields();
          await expect(page.getByLabel('Set number')).toHaveValue('1');
          await expect(page.getByLabel('RPE (1–10)')).toHaveValue('5');
          await page.getByLabel('Set number').fill('3');
          await page.getByLabel('RPE (1–10)').fill('7');
          await page
            .getByRole('button', { name: 'Save set', exact: true })
            .click();
          await expect(page.getByRole('dialog')).toHaveCount(0);
          assert.equal(await rowCount(), 1);
          await page.reload();
          await expect(
            page.getByRole('button', {
              name: 'Set 3, 135.125 pounds, 10 reps, RPE 7',
            }),
          ).toBeVisible();
          await page
            .getByRole('button', {
              name: 'Set 3, 135.125 pounds, 10 reps, RPE 7',
            })
            .click();
          await page.clock.setFixedTime(new Date('2026-10-21T18:01:00.000Z'));
          await page.getByRole('button', { name: 'Copy as next set' }).click();
          await expect(
            page.getByLabel('Weight (lbs)', { exact: true }),
          ).toHaveValue('135.125');
          await expect(page.getByLabel('Set number')).toHaveValue('4');
          await expect(page.getByLabel('RPE (1–10)')).toHaveValue('7');
          await page
            .getByRole('button', { name: 'Save set', exact: true })
            .click();
          await expect(page.getByRole('dialog')).toHaveCount(0);
          assert.equal(await rowCount(), 2);
          const saved = (
            await operator.query(
              'SELECT * FROM app.workouts ORDER BY set_number',
            )
          ).rows;
          assert.notEqual(saved[0].id, saved[1].id);
          assert.notEqual(
            saved[0].performed_at.toISOString(),
            saved[1].performed_at.toISOString(),
          );
          assert.equal(saved[0].weight, '135.125');
          await open();
          await fields('80', '8');
          await expect(page.getByText('LAST RECORDED')).toBeVisible();
          await expect(page.getByLabel('Set number')).toHaveValue('1');
          await expect(page.getByLabel('RPE (1–10)')).toHaveValue('5');
          await page
            .getByRole('button', { name: 'Save set', exact: true })
            .click();
          await expect(page.getByRole('dialog')).toHaveCount(0);
          assert.equal(await rowCount(), 3);
        },
      );
      await scenario(
        'unknown save response freezes one identity across a safe retry and blocks edited duplicates',
        async () => {
          await open();
          await fields('100.001', '6');
          let original: unknown;
          await page.route('**/api/v1/workouts', async (route) => {
            if (route.request().method() !== 'POST') {
              await route.continue();
              return;
            }
            original = route.request().postDataJSON();
            await route.fetch();
            await route.abort('failed');
          });
          await page.locator('form.composer').evaluate((node) => {
            (node as HTMLFormElement).requestSubmit();
            (node as HTMLFormElement).requestSubmit();
          });
          await expect(
            page.getByRole('button', { name: 'Retry same save' }),
          ).toBeVisible();
          await expect(
            page.getByLabel('Weight (lbs)', { exact: true }),
          ).toBeDisabled();
          assert.equal(await rowCount(), 4);
          await page
            .getByRole('button', { name: 'Close', exact: true })
            .click();
          await expect(page.getByText('Save needs attention')).toBeVisible();
          await page
            .getByRole('button', { name: 'Resume', exact: true })
            .click();
          await page.unroute('**/api/v1/workouts');
          await page.route('**/api/v1/workouts', async (route) => {
            if (route.request().method() === 'POST')
              await route.fulfill({
                status: 403,
                contentType: 'application/json',
                body: JSON.stringify({
                  error: {
                    code: 'FORBIDDEN',
                    message: 'Temporary session mismatch',
                  },
                }),
              });
            else await route.continue();
          });
          await page.getByRole('button', { name: 'Retry same save' }).click();
          await expect(
            page.getByLabel('Weight (lbs)', { exact: true }),
          ).toBeDisabled();
          await expect(
            page.getByRole('button', { name: 'Retry same save' }),
          ).toBeVisible();
          await page.unroute('**/api/v1/workouts');
          let retried: unknown;
          await page.route('**/api/v1/workouts', async (route) => {
            if (route.request().method() === 'POST')
              retried = route.request().postDataJSON();
            await route.continue();
          });
          await page.getByRole('button', { name: 'Retry same save' }).click();
          await expect(page.getByRole('dialog')).toHaveCount(0);
          assert.deepEqual(retried, original);
          assert.equal(await rowCount(), 4);
          await page.unroute('**/api/v1/workouts');
        },
      );
      await scenario(
        'deleted uncertain submissions are acknowledged without resurrection',
        async () => {
          await open();
          await fields('66', '6');
          let id = '';
          let submissions = 0;
          await page.route('**/api/v1/workouts', async (route) => {
            if (route.request().method() !== 'POST') {
              await route.continue();
              return;
            }
            id = route.request().postDataJSON().id;
            submissions++;
            await route.fetch();
            await route.abort('failed');
          });
          await page.locator('form.composer').evaluate((node) => {
            (node as HTMLFormElement).requestSubmit();
            (node as HTMLFormElement).requestSubmit();
          });
          await expect(
            page.getByRole('button', { name: 'Retry same save' }),
          ).toBeVisible();
          assert.equal(submissions, 1);
          assert.equal(await rowCount(), 5);
          await operator.query('DELETE FROM app.workouts WHERE id=$1', [id]);
          await page.unroute('**/api/v1/workouts');
          await page.getByRole('button', { name: 'Retry same save' }).click();
          await expect(
            page.getByRole('button', { name: 'Acknowledge deletion' }),
          ).toBeVisible();
          await page
            .getByRole('button', { name: 'Acknowledge deletion' })
            .click();
          await expect(page.getByRole('dialog')).toHaveCount(0);
          assert.equal(await rowCount(), 4);
        },
      );
      await scenario(
        'session expiry preserves the draft and resumes with the same user',
        async () => {
          await open();
          await fields('70', '12');
          await operator.query(
            'UPDATE app.auth_sessions SET revoked_at=statement_timestamp() WHERE user_id=$1',
            [user.id],
          );
          await page
            .getByRole('button', { name: 'Save set', exact: true })
            .click();
          await expect(
            page.getByRole('heading', { name: 'Let’s get to work.' }),
          ).toBeVisible();
          await expect(
            page.getByLabel('Username', { exact: true }),
          ).toHaveValue('browser_admin');
          await page.getByLabel('Password', { exact: true }).fill(password);
          await page
            .getByRole('button', { name: 'Log in', exact: true })
            .click();
          await page
            .getByRole('button', { name: 'Resume', exact: true })
            .click();
          await expect(
            page.getByLabel('Weight (lbs)', { exact: true }),
          ).toHaveValue('70');
          await page.getByRole('button', { name: 'Retry same save' }).click();
          await expect(page.getByRole('dialog')).toHaveCount(0);
          assert.equal(await rowCount(), 5);
        },
      );
      await scenario(
        'known validation errors retain editable values; unavailable references can still be edited',
        async () => {
          await open();
          await fields('90', '1.5');
          await page
            .getByRole('button', { name: 'Save set', exact: true })
            .click();
          await expect(page.getByLabel('Reps', { exact: true })).toHaveValue(
            '1.5',
          );
          assert.equal(await rowCount(), 5);
          await page.getByLabel('Reps', { exact: true }).fill('9');
          await operator.query(
            'UPDATE app.exercises SET archived_at=statement_timestamp() WHERE id=$1',
            [bench],
          );
          await page
            .getByRole('button', { name: 'Save set', exact: true })
            .click();
          await expect(page.getByRole('alert')).toContainText('unavailable');
          await expect(
            page.getByLabel('Weight (lbs)', { exact: true }),
          ).toBeEnabled();
          await page
            .getByLabel('Exercise', { exact: true })
            .selectOption(incline);
          await page
            .getByRole('button', { name: 'Save set', exact: true })
            .click();
          await expect(page.getByRole('dialog')).toHaveCount(0);
          assert.equal(await rowCount(), 6);
          await page
            .getByRole('button', {
              name: 'Set 3, 135.125 pounds, 10 reps, RPE 7',
            })
            .click();
          await expect(
            page.getByRole('button', { name: 'Copy as next set' }),
          ).toBeDisabled();
          await page
            .getByRole('button', { name: 'Edit set', exact: true })
            .click();
          await page.getByLabel('Reps', { exact: true }).fill('11');
          await page
            .getByRole('button', { name: 'Save changes', exact: true })
            .click();
          await expect(page.getByRole('dialog')).toHaveCount(0);
          await expect(
            page.getByRole('button', {
              name: 'Set 3, 135.125 pounds, 11 reps, RPE 7',
            }),
          ).toBeVisible();
          await operator.query(
            'UPDATE app.exercises SET archived_at=NULL WHERE id=$1',
            [bench],
          );
          await page
            .getByRole('button', { name: 'Refresh', exact: true })
            .click();
        },
      );
      await scenario(
        'calendar backdating, timezone-correct history filter, edit and deliberate delete',
        async () => {
          await open();
          await fields('120', '5');
          await page.getByLabel('Performed at').fill('2026-03-08T23:59:59.123');
          await page
            .getByRole('button', { name: 'Save set', exact: true })
            .click();
          await expect(page.getByRole('dialog')).toHaveCount(0);
          await page
            .getByRole('button', { name: 'History', exact: true })
            .click();
          await page
            .getByRole('button', {
              name: /October|November|December|January|February|March|April|May|June|July|August|September/,
            })
            .first()
            .click();
          await expect(
            page.getByRole('dialog', { name: 'Choose a date' }),
          ).toBeVisible();
          await page.locator('.calendar-title').click();
          await page
            .getByRole('button', { name: 'March', exact: true })
            .click();
          await page
            .getByRole('button', { name: 'March 8, 2026', exact: true })
            .click();
          await expect(
            page.getByRole('button', {
              name: 'Set 1, 120 pounds, 5 reps, RPE 5',
            }),
          ).toBeVisible();
          await page.getByLabel('Exercise filter').selectOption(bench);
          await expect(
            page.getByRole('button', {
              name: 'Set 1, 120 pounds, 5 reps, RPE 5',
            }),
          ).toBeVisible();
          const recorded = (
            await operator.query(
              'SELECT performed_at FROM app.workouts WHERE weight=120',
            )
          ).rows[0].performed_at;
          const bounds = dayBounds('2026-03-08', 'America/Denver');
          assert.equal(recorded.toISOString(), '2026-03-09T05:59:59.123Z');
          assert.ok(
            recorded >= new Date(bounds.start) &&
              recorded < new Date(bounds.end),
          );
          await page
            .getByRole('button', { name: 'Set 1, 120 pounds, 5 reps, RPE 5' })
            .click();
          await page
            .getByRole('button', { name: 'Delete set', exact: true })
            .click();
          await page
            .getByRole('button', { name: 'Keep set', exact: true })
            .click();
          assert.equal(await rowCount(), 7);
          await page
            .getByRole('button', { name: 'Delete set', exact: true })
            .click();
          await page.getByRole('button', { name: 'Yes, delete set' }).click();
          await expect(page.getByRole('dialog')).toHaveCount(0);
          await expect(
            page.getByRole('button', {
              name: 'Set 1, 120 pounds, 5 reps, RPE 5',
            }),
          ).toHaveCount(0);
          assert.equal(await rowCount(), 6);
        },
      );
      await scenario(
        'mobile and desktop layout, accessible dialog focus and short viewport save reachability',
        async () => {
          await page
            .getByRole('button', { name: 'Today', exact: true })
            .click();
          await expect(
            page.getByRole('button', {
              name: 'Set 3, 135.125 pounds, 11 reps, RPE 7',
            }),
          ).toBeVisible();
          await noOverflow(page);
          await page.screenshot({
            path: `${screenshots}/today.png`,
            fullPage: true,
          });
          await open();
          await expect(
            page.getByLabel('Exercise', { exact: true }),
          ).toBeFocused();
          await fields('150', '10');
          await page.screenshot({ path: `${screenshots}/log-set.png` });
          await page.setViewportSize({ width: 390, height: 430 });
          await page.getByLabel('Reps', { exact: true }).focus();
          await page
            .getByRole('button', { name: 'Save set', exact: true })
            .scrollIntoViewIfNeeded();
          await expect(
            page.getByRole('button', { name: 'Save set', exact: true }),
          ).toBeInViewport();
          await noOverflow(page);
          await page.screenshot({ path: `${screenshots}/short-viewport.png` });
          await page
            .getByRole('button', { name: 'Close', exact: true })
            .click();
          page.once('dialog', (d) => d.accept());
          await page
            .getByRole('button', { name: 'Discard', exact: true })
            .click();
          await page.setViewportSize({ width: 320, height: 650 });
          await noOverflow(page);
          await page.screenshot({
            path: `${screenshots}/narrow.png`,
            fullPage: true,
          });
          await page.setViewportSize({ width: 1440, height: 900 });
          await noOverflow(page);
          await page.screenshot({
            path: `${screenshots}/desktop.png`,
            fullPage: true,
          });
          assert.deepEqual(pageErrors, []);
          const ownDate = todayIn('America/Denver');
          assert.ok(ownDate);
          await context.close();
        },
      );
    } finally {
      await browser?.close();
      if (vite)
        await new Promise<void>((resolve) =>
          vite!.httpServer.close(() => resolve()),
        );
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await pool.end();
      await operator.end();
      if (created) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
      await admin.end();
    }
  },
);
