# Build checklist

Complete one small, usable stage at a time. Checked items describe setup already performed; application tasks remain open.

## 0. Agree on the small version

- [x] Capture the first PRD and clarification questions.
- [x] Confirm independent set records and online-only v1.
- [x] Confirm Ubuntu hosting and Tailscale phone access.
- [x] Confirm pounds only, no bodyweight tracking, private dated plans, and fresh-set/copy numbering.
- [x] Confirm whole-number RPE, shared catalog with exercise approval, and private app history with separate database-owner access.
- [x] Choose Docker Compose and admin-managed accounts/recovery without signup or email.
- [x] Confirm user-defined dumbbell convention, calendar-date plans, and private logging against own pending exercises.
- [ ] Confirm server resources, existing services, and backup destination.
- [x] Finalize schema and REST examples against the decisions.

## 1. Establish the repository

- [x] Initialize local Git on the `main` branch.
- [ ] Add the repository folder as a Codex project if desired.
- [x] Verify WSL access; use one chosen development checkout.
- [x] Scaffold npm workspaces: `apps/api`, `apps/web`, `packages/contracts`.
- [x] Pin a supported Node release and package versions; generate a lockfile.
- [x] Review and commit the scaffold and lockfile.
- [x] Add environment variable examples, ignored secrets, formatter/linter, and type checks.
- [x] Document API/database startup commands; reserve frontend startup for its implementation milestone.

- [x] Verify baseline build/lint/types/tests, real PostgreSQL permissions, migration reruns, and both API startup commands.

## 2. Deliver the API first

- [x] Write migrations for users, exercises, independent workout records, planned exercises, and auth sessions.
- [x] Add constraints, ownership indexes, and deterministic migration/seed commands.
- [x] Implement the admin bootstrap and username/password session login.
- [x] Implement account create/disable/reset and password change, with role checks and session revocation.
- [ ] Implement exercise, set, and planned-exercise endpoints with runtime validation.
- [ ] Implement exercise submissions and a admin approval/rejection queue; restrict pending submissions to their owner and reviewers.
- [ ] Allow logging against own pending exercises; block use of another user's pending exercise and preserve history through review decisions.
- [x] Define/test SQL `date` and `YYYY-MM-DD` contracts for plans, with date validation and no timezone conversion.
- [ ] Implement history filters, pagination, duplicate-request protection, and consistent errors.
- [x] Publish an OpenAPI contract and usable example requests (planned feature routes; health implemented).
- [ ] Verify the API can create, retrieve, edit, and delete a set before frontend work.
- [ ] Test real PostgreSQL persistence, integer RPE validation, retry behavior, authentication, exercise approval, and ownership isolation (including admin app requests).

## 3. Deliver the phone workflow

- [ ] Build the login screen and authenticated navigation.
- [ ] Build today's set list and fast entry form using custom React/SCSS components.
- [ ] Start fresh entries at set 1; add Copy as next set with a new ID/time and an incremented number.
- [ ] Label all weights in pounds; implement copy prefills and last-value display.
- [ ] Preserve unsaved values on failed requests; show explicit save status.
- [ ] Build history filtering and set edit/delete.
- [ ] Build calendar-date plans with notes, ordering, and a Log set shortcut; verify dates do not shift with timezones.
- [ ] Add minimal password/settings and account administration screens.
- [ ] Add exercise submission/status and admin approval controls.
- [ ] Check touch targets, labels, keyboard behavior, and layout on the actual phone.
- [ ] Run one full flow: admin creates family account → user logs in → saves set → reloads → sees history.

## 4. Run it on Ubuntu

- [ ] Build the React assets and production API; serve them under one origin.
- [ ] Configure persistent PostgreSQL storage, secrets, and explicit migration steps.
- [ ] Separate application database credentials from database operator credentials.
- [ ] Configure Tailscale HTTPS and access for the required family devices.
- [ ] Confirm app/database port bindings match the private deployment design.
- [ ] Enable restart behavior, health checks, and useful logs without credentials/passwords.
- [ ] Schedule backups outside the database volume and perform a test restore.
- [ ] Document updates, rollback, admin recovery, and backup restoration.
- [ ] Test from the phone over cellular data using Tailscale, then test a service/server restart.

## 5. Use it, then refine

- [ ] Log a real gym visit and note interruptions or unnecessary taps.
- [ ] Fix the largest friction points before expanding scope.
- [ ] Revisit export, timers, templates, charts, and offline support only after the core flow is reliable.

## Milestone 3 verification

- [x] Verify 30-day absolute expiry and immediate password changes for new/bootstrap/reset accounts.
- [x] Verify exactly two roles, user denial on admin routes, shaped user responses and role-change session revocation.
- [x] Verify CSRF/origin checks, production Secure cookies, explicit proxy trust and persistent login throttles.
- [x] Verify reset/login revocation races, concurrent last-admin protection and serialized bootstrap in real PostgreSQL.
- [ ] Build browser login and password-change forms during the frontend milestones.
