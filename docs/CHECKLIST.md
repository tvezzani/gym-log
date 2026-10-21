# Build checklist

Complete one small, usable stage at a time. Checked items describe setup already performed; application tasks remain open.

## 0. Agree on the small version

- [x] Capture the first PRD and clarification questions.
- [x] Confirm independent set records and online-only v1.
- [x] Confirm Ubuntu hosting and Tailscale phone access.
- [x] Confirm pounds only, no bodyweight tracking, private dated plans, and fresh-set/copy numbering.
- [ ] Resolve dumbbell weight convention, RPE increments, planning time precision, and history/catalog permissions.
- [ ] Choose Docker Compose or native services; confirm server resources and backup destination.
- [ ] Finalize schema and REST examples against the decisions.

## 1. Establish the repository

- [x] Initialize local Git on the `main` branch.
- [ ] Add the repository folder as a Codex project if desired.
- [ ] Verify WSL access; use one chosen development checkout.
- [ ] Scaffold npm workspaces: `apps/api`, `apps/web`, `packages/contracts`.
- [ ] Pin a supported Node release and package versions; commit a lockfile.
- [ ] Add environment variable examples, ignored secrets, formatter/linter, and type checks.
- [ ] Provide a documented command to start the API, frontend, and development database.

## 2. Deliver the API first

- [ ] Write migrations for users, exercises, independent workout records, planned exercises, and auth sessions.
- [ ] Add constraints, ownership indexes, and deterministic migration/seed commands.
- [ ] Implement the superadmin bootstrap and username/password session login.
- [ ] Implement account create/disable/reset and password change, with role checks and session revocation.
- [ ] Implement exercise, set, and planned-exercise endpoints with runtime validation.
- [ ] Implement history filters, pagination, duplicate-request protection, and consistent errors.
- [ ] Publish an OpenAPI contract and usable example requests.
- [ ] Verify the API can create, retrieve, edit, and delete a set before frontend work.
- [ ] Test real PostgreSQL persistence, invalid data, retry behavior, authentication, and two-user isolation.

## 3. Deliver the phone workflow

- [ ] Build the login screen and authenticated navigation.
- [ ] Build today's set list and fast entry form using custom React/SCSS components.
- [ ] Start fresh entries at set 1; add Copy as next set with a new ID/time and an incremented number.
- [ ] Label all weights in pounds; implement copy prefills and last-value display.
- [ ] Preserve unsaved values on failed requests; show explicit save status.
- [ ] Build history filtering and set edit/delete.
- [ ] Build dated plans with notes, ordering, and a Log set shortcut.
- [ ] Add minimal password/settings and account administration screens.
- [ ] Check touch targets, labels, keyboard behavior, and layout on the actual phone.
- [ ] Run one full flow: admin creates family account → user logs in → saves set → reloads → sees history.

## 4. Run it on Ubuntu

- [ ] Build the React assets and production API; serve them under one origin.
- [ ] Configure persistent PostgreSQL storage, secrets, and explicit migration steps.
- [ ] Configure Tailscale HTTPS and access for the required family devices.
- [ ] Confirm app/database port bindings match the private deployment design.
- [ ] Enable restart behavior, health checks, and useful logs without credentials/passwords.
- [ ] Schedule backups outside the database volume and perform a test restore.
- [ ] Document updates, rollback, superadmin recovery, and backup restoration.
- [ ] Test from the phone over cellular data using Tailscale, then test a service/server restart.

## 5. Use it, then refine

- [ ] Log a real gym visit and note interruptions or unnecessary taps.
- [ ] Fix the largest friction points before expanding scope.
- [ ] Revisit export, timers, templates, charts, and offline support only after the core flow is reliable.
