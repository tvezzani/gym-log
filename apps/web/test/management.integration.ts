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
import { setupAdmin } from '../../api/src/auth/bootstrap.ts';

test(
  'milestone 6 family workflow through real browsers and PostgreSQL',
  { timeout: 180000 },
  async (t) => {
    assert.ok(process.env.MIGRATION_DATABASE_URL);
    assert.ok(process.env.DATABASE_URL);
    const database = `gym_log_m6_${randomUUID().replaceAll('-', '')}`,
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
    const adminPassword = 'Chosen-admin-browser-password!',
      initial = 'Initial-family-password!',
      alicePassword = 'Alice-chosen-password!',
      bobPassword = 'Bob-chosen-password!';
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
          'M6_TEST_URL',
          '--migrations-dir',
          'db/migrations',
          'up',
        ],
        { env: { ...process.env, M6_TEST_URL: opUrl.href } },
      );
      await setupAdmin(pool, {
        username: 'admin',
        password: adminPassword,
        timeZone: 'America/Denver',
      });
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
      const contexts = await Promise.all(
        ['America/Denver', 'Asia/Tokyo', 'UTC'].map((timezoneId) =>
          browser!.newContext({
            viewport: { width: 390, height: 844 },
            isMobile: true,
            hasTouch: true,
            timezoneId,
          }),
        ),
      );
      const [admin, alice, bob] = (await Promise.all(
        contexts.map((c) => c.newPage()),
      )) as [Page, Page, Page];
      const errors: string[] = [];
      for (const page of [admin, alice, bob]) {
        page.setDefaultTimeout(7000);
        page.on('pageerror', (e) => errors.push(e.message));
        await page.clock.setFixedTime(new Date('2026-10-21T18:00:00.000Z'));
      }
      await mkdir('apps/web/test-results', { recursive: true });
      async function scenario(name: string, work: () => Promise<void>) {
        let failure: unknown;
        await t.test(name, async () => {
          try {
            await work();
          } catch (e) {
            failure = e;
            await admin.screenshot({
              path: 'apps/web/test-results/m6-admin-failure.png',
              fullPage: true,
            });
            await alice.screenshot({
              path: 'apps/web/test-results/m6-user-failure.png',
              fullPage: true,
            });
            throw e;
          }
        });
        if (failure) throw failure;
      }
      async function login(page: Page, username: string, password: string) {
        await page.getByLabel('Username', { exact: true }).fill(username);
        await page.getByLabel('Password', { exact: true }).fill(password);
        await page.getByRole('button', { name: 'Log in', exact: true }).click();
      }
      async function ready(page: Page, username: string, password: string) {
        await page.goto(config.APP_ORIGIN);
        await login(page, username, initial);
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
        await login(page, username, password);
        await expect(
          page.getByRole('heading', { name: 'Let’s put in the work.' }),
        ).toBeVisible();
      }
      async function menu(page: Page, name: string) {
        await page.getByRole('button', { name: 'Open menu' }).click();
        await page
          .getByRole('navigation', { name: 'Account', exact: true })
          .getByRole('button', { name, exact: true })
          .click();
      }
      const tab = (page: Page, name: string) =>
        page
          .getByRole('navigation', { name: 'Log views' })
          .getByRole('button', { name, exact: true })
          .click();
      const card = (page: Page, name: string) =>
        page.getByRole('article', { name, exact: true });
      async function confirm(page: Page, action: () => Promise<void>) {
        page.once('dialog', (d) => d.accept());
        await action();
      }
      async function addExercise(page: Page, name: string) {
        await page
          .getByRole('button', { name: 'Add new exercise', exact: true })
          .click();
        await page.getByLabel('Exercise name', { exact: true }).fill(name);
        await page
          .getByRole('button', { name: 'Add exercise', exact: true })
          .click();
        await expect(
          page.getByRole('dialog', { name: 'Log a set' }),
        ).toBeVisible();
      }
      async function discardSet(page: Page) {
        await page.getByRole('button', { name: 'Close', exact: true }).click();
        await confirm(page, () =>
          page.getByRole('button', { name: 'Discard', exact: true }).click(),
        );
      }
      async function newPlan(name: string, notes: string) {
        await alice
          .getByRole('button', { name: 'Add plan entry', exact: true })
          .click();
        const option = alice
          .getByLabel('Plan exercise')
          .getByRole('option')
          .filter({ hasText: name });
        await alice
          .getByLabel('Plan exercise')
          .selectOption((await option.getAttribute('value')) ?? '');
        await alice.getByLabel('Plan notes').fill(notes);
        await alice.getByRole('button', { name: 'Save plan entry' }).click();
        await expect(
          alice.getByRole('form', { name: 'New plan entry' }),
        ).toHaveCount(0);
      }
      const countSets = async () =>
        Number(
          (await operator.query('SELECT count(*)::int AS n FROM app.workouts'))
            .rows[0].n,
        );
      let goblet = '',
        paused = '',
        aliceId = '';
      await scenario(
        'admin creates family users and cannot remove the last active admin',
        async () => {
          await admin.goto(config.APP_ORIGIN);
          await login(admin, 'admin', adminPassword);
          await menu(admin, 'Manage accounts');
          for (const username of ['family_one', 'family_two']) {
            await admin
              .getByRole('button', { name: 'Create account', exact: true })
              .click();
            await admin.getByLabel('New username').fill(username);
            await expect(admin.getByLabel('Account role')).toHaveValue('user');
            await admin
              .getByLabel('Temporary password', { exact: true })
              .fill(initial);
            await admin.getByRole('button', { name: 'Save account' }).click();
            await expect(card(admin, username)).toBeVisible();
          }
          await confirm(admin, () =>
            card(admin, 'admin')
              .getByRole('button', { name: 'Make user' })
              .click(),
          );
          await expect(admin.getByRole('alert')).toContainText(
            'Keep at least one active admin',
          );
          await confirm(admin, () =>
            card(admin, 'admin')
              .getByRole('button', { name: 'Disable', exact: true })
              .click(),
          );
          await expect(admin.getByRole('alert')).toContainText(
            'Keep at least one active admin',
          );
          const users = (
            await operator.query(
              'SELECT username,role,must_change_password FROM app.users ORDER BY username',
            )
          ).rows;
          assert.equal(users.length, 3);
          assert.ok(
            users
              .filter((u) => u.role === 'user')
              .every((u) => u.must_change_password),
          );
          await admin.screenshot({
            path: 'apps/web/test-results/m6-accounts.png',
            fullPage: true,
          });
        },
      );
      await scenario(
        'user submits and logs privately; own status screen exposes no admin actions',
        async () => {
          await ready(alice, 'family_one', alicePassword);
          await addExercise(alice, 'Goblet squat');
          goblet = await alice
            .getByLabel('Exercise', { exact: true })
            .inputValue();
          await alice
            .getByLabel('Weight (lbs)', { exact: true })
            .fill('24.125');
          await alice.getByLabel('Reps', { exact: true }).fill('10');
          await alice
            .getByRole('button', { name: 'Save set', exact: true })
            .click();
          await expect(alice.getByRole('dialog')).toHaveCount(0);
          assert.equal(await countSets(), 1);
          await menu(alice, 'My exercises');
          await expect(card(alice, 'Goblet squat')).toContainText(
            'Pending · private',
          );
          await expect(
            alice.getByRole('button', { name: 'Rename', exact: true }),
          ).toHaveCount(0);
          await addExercise(alice, 'Paused pushup');
          paused = await alice
            .getByLabel('Exercise', { exact: true })
            .inputValue();
          await discardSet(alice);
          aliceId = (
            await operator.query(
              "SELECT id FROM app.users WHERE username='family_one'",
            )
          ).rows[0].id;
          const shared = await (
            await contexts[1]!.request.get(
              `${config.APP_ORIGIN}/api/v1/exercises`,
            )
          ).json();
          assert.equal(shared.items.length, 0);
          await alice.getByRole('button', { name: 'Open menu' }).click();
          await expect(
            alice.getByRole('button', { name: 'Manage accounts', exact: true }),
          ).toHaveCount(0);
          await alice.getByRole('button', { name: 'Open menu' }).click();
        },
      );
      await scenario(
        'private calendar plans support CRUD, reorder and a prefill without creating sets',
        async () => {
          await tab(alice, 'Plan');
          await expect(alice.getByLabel('Plan date')).toHaveValue('2026-10-21');
          await newPlan('Goblet squat', '3×10');
          await newPlan('Paused pushup', '5×5');
          await alice
            .getByRole('button', { name: 'Move Paused pushup up' })
            .click();
          await expect(alice.locator('.plan-list > li').first()).toContainText(
            'Paused pushup',
          );
          const gobletCard = alice.getByRole('listitem', {
            name: 'Goblet squat',
          });
          await gobletCard
            .getByRole('button', { name: 'Edit', exact: true })
            .click();
          await alice.getByLabel('Entry date').fill('2030-01-02');
          await alice.getByLabel('Plan notes').fill('3×8, controlled descent');
          await alice.getByRole('button', { name: 'Save plan entry' }).click();
          await expect(
            alice.getByRole('form', { name: 'Edit plan entry' }),
          ).toHaveCount(0);
          await expect(gobletCard).toHaveCount(0);
          await alice.getByLabel('Plan date').fill('2030-01-02');
          await expect(gobletCard).toContainText('3×8, controlled descent');
          const before = await countSets();
          await gobletCard
            .getByRole('button', { name: 'Log set', exact: false })
            .click();
          await expect(
            alice.getByLabel('Exercise', { exact: true }),
          ).toHaveValue(goblet);
          await expect(alice.getByLabel('Performed at')).toHaveValue(
            '2026-10-21T12:00',
          );
          assert.equal(await countSets(), before);
          await discardSet(alice);
          await alice.screenshot({
            path: 'apps/web/test-results/m6-plan.png',
            fullPage: true,
          });
        },
      );
      await scenario(
        'timezone preferences persist, regroup history and never shift plan dates',
        async () => {
          await tab(alice, 'Settings');
          await alice
            .getByLabel('Timezone', { exact: true })
            .fill('Invalid/Zone');
          await alice.getByRole('button', { name: 'Save timezone' }).click();
          await expect(alice.getByRole('alert')).toBeVisible();
          await alice
            .getByLabel('Timezone', { exact: true })
            .fill('Asia/Tokyo');
          await alice.getByRole('button', { name: 'Save timezone' }).click();
          await expect(
            alice.getByRole('button', { name: 'Save timezone' }),
          ).toBeDisabled();
          await tab(alice, 'Today');
          await expect(
            alice.getByRole('button', {
              name: 'October 22, 2026',
              exact: true,
            }),
          ).toBeVisible();
          await expect(
            alice.getByRole('button', {
              name: 'Set 1, 24.125 pounds, 10 reps, RPE 5',
            }),
          ).toBeVisible();
          await tab(alice, 'Plan');
          await alice.getByLabel('Plan date').fill('2030-01-02');
          await expect(
            alice.getByRole('listitem', { name: 'Goblet squat' }),
          ).toContainText('3×8');
          const stored = (
            await operator.query(
              'SELECT planned_date::text AS date FROM app.planned_exercises WHERE exercise_id=$1',
              [goblet],
            )
          ).rows[0].date;
          assert.equal(stored, '2030-01-02');
          await alice.reload();
          await tab(alice, 'Settings');
          await expect(
            alice.getByLabel('Timezone', { exact: true }),
          ).toHaveValue('Asia/Tokyo');
        },
      );
      await scenario(
        'plan drafts survive reauthentication and unknown creates require review',
        async () => {
          await tab(alice, 'Plan');
          await alice
            .getByRole('button', { name: 'Add plan entry', exact: true })
            .click();
          await alice.getByLabel('Plan exercise').selectOption(goblet);
          await alice
            .getByLabel('Plan notes')
            .fill('Retain after expired session');
          await operator.query(
            'UPDATE app.auth_sessions SET revoked_at=statement_timestamp() WHERE user_id=$1',
            [aliceId],
          );
          await alice.getByRole('button', { name: 'Save plan entry' }).click();
          await expect(
            alice.getByRole('heading', { name: 'Let’s get to work.' }),
          ).toBeVisible();
          await alice
            .getByLabel('Password', { exact: true })
            .fill(alicePassword);
          await alice
            .getByRole('button', { name: 'Log in', exact: true })
            .click();
          await expect(alice.getByLabel('Plan notes')).toHaveValue(
            'Retain after expired session',
          );
          await alice.getByRole('button', { name: 'Save plan entry' }).click();
          await expect(
            alice.getByRole('form', { name: 'New plan entry' }),
          ).toHaveCount(0);
          await alice
            .getByRole('button', { name: 'Add plan entry', exact: true })
            .click();
          await alice.getByLabel('Plan exercise').selectOption(goblet);
          await alice.getByLabel('Plan notes').fill('Unknown response');
          await alice.route('**/api/v1/planned-exercises', async (route) => {
            if (route.request().method() === 'POST') {
              await route.fetch();
              await route.abort('failed');
            } else await route.continue();
          });
          await alice.getByRole('button', { name: 'Save plan entry' }).click();
          await expect(
            alice.getByRole('button', { name: 'Close after reviewing' }),
          ).toBeVisible();
          await expect(alice.getByLabel('Plan notes')).toBeDisabled();
          await alice.unroute('**/api/v1/planned-exercises');
          await alice.getByRole('button', { name: 'Check plan list' }).click();
          await expect(
            alice.getByText('Unknown response', { exact: true }),
          ).toBeVisible();
          await alice
            .getByRole('button', { name: 'Close after reviewing' })
            .click();
          assert.equal(
            (
              await operator.query(
                "SELECT count(*)::int AS n FROM app.planned_exercises WHERE notes='Unknown response'",
              )
            ).rows[0].n,
            1,
          );
        },
      );
      await scenario(
        'approval shares an exercise while another user cannot see private sets or plans',
        async () => {
          await menu(admin, 'Review exercises');
          await card(admin, 'Goblet squat')
            .getByRole('button', { name: 'Approve', exact: true })
            .click();
          await expect(card(admin, 'Goblet squat')).toHaveCount(0);
          await ready(bob, 'family_two', bobPassword);
          await expect(
            bob.getByRole('heading', { name: 'Start with one set.' }),
          ).toBeVisible();
          await bob
            .getByRole('button', { name: 'Log a set', exact: true })
            .last()
            .click();
          await expect(
            bob
              .getByLabel('Exercise', { exact: true })
              .getByRole('option', { name: 'Goblet squat', exact: true }),
          ).toHaveCount(1);
          await expect(
            bob
              .getByLabel('Exercise', { exact: true })
              .getByRole('option')
              .filter({ hasText: 'Paused pushup' }),
          ).toHaveCount(0);
          await discardSet(bob);
          const history = await (
            await contexts[2]!.request.get(
              `${config.APP_ORIGIN}/api/v1/workouts`,
            )
          ).json();
          assert.deepEqual(history.items, []);
          await tab(bob, 'Plan');
          await expect(
            bob.getByText('Make room for your next workout.'),
          ).toBeVisible();
          assert.equal(
            (
              await contexts[2]!.request.get(
                `${config.APP_ORIGIN}/api/v1/admin/users`,
              )
            ).status(),
            403,
          );
          await menu(alice, 'My exercises');
          await expect(card(alice, 'Goblet squat')).toContainText(
            'Approved · shared',
          );
        },
      );
      await scenario(
        'admin rename/archive/reject and guarded deletion preserve referenced history and plans',
        async () => {
          await admin.getByLabel('Review status').selectOption('approved');
          await card(admin, 'Goblet squat')
            .getByRole('button', { name: 'Rename', exact: true })
            .click();
          await admin
            .getByLabel('Exercise name', { exact: true })
            .fill('Kettlebell goblet squat');
          await admin.getByRole('button', { name: 'Save name' }).click();
          await expect(card(admin, 'Kettlebell goblet squat')).toBeVisible();
          await confirm(admin, () =>
            card(admin, 'Kettlebell goblet squat')
              .getByRole('button', { name: 'Delete exercise' })
              .click(),
          );
          await expect(admin.getByRole('alert')).toContainText(
            'used by workouts or plans',
          );
          await card(admin, 'Kettlebell goblet squat')
            .getByRole('button', { name: 'Archive', exact: true })
            .click();
          await expect(card(admin, 'Kettlebell goblet squat')).toContainText(
            'Archived',
          );
          await tab(alice, 'Today');
          await alice
            .getByRole('button', { name: 'Refresh', exact: true })
            .click();
          await expect(
            alice.getByText('Kettlebell goblet squat', { exact: true }).first(),
          ).toBeVisible();
          await alice
            .getByRole('button', {
              name: 'Set 1, 24.125 pounds, 10 reps, RPE 5',
            })
            .click();
          await expect(
            alice.getByRole('button', { name: 'Copy as next set' }),
          ).toBeDisabled();
          await alice
            .getByRole('button', { name: 'Close', exact: true })
            .click();
          await tab(alice, 'Plan');
          await alice.getByLabel('Plan date').fill('2030-01-02');
          const historical = alice.getByRole('listitem', {
            name: 'Kettlebell goblet squat',
          });
          await expect(
            historical.getByRole('button', { name: 'Log set', exact: false }),
          ).toBeDisabled();
          await historical
            .getByRole('button', { name: 'Edit', exact: true })
            .click();
          await alice
            .getByLabel('Plan notes')
            .fill('Still editable after archival');
          await alice.getByRole('button', { name: 'Save plan entry' }).click();
          await expect(historical).toContainText(
            'Still editable after archival',
          );
          await admin.getByLabel('Review status').selectOption('pending');
          await confirm(admin, () =>
            card(admin, 'Paused pushup')
              .getByRole('button', { name: 'Reject', exact: true })
              .click(),
          );
          await admin.getByLabel('Review status').selectOption('rejected');
          await confirm(admin, () =>
            card(admin, 'Paused pushup')
              .getByRole('button', { name: 'Delete exercise' })
              .click(),
          );
          await expect(admin.getByRole('alert')).toContainText(
            'used by workouts or plans',
          );
          await alice.getByLabel('Plan date').fill('2026-10-21');
          const rejected = alice.getByRole('listitem', {
            name: 'Paused pushup',
          });
          await expect(rejected).toContainText('Rejected');
          await confirm(alice, () =>
            rejected
              .getByRole('button', { name: 'Delete', exact: true })
              .click(),
          );
          await expect(rejected).toHaveCount(0);
          await confirm(admin, () =>
            card(admin, 'Paused pushup')
              .getByRole('button', { name: 'Delete exercise' })
              .click(),
          );
          await expect(card(admin, 'Paused pushup')).toHaveCount(0);
          assert.equal(
            (
              await operator.query(
                'SELECT count(*)::int AS n FROM app.exercises WHERE id=$1',
                [paused],
              )
            ).rows[0].n,
            0,
          );
          await admin.screenshot({
            path: 'apps/web/test-results/m6-catalog.png',
            fullPage: true,
          });
        },
      );
      await scenario(
        'account disable/enable/reset revokes sessions and requires a new password',
        async () => {
          await menu(admin, 'Manage accounts');
          await confirm(admin, () =>
            card(admin, 'family_two')
              .getByRole('button', { name: 'Disable', exact: true })
              .click(),
          );
          await expect(card(admin, 'family_two')).toContainText('Disabled');
          await tab(bob, 'Today');
          await expect(
            bob.getByRole('heading', { name: 'Let’s get to work.' }),
          ).toBeVisible();
          await confirm(admin, () =>
            card(admin, 'family_two')
              .getByRole('button', { name: 'Enable', exact: true })
              .click(),
          );
          await login(bob, 'family_two', bobPassword);
          await expect(
            bob.getByRole('heading', { name: 'Let’s put in the work.' }),
          ).toBeVisible();
          await card(admin, 'family_two')
            .getByRole('button', { name: 'Reset password', exact: true })
            .click();
          const form = admin.getByRole('form', {
            name: 'Reset password',
            exact: true,
          });
          await form
            .getByLabel('Temporary password', { exact: true })
            .fill('New-family-temporary-password!');
          await form
            .getByRole('button', { name: 'Reset password', exact: true })
            .click();
          await expect(form).toHaveCount(0);
          await bob
            .getByRole('button', { name: 'Refresh', exact: true })
            .click();
          await expect(
            bob.getByRole('heading', { name: 'Let’s get to work.' }),
          ).toBeVisible();
          await login(bob, 'family_two', 'New-family-temporary-password!');
          await expect(
            bob.getByRole('heading', { name: 'Make it yours.' }),
          ).toBeVisible();
          await bob
            .getByLabel('Current password', { exact: true })
            .fill('New-family-temporary-password!');
          await bob
            .getByLabel('New password', { exact: true })
            .fill('Bob-final-after-reset-password!');
          await bob
            .getByLabel('Confirm new password', { exact: true })
            .fill('Bob-final-after-reset-password!');
          await bob
            .getByRole('button', { name: 'Change password', exact: true })
            .click();
          await expect(
            bob.getByRole('button', { name: 'Log in', exact: true }),
          ).toBeVisible();
          await login(bob, 'family_two', 'Bob-final-after-reset-password!');
          await expect(
            bob.getByRole('heading', { name: 'Let’s put in the work.' }),
          ).toBeVisible();
        },
      );
      await scenario(
        'role updates revoke sessions, account list failures recover, and layouts fit narrow screens',
        async () => {
          await confirm(admin, () =>
            card(admin, 'family_one')
              .getByRole('button', { name: 'Make admin' })
              .click(),
          );
          await tab(alice, 'Today');
          await expect(
            alice.getByRole('heading', { name: 'Let’s get to work.' }),
          ).toBeVisible();
          await login(alice, 'family_one', alicePassword);
          await menu(alice, 'Manage accounts');
          await expect(
            alice.getByRole('heading', { name: 'Family accounts.' }),
          ).toBeVisible();
          await confirm(admin, () =>
            card(admin, 'family_one')
              .getByRole('button', { name: 'Make user' })
              .click(),
          );
          await alice.getByRole('button', { name: 'Refresh accounts' }).click();
          await expect(
            alice.getByRole('heading', { name: 'Let’s get to work.' }),
          ).toBeVisible();
          await login(alice, 'family_one', alicePassword);
          await alice.getByRole('button', { name: 'Open menu' }).click();
          await expect(
            alice.getByRole('button', { name: 'Manage accounts', exact: true }),
          ).toHaveCount(0);
          await alice.getByRole('button', { name: 'Open menu' }).click();
          await admin.route('**/api/v1/admin/users?*', (route) =>
            route.fulfill({
              status: 500,
              contentType: 'application/json',
              body: JSON.stringify({
                error: {
                  code: 'INTERNAL_ERROR',
                  message: 'Temporary list failure',
                },
              }),
            }),
          );
          await admin.getByRole('button', { name: 'Refresh accounts' }).click();
          await expect(admin.getByRole('alert')).toContainText(
            'Temporary list failure',
          );
          await admin.unroute('**/api/v1/admin/users?*');
          await admin.getByRole('button', { name: 'Refresh accounts' }).click();
          await expect(card(admin, 'family_two')).toBeVisible();
          for (const page of [admin, alice, bob]) {
            await page.setViewportSize({ width: 320, height: 650 });
            assert.equal(
              await page.evaluate(
                () => document.documentElement.scrollWidth > window.innerWidth,
              ),
              false,
            );
          }
          await tab(alice, 'Settings');
          await alice.screenshot({
            path: 'apps/web/test-results/m6-settings.png',
            fullPage: true,
          });
          assert.deepEqual(errors, []);
        },
      );
      await scenario(
        'timezone changes preserve an existing set draft and catalog failures recover',
        async () => {
          await tab(alice, 'Today');
          await alice
            .getByRole('button', { name: 'Log a set', exact: true })
            .last()
            .click();
          await alice
            .getByLabel('Weight (lbs)', { exact: true })
            .fill('37.125');
          const wallTime = await alice.getByLabel('Performed at').inputValue();
          await alice
            .getByRole('button', { name: 'Close', exact: true })
            .click();
          await tab(alice, 'Settings');
          await alice.getByLabel('Timezone', { exact: true }).fill('UTC');
          await alice.getByRole('button', { name: 'Save timezone' }).click();
          await expect(
            alice.getByRole('button', { name: 'Save timezone' }),
          ).toBeDisabled();
          await alice
            .getByRole('button', { name: 'Resume', exact: true })
            .click();
          await expect(alice.getByLabel('Performed at')).toHaveValue(wallTime);
          await expect(
            alice.getByLabel('Weight (lbs)', { exact: true }),
          ).toHaveValue('37.125');
          await expect(
            alice.getByText('Asia/Tokyo', { exact: false }),
          ).toBeVisible();
          await discardSet(alice);
          await alice.route('**/api/v1/exercises?*', (route) =>
            route.fulfill({
              status: 500,
              contentType: 'application/json',
              body: JSON.stringify({
                error: {
                  code: 'INTERNAL_ERROR',
                  message: 'Temporary exercise failure',
                },
              }),
            }),
          );
          await alice
            .getByLabel('Timezone', { exact: true })
            .fill('Asia/Tokyo');
          await alice.getByRole('button', { name: 'Save timezone' }).click();
          await expect(alice.getByRole('alert')).toContainText(
            'Temporary exercise failure',
          );
          await alice.unroute('**/api/v1/exercises?*');
          await alice
            .getByRole('button', { name: 'Retry exercise list' })
            .click();
          await expect(alice.getByRole('alert')).toHaveCount(0);
        },
      );
      await scenario(
        'an admin self-reset retains the set draft and its owner through both logins',
        async () => {
          await tab(admin, 'Today');
          await admin
            .getByRole('button', { name: 'Log a set', exact: true })
            .last()
            .click();
          await admin
            .getByLabel('Weight (lbs)', { exact: true })
            .fill('12.125');
          await admin
            .getByRole('button', { name: 'Close', exact: true })
            .click();
          await menu(admin, 'Manage accounts');
          await card(admin, 'admin')
            .getByRole('button', { name: 'Reset password', exact: true })
            .click();
          const form = admin.getByRole('form', {
            name: 'Reset password',
            exact: true,
          });
          await form
            .getByLabel('Temporary password', { exact: true })
            .fill('Admin-reset-temporary-password!');
          await form
            .getByRole('button', { name: 'Reset password', exact: true })
            .click();
          await expect(
            admin.getByRole('button', { name: 'Log in', exact: true }),
          ).toBeVisible();
          await expect(
            admin.getByLabel('Username', { exact: true }),
          ).toHaveValue('admin');
          await expect(
            admin.getByLabel('Username', { exact: true }),
          ).toHaveAttribute('readonly', '');
          await admin
            .getByLabel('Password', { exact: true })
            .fill('Admin-reset-temporary-password!');
          await admin
            .getByRole('button', { name: 'Log in', exact: true })
            .click();
          await expect(
            admin.getByRole('heading', { name: 'Make it yours.' }),
          ).toBeVisible();
          await admin
            .getByLabel('Current password', { exact: true })
            .fill('Admin-reset-temporary-password!');
          await admin
            .getByLabel('New password', { exact: true })
            .fill('Admin-final-after-reset-password!');
          await admin
            .getByLabel('Confirm new password', { exact: true })
            .fill('Admin-final-after-reset-password!');
          await admin
            .getByRole('button', { name: 'Change password', exact: true })
            .click();
          await expect(
            admin.getByLabel('Username', { exact: true }),
          ).toHaveValue('admin');
          await admin
            .getByLabel('Password', { exact: true })
            .fill('Admin-final-after-reset-password!');
          await admin
            .getByRole('button', { name: 'Log in', exact: true })
            .click();
          await admin
            .getByRole('button', { name: 'Resume unsaved set' })
            .click();
          await expect(
            admin.getByLabel('Weight (lbs)', { exact: true }),
          ).toHaveValue('12.125');
          await discardSet(admin);
          assert.deepEqual(errors, []);
        },
      );
      await Promise.all(contexts.map((c) => c.close()));
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
