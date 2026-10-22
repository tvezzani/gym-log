# Phone logging frontend

React, TypeScript, Vite and custom SCSS components. The supplied screenshot guides the charcoal surfaces, pale yellow accents, compact grouped set tables, plus action and year/month/day date navigation. Login uses the agreed username contract rather than the mockup's email field; each table row remains an independent set, with editable set number and RPE.

From the WSL repository root, with PostgreSQL running and migrations applied, use two terminals:

```bash
npm run dev:api
```

```bash
npm run dev:web
```

Open `http://127.0.0.1:5173`. Vite proxies `/api` to the API on loopback port 3000. `dev:api` uses the browser's exact origin for CSRF validation; it does not rewrite or bypass Origin checks. The existing `npm run dev` remains the standalone API command using `.env` configuration. Stop an older API process on 3000 before switching to `dev:api`. Contract changes require restarting the development API command.

For a different web origin, set `WEB_ORIGIN` for `dev:api` and adjust Vite's host/port deliberately. Keep this development server local; the private HTTPS deployment is a later milestone. No credentials, database URLs, or API auth secrets are exposed through Vite environment variables. On first visit, an unconfigured installation asks you to create its first admin through the browser. Choose a username, password (12–128 characters) and timezone, then log in. No default account is installed; optional CLI bootstrap/recovery is documented in `docs/AUTH.md`.

## Implemented

- First-run admin creation, cookie/CSRF login, restored sessions, forced temporary-password change, own password change and logout.
- Today, stored-timezone day navigation, year/month/day date picker and exercise-filtered history with bounded paging.
- Approved exercises and own pending exercises, last recorded values, explicit saves, decimal pounds, whole RPE and fresh set 1/RPE 5.
- Add new exercise from the log or set form by name. The pending exercise is selected immediately for private logging; creating/cancelling it preserves an existing set draft.
- Copy as next set with review before save, a new UUID/time and incremented set number; set edit and deliberate delete.
- Editable backdated instants, milliseconds, DST-aware day bounds, rejected nonexistent local times and an occurrence selector for repeated clock times.
- In-memory draft recovery across navigation and reauthentication. One frozen create UUID/payload survives uncertain responses and further retry failures. Resolve it through the same POST or by reading the current saved record before editing another submission. Deletion is acknowledged explicitly; retries cannot resurrect it.
- Native modal focus management, labeled inputs, suitable input modes, touch targets, visual-viewport-aware scrolling and sticky Save controls.
- Plan date selection, notes, create/edit/delete and full-date ordering; today's plans appear on Today. Log set prefills the exercise and current time without parsing notes or saving automatically.
- Settings with explicit stored-timezone changes and My exercises with own submission statuses. Plan dates remain literal dates; existing set drafts keep the timezone in which they were entered.
- Admin account creation, enable/disable, role changes and temporary-password resets; catalog approval/rejection, rename, archive/unarchive and guarded permanent deletion of unused exercises. All accounts keep private workout/plan history.
- Management forms survive navigation and reauthentication in memory. An uncertain plan create locks fields and requires reviewing the plan date before starting another entry.

There is no offline queue or local storage of workouts/passwords. Drafts survive within the running page, not reloads or browser restarts. A best-effort unload prompt protects an unsaved draft. Reauthentication is restricted to the draft owner's username until that draft is resolved/discarded; logging out is blocked while a draft exists.

## Verification

```bash
npm run check
npx playwright install chromium
# Once per new Ubuntu environment (installs Chromium system libraries):
sudo env PATH="$PATH" node node_modules/playwright/cli.js install-deps chromium
npm run test:web
```

The browser test creates and removes a disposable PostgreSQL database, starts the actual API and Vite preview of the built assets, and drives Chromium with cookie sessions at a mobile viewport. It verifies persisted CRUD, copied/default sets, precise weights, forced-password flows, uncertain saves, reauthentication, eligibility changes, backdated timezone filtering and responsive modal behavior. The management browser suite additionally verifies plan CRUD/order/date stability, timezone preferences, two-user privacy, the admin approval flow, account revocation/reset/roles and guarded exercise deletion. Screenshots are written to ignored `apps/web/test-results/`.

`npm run build` typechecks and builds the web bundle in `apps/web/dist`, as well as the API/contracts. Production same-origin hosting is still part of the deployment milestone; `npm start` currently starts the API only. Browser emulation does not complete the actual phone/browser, numeric-keyboard, Tailscale or production verification. See `docs/FRONTEND-GATE.md` and `docs/MANAGEMENT-GATE.md`.
