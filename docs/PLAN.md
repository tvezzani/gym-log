# Implementation plan

Created October 21, 2026, from `README.md`, `PRD.md`, `CHECKLIST.md`, and `QUESTIONS.md`.

This is a build sequence, not an expansion of the agreed scope. The PRD and confirmed decisions remain the product reference; the checklist tracks completed work. Proposed choices below need to be recorded as decisions when adopted. No application implementation is included in this planning step.

## Delivery approach

Build the documented API against real PostgreSQL before starting the frontend. Then deliver the phone workflow, account/catalog controls, and private Ubuntu deployment. Finish each milestone with a demonstrable result and a small, coherent Git commit or series of commits.

Use the proposed TypeScript npm workspace layout: `apps/api`, `apps/web`, `packages/contracts`, `db/migrations`, and `infra`. Keep custom React components and SCSS. Select maintained package versions during scaffolding, record the choices, and commit the lockfile; this plan does not prescribe unverified versions.

Preserve these boundaries throughout:

- Each workout row is one independent set. There are no sessions, inferred daily numbering, or automatic plan completion.
- Records and plans belong to the authenticated user. Admin has no app/API access to other users' history or plans.
- Only approved, unarchived exercises and the user's own unarchived pending exercises can be selected for new sets. Review decisions preserve existing references and history.
- Weight is a decimal value in pounds, RPE is an integer, and planned dates are calendar dates without timezones.
- Saves require the server. A failed request preserves the form; retry protection does not introduce offline storage or synchronization.

## Decisions to settle at the relevant milestone

These are proposals, not newly confirmed requirements. Update `QUESTIONS.md` when a choice is accepted and reconcile the PRD, API contract, and checklist if necessary.

| When                     | Detail                                   | Proposed direction                                                                                                                                                                                                                                                   |
| ------------------------ | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Before scaffolding       | Development checkout and tooling         | Verify WSL access and use a checkout under its Linux home if available. Otherwise document a working Windows path; do not block API development solely on WSL. Select the Node release, package versions, SQL access/migration tooling, and validation library here. |
| Before schema/API freeze | Exercise maintenance and rejection       | Adopt the PRD proposal: admin rename/archive, rejected exercises unavailable for new entries, and existing history preserved. Omit a rejection reason field unless requested.                                                                                        |
| Before schema/API freeze | Plans referencing unavailable exercises  | Proposed: use the same exercise eligibility for new plans as for new sets. Preserve older plans if an exercise is rejected/archived, label its status, and block logging from it. Confirm and document this rule.                                                    |
| Before schema/API freeze | Editing historical sets/plans            | Proposed: allow edits that retain an existing rejected/archived exercise reference; require current eligibility when changing the exercise. Preserve the displayed historical reference.                                                                             |
| Before authentication    | Session lifetime and temporary passwords | Choose explicit expiry and whether reset/bootstrap passwords require a change on next login. A forced-change policy requires schema/session state, a restricted auth flow, and UI support. Do not silently add it.                                                   |
| Before authentication    | Account identity rules                   | Define username case handling, uniqueness, length limits, and password limits. Store a validated IANA timezone per user; define the initial value during account creation.                                                                                           |
| Before history/UI        | Timezone behavior and preferences API    | Proposed: group sets using the stored user timezone, with explicit preference changes rather than automatic changes while traveling. Add a documented own-preferences endpoint for timezone updates; the REST outline does not currently include one.                |
| Before UI verification   | Phone/browser                            | Identify the actual family phone/browser for final keyboard and layout checks. Responsive desktop checks can proceed first.                                                                                                                                          |
| Before deployment        | Ubuntu environment                       | Confirm RAM/storage, CPU architecture, existing services/ports, Tailscale setup/access, and backup destination/retention. Use the proposed Compose PostgreSQL service unless the existing environment warrants a documented change.                                  |

Keep the proposed positive-rep strength-set scope. Defer warmup markers, failed attempts, timed holds, cardio, and done/skipped plan markers unless explicitly added to scope.

## 1. Scaffold a reproducible development environment

**Result:** a clean checkout can start the development database and API with documented commands.

- Choose one active development checkout; preserve existing changes before moving between Windows and WSL.
- Create npm workspaces and TypeScript configuration. Reserve `apps/web` for later frontend work; do not build UI yet.
- Add linting, formatting, type checks, a lockfile, and a pinned supported Node release.
- Create environment examples and ignore real secrets, database storage, generated builds, and backups.
- Add development PostgreSQL configuration and migration commands. Choose ordinary PostgreSQL for both development and production as the baseline; evaluate alternatives only if there is a concrete need.
- Establish API startup, consistent JSON errors, minimal public health status, and an internal database readiness check. Keep the application and operator database credentials separate.

**Exit check:** follow the README from a clean environment, start the API/database, run the baseline checks, and confirm a database connection without exposing credentials in responses or logs.

## 2. Finalize the contract and persistence model

**Result:** reviewed request/response examples and migrations establish the rules before feature implementation.

- Write `docs/openapi.yaml` for `/api/v1`, including auth, exercises/submissions/review, sets, plans, accounts, and timezone preferences if adopted.
- Define runtime schemas in `packages/contracts`, exporting only browser-safe types and validation. Document field errors, unauthenticated/forbidden/not-found behavior, conflict responses, bounds, and pagination.
- Specify create/edit/read examples for a set, a pending exercise submission, a dated plan, and an account reset. Include the stable set UUID and identical-request retry behavior.
- Define `performedAt` as an offset/Z timestamp with millisecond precision; use server timestamps for creation/update metadata. Use `timestamptz(3)` in PostgreSQL. Decide how API input with finer precision is handled.
- Represent weights as decimal strings and store `numeric(8,3)`. Validate precision/range before SQL conversion, including rejection of excess decimal places. Keep reps/set numbers positive integers and RPE an integer from 1 to 10 with default 5.
- Represent `plannedDate` as a validated `YYYY-MM-DD` string and SQL `date`. Avoid JavaScript UTC-midnight conversion for this field.
- Migrate users, exercises, workouts, planned exercises, and server-side auth sessions, including foreign keys, checks, defaults, timestamps, and the PRD's ownership/history indexes.
- Define stable list ordering and bounded pagination, plus plan reorder behavior. Proposed: update the owner's entries for one date atomically so partial requests cannot leave a half-applied order.
- Document how archived/rejected references remain readable and how account/session rows are retained or expired. Do not add destructive account deletion to v1.
- Provide explicit migration and development-fixture commands; production bootstrap is a separate operation with no default password.

**Exit check:** migrations build an empty real PostgreSQL database; direct SQL rejects invalid constrained values; the contract covers the acceptance criteria and the exercise lifecycle decisions above. Document retry and rollback/recovery behavior for migrations.

## 3. Implement authentication and account administration

**Result:** users and admins can authenticate, with distinct account-management permissions.

- Add a server command to create the first admin using a supplied secret without committing or logging it.
- Implement maintained Argon2id password hashing, opaque PostgreSQL-backed sessions, login/logout/me, and own-password changes.
- Configure cookie flags, expiry, login session rotation, CSRF protection, login rate limits, and deployment-specific proxy trust. Document any local HTTP development exceptions; production requires secure cookies over HTTPS.
- Implement account creation, disable, password reset, and authorized role updates. Revoke sessions on disable/reset and define consistent revocation for own-password changes.
- Guard against disabling or demoting the last active admin inside a concurrency-safe transaction. Recheck active account/session state on authenticated requests.
- Keep passwords, hashes, session secrets, and operator credentials out of API responses and logs. Return deliberately shaped user objects.

**Exit check:** integration tests exercise real sessions and PostgreSQL, user denial on admin routes, disable/reset revocation, CSRF failure, and concurrent attempts to remove the final active admin. Verify the selected temporary-password policy.

## 4. Implement the complete domain API

**Result:** the complete v1 API can be exercised without a browser UI.

Implement in this order:

1. **Exercise catalog and review:** shared approved catalog, own submissions, submit, approve/reject, rename/archive, reviewer metadata, and stable IDs. Check permissions on referenced exercises as well as on endpoint access.
2. **Independent sets:** create/read/update/delete, authenticated ownership, decimal validation, RPE defaults, and editable performed times. Owner identity always comes from the session.
3. **Safe create retries:** generate one UUID per new submission on the client. Require the performed time and other material values to remain stable when retrying. Enforce uniqueness and atomic conflict handling in PostgreSQL; identical retries return the saved result, conflicting reuse returns a conflict, and cross-user reuse reveals no other user's data. Specify normalization so omitted defaults do not produce inconsistent comparisons.
4. **History and last values:** bounded lists, exercise filtering, deterministic ordering with an ID tie-breaker, and start-inclusive/end-exclusive timestamp intervals. Define a contract for fetching the latest set for an eligible selected exercise, using the existing list endpoint if sufficient.
5. **Private plans:** dated CRUD, notes, deterministic ordering/reordering, and the adopted exercise eligibility rules. Logging from a plan remains a UI prefill action, never automatic set creation.
6. **Settings:** implement the adopted timezone preference contract and validation. Add request examples for every area and keep OpenAPI synchronized.

Scope record queries and mutations by authenticated owner, including admin requests. Apply exercise eligibility checks within the transaction that writes the set/plan, coordinating with review/archive changes so races cannot bypass the rules.

**Exit check — API gate before frontend work:** demonstrate create, retrieve, edit, and delete of a persisted set; complete all endpoint examples; pass PostgreSQL integration tests covering the matrix below. Start frontend feature work only after this gate passes.

| Risk                 | Required evidence                                                                                                                                                                      |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ownership leaks      | Two users plus a admin attempt list/detail/edit/delete and referenced-ID access across users; sets and plans stay private.                                                             |
| Exercise lifecycle   | Own pending works, another user's pending is denied, approval shares only the exercise, rejection/archive preserves existing sets, and unavailable exercises cannot be newly selected. |
| Duplicate saves      | Repeated and concurrent identical create requests produce one row; conflicting payloads and cross-owner UUID collisions are handled safely.                                            |
| Numeric corruption   | Decimal weight round-trips exactly; excessive precision, overflow, invalid reps/set numbers, and fractional/out-of-range RPE fail. Omitted RPE becomes 5.                              |
| Date/time mistakes   | Offset timestamps retain their instant and milliseconds; day ranges handle DST boundaries; plan dates reject invalid dates and remain unchanged across timezone settings.              |
| Ordering and filters | History pagination has stable ties and correct bounds; latest values follow performed time; plan reorder is atomic and owner-scoped.                                                   |

## 5. Build the core phone logging workflow

**Result:** a user can log in, save independent sets, reload, and correct mistakes on a phone.

- Build login and authenticated navigation, then Today and the set form using custom React/SCSS components.
- Prefill fresh entries with set 1, RPE 5, and the current performed time. Use eligible exercise selections and show the last recorded values for the chosen exercise.
- Label weight in pounds and preserve decimal input as text through request creation. Use visible labels, suitable numeric keyboards, and accessible touch targets.
- Save only on explicit submission. Disable duplicate taps while pending, show saving/saved/failed states, and show the saved row after server confirmation.
- Preserve form values and the submission UUID/payload after a failed or uncertain create so an unchanged retry is safe. Define correction after an uncertain save: resolve/reconcile that original submission before assigning a new identity to edited values.
- Implement Copy as next set from a saved record: same exercise/reps/weight/RPE, incremented set number, new UUID, fresh performed time, and explicit save. Keep the source unchanged.
- Build History day navigation/exercise filters and edit/delete, including entering older sets. Calculate day bounds for the user's selected timezone, not as a fixed 24-hour duration.
- On connection/auth failures, retain unsaved values within the running UI and give a clear recovery action. Do not promise persistence across page reloads or add an offline queue.

**Exit check:** browser checks and the actual phone demonstrate save/reload, copy set 3 to set 4, multiple fresh set 1 entries, exact decimal display, backdated edit/delete, and a failed/uncertain save followed by a safe retry. Verify Save stays reachable with the phone keyboard open.

## 6. Complete plans and settings

**Result:** all four minimal product screens support the agreed v1 behavior.

- Add Plan with date selection, exercise/notes display such as `Barbell squats [3x10]`, create/edit/delete, and ordering.
- Display today's plans on Today. Log set from a plan preselects the exercise; it does not interpret notes or create a set until saved.
- Add own password/timezone controls and exercise submission/status. Handle rejected/archived references visibly using the adopted rules.
- Add admin account create/disable/reset controls and exercise approval/rejection/rename/archive controls. Do not provide history browsing for other users.
- Check loading, empty, validation, expired-session, and server-failure states across screens, with keyboard-accessible forms and controls.

**Exit check:** admin creates a family account → user logs in → submits an exercise → logs privately while pending → admin approves → another user sees the exercise but cannot see the first user's sets. Verify plan dates survive reload/timezone changes and all account controls enforce API rules.

## 7. Deploy privately and prove recovery

**Result:** family phones can use a durable installation on Ubuntu through Tailscale.

- Confirm the environment details before applying server configuration. Build production frontend/API artifacts; serve the frontend and `/api/v1` under one origin. SPA fallback must not hide missing API routes.
- Add production Docker Compose for the app and PostgreSQL, persistent database storage, health checks, restart policies, and explicit migration steps. Use separate application and database-operator credentials with appropriate privileges.
- Publish the app only on loopback and keep PostgreSQL internal. Configure the proposed host Tailscale Serve HTTPS entry point according to the existing setup and validate family device access.
- Document secrets, admin bootstrap/recovery, update procedure, and compatible rollback steps. Take a backup before schema changes; do not assume rolling back an app image reverses its database migration.
- Schedule database backups outside the live volume, define retention/access, and restore into a separate database to verify users, exercises, sets, and plans. Keep secrets and backups outside Git.
- Write an operations runbook covering service status, logs without secrets, readiness failures, backup restoration, and server restart.

**Exit check:** run the full account/login/log/reload flow over cellular data with Tailscale connected; confirm private port exposure, HTTPS/cookies, service/server restart persistence, and a tested restore with historical records. Passing local tests alone does not complete this milestone.

## 8. Use the app and close v1

**Result:** a real gym visit validates the central workflow.

- Log an actual visit on the intended phone, note extra taps and interruptions, and fix the largest logging problems.
- Review every PRD acceptance criterion and update `CHECKLIST.md` only with observed completion evidence.
- Keep unresolved environment/phone checks explicit until they are performed; do not mark deployment complete from configuration files alone.
- Revisit deferred features only after this workflow is reliable. Charts, timers, offline support, recurring routines, exports, and extra tracking modes are separate follow-up scope.

## Dependency and next-step summary

The critical sequence is **scaffold → contract/schema → auth/accounts → complete API and API gate → phone logging → plans/settings → deployment/recovery → real use**.

Server inventory and phone/browser identification can be gathered during earlier milestones without blocking independent API work. Do not introduce calendar estimates until the tooling and environment are verified; use the exit checks above to measure progress.

The first implementation task is milestone 1: verify the chosen checkout, select/pin the development tooling, scaffold the workspace/API/database, and document a repeatable startup. It does not include frontend features or production deployment.

## Milestone 2 delivery — October 21, 2026

The API contract, shared schemas, examples, and domain migration are implemented. See `API-RULES.md` for the adopted exercise lifecycle, account-format, timezone, precision, retry and reorder choices; `API-EXAMPLES.md` and generated `openapi.yaml` contain the REST examples. Exercise naming is admin-only, as confirmed during this milestone. The proposal table above is historical planning context where these decisions now supersede it.

Contract generation/validation, runtime boundary tests, real empty-database migrations, SQL constraint tests, migration reruns/failure rollback, and repeatable development fixtures are verified before delivery. Feature endpoints and their authorization/concurrency tests remain milestones 3–4. Session lifetime and temporary-password behavior are settled in milestone 3 below. No frontend feature work is included.

## Milestone 3 delivery — October 21, 2026

Authentication/account administration is implemented and verified against real PostgreSQL. User chose a fixed 30-day session lifetime and mandatory immediate password changes for initial/bootstrap/reset accounts. The application has exactly two roles and one family instance, without tenancy. `AUTH.md` documents the implemented flows, first-admin CLI, rate limits, revocation, cookie/CSRF and proxy configuration. `mustChangePassword` is a forward schema/contract change; applied migrations were preserved.

The next build milestone is the complete exercise/set/plan domain API and its ownership/concurrency gate. Browser forms and deployment remain later work. No real family admin was bootstrapped without a supplied secret.
