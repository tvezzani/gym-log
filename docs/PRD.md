# Gym Log — draft PRD

Updated: October 21, 2026. This is a discussion draft, not a finalized implementation specification.

## Goal

Log a lifting set quickly from a phone, see what was just completed, and view upcoming exercises. Host the app and database on a personal Ubuntu server, with access through Tailscale. Support separate logins for family users.

## Confirmed requirements

- A workout record represents one independent set. There is no workout-session entity in v1.
- Each record has an exercise, time performed with millisecond precision, reps, weight, set number, RPE, and owning user.
- Fresh entries start at set 1. A UI copy action copies a selected set and increments its set number; there is no automatic per-day numbering.
- Weight is recorded in pounds only. Bodyweight tracking is outside v1.
- Dumbbell weight follows the user's own convention; the app does not interpret or convert between per-dumbbell and combined-pair values.
- RPE uses whole numbers between 1 and 10 and defaults to 5.
- Exercise definitions have an ID and name. The family shares one catalog; new exercises require admin approval.
- An exercise's submitter may log sets privately while it is pending approval. Other users cannot select that pending exercise.
- Planned exercises reference exercise definitions and include a calendar date and free-text notes, displayed as `Barbell squats [3x10]`. No exact scheduled time is needed.
- Plans are private dated lists, with no recurring routines in v1.
- Username/password login and a admin for user control.
- Admin creates accounts and assists with password resets; no public signup or email recovery in v1.
- Workout history is private in the app, including for admin. The server/database owner retains direct database access to all records outside the app.
- Online only in v1; Ubuntu hosting; phone access through Tailscale.
- Deploy the application and database with Docker Compose.
- Local Git version control. TypeScript/React/Vite/Express/PostgreSQL/SCSS are the preferred stack, subject to final choices.

## Proposed first release

1. Log in and land on today's recorded sets, with a prominent Log set action.
2. Choose an exercise; enter reps and weight in pounds; review/edit set number (initially 1) and RPE (initially 5); save.
3. After the server confirms, show the saved row. A Copy as next set action opens a new unsaved entry with the same exercise, reps, weight, and RPE, and `setNumber + 1`. Give the copy a new ID and a fresh performed time. Save it explicitly; keep the source record unchanged.
4. Keep the form intact on failure and make the save state obvious. Refreshing shows persisted sets.
5. Edit or delete an incorrectly entered set. Allow entering a set performed earlier.
6. View history by day and filter by exercise. Show the last recorded values for the selected exercise.
7. Create, order, edit, and delete planned exercise entries. Logging from a plan preselects its exercise; notes remain free text.
8. Admin creates/disables accounts and resets passwords. Users can change their own passwords.
9. Users submit exercise names and may immediately log sets against their own pending exercises. Admin reviews pending submissions and approves or rejects them; approved names join the shared catalog. Approval changes catalog visibility, while existing sets remain private.

Confirmed access rules: records and plans are private to their owner through the app/API. The admin role manages accounts and exercise approvals; it does not bypass record ownership checks. Direct database administration uses separate operator credentials and may access every user's records. Do not give those credentials to the browser or use them as application login credentials.

Confirmed catalog management rule: only admin may rename/archive catalog entries. A submitter may log against their pending exercise privately; approval is required before it becomes selectable by other family users. Confirmed rejection behavior: preserve existing sets and their exercise reference, show the rejected status to the submitter, and exclude the rejected exercise from new entries. Rejection must not delete previously logged sets.

## Minimal screens

- **Today:** dated set list, next-set entry form, today's planned exercises.
- **History:** day navigation, exercise filter, edit/delete actions.
- **Plan:** dated exercise list with notes and ordering.
- **Settings:** password and timezone preferences; exercise submission status; admin account controls and exercise approval queue.

Use large touch targets, numeric keyboards, visible labels, and a clear saved/saving/failed state. Keep the phone keyboard from hiding Save. No dashboards or charts are needed to log a set.

## Data model

Names below use API camelCase; SQL may use snake_case. IDs are UUIDs. Every foreign key is enforced by the database.

| Entity          | Fields                                                                                                                             |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| User            | `id`, `username`, `passwordHash`, `role` (`user` / `admin`), `isActive`, `timeZone`, `createdAt`, `updatedAt`                      |
| Exercise        | `id`, `name`, `status` (`pending` / `approved` / `rejected`), `submittedBy`, `reviewedBy`, `reviewedAt`, `archivedAt`, `createdAt` |
| Workout         | `id`, `exerciseId`, `performedAt`, `reps`, `weight` (lbs), `setNumber`, `rpe`, `userId`, `createdAt`, `updatedAt`                  |
| PlannedExercise | `id`, `exerciseId`, `userId`, `plannedDate`, `notes`, `sortOrder`, `createdAt`, `updatedAt`                                        |
| AuthSession     | Session identifier/secret representation, `userId`, expiry; stored server-side in PostgreSQL                                       |

Important rules:

- `performedAt` is when the set happened; `createdAt` is when the server stored it. Default performed time to now but allow editing. Use `timestamptz(3)` and ISO 8601 timestamps with an offset or `Z`; render in the chosen user timezone. Milliseconds are precision, not a unique identifier. [PostgreSQL date/time documentation](https://www.postgresql.org/docs/current/datatype-datetime.html).
- Use `numeric(8,3)` for weight, rather than an inexact float; reject excess decimal places at the API. API representation: a decimal string such as `"135.5"`. All weights are pounds; label UI inputs and document this in the API. There is no unit selector or bodyweight field. Preserve dumbbell weights exactly as entered, without interpreting them as individual or combined values. [PostgreSQL numeric documentation](https://www.postgresql.org/docs/current/datatype-numeric.html).
- `reps` and `setNumber` are positive integers; `weight` is nonnegative. Zero-rep attempts and assisted/negative weight are not included unless requested.
- `rpe`: integer 1–10, database/API default 5. Reject fractional values. A defaulted 5 is not proof that effort was explicitly rated.
- Set numbering is a UI aid, not an identity or unique key. Fresh entries default to 1; copying a selected record defaults to its set number plus 1, independently of calendar days or other records. The same exercise can have multiple set 1 records in a day. Editing/deleting a record does not silently renumber others.
- `userId` comes from the authenticated session, never from a client-selected owner. Apply ownership checks to every record operation, including referenced resources.
- Only admins may permanently delete unused exercises, and only if neither workouts nor planned entries reference them. Archive exercises in use rather than deleting referenced definitions. Archived names remain visible in history and are excluded from new selections.
- Exercise submissions start pending. Approval/rejection is admin-only and records the reviewer and time. Users see approved catalog entries plus their own submissions; admin may inspect the full approval queue. New sets may reference an approved, unarchived exercise or an unarchived pending exercise submitted by the authenticated user. Knowing another user's pending exercise ID does not permit logging against it. Pending/rejected submissions never appear in other users' exercise selections.
- Approval keeps the exercise ID stable, so existing private sets need no migration. Rejection or archival must preserve existing history and foreign-key references.
- Store `plannedDate` as SQL `date`, with an API string in `YYYY-MM-DD` format. Validate a real calendar date and keep it as a date in the frontend; do not convert it through UTC midnight. Traveling or changing a timezone must not shift the intended plan date.
- A planned entry produces no completed sets automatically. Do not parse `3x10` into structured targets in v1.
- Index workout history by `(userId, performedAt)` and `(userId, exerciseId, performedAt)`; plans by `(userId, plannedDate, sortOrder)`.

## REST outline

Base path: `/api/v1`. The API is developed and documented before the UI.

| Area                   | Endpoints                                                                                                                                                                                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Authentication         | `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `PATCH /auth/password`                                                                                                                                                                                                      |
| Exercises              | `GET /exercises` (approved shared catalog), `POST /exercises` (submit pending name), `GET /exercise-submissions` (own submissions; include own pending exercises in the logging picker), `PATCH /exercises/:id` (admin rename/archive), `DELETE /exercises/:id` (admin, unused only) |
| Exercise approval      | `GET /admin/exercises?status=pending`, `POST /admin/exercises/:id/approve`, `POST /admin/exercises/:id/reject`                                                                                                                                                                       |
| Sets                   | `GET /workouts`, `POST /workouts`, `GET /workouts/:id`, `PATCH /workouts/:id`, `DELETE /workouts/:id`                                                                                                                                                                                |
| Plans                  | `GET /planned-exercises`, `POST /planned-exercises`, `PATCH /planned-exercises/:id`, `DELETE /planned-exercises/:id`                                                                                                                                                                 |
| Account administration | `GET /admin/users`, `POST /admin/users`, `PATCH /admin/users/:id`, `POST /admin/users/:id/reset-password`                                                                                                                                                                            |
| Operations             | `GET /health` (minimal public status), internal readiness check including the database                                                                                                                                                                                               |

List endpoints support bounded pagination and exercise filters. Workout history accepts timestamp ranges using a start-inclusive/end-exclusive interval calculated for the user's selected day. Plans accept calendar-date filters matching `plannedDate`, without timezone conversion. Validate input at runtime and return consistent field errors. Document request/response schemas in OpenAPI.

Prevent accidental duplicate saves: generate a set UUID once per submission; safely retry the identical create request with the same ID, and reject conflicting reuse. Disable Save while pending. This is request retry protection, not offline synchronization.

## Login and administration

Store salted password hashes using a maintained Argon2id library. Never store or return raw passwords. Use opaque server-side sessions in PostgreSQL with HttpOnly, Secure, SameSite cookies, appropriate expiry, session rotation on login, CSRF protection for mutations, and login rate limiting. Configure proxy trust only for the deployment topology. [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [Express production guidance](https://expressjs.com/en/advanced/best-practice-security/).

Bootstrap the first admin through a server command, with no committed/default password. Block disabling or demoting the last active admin. Account disable and password reset revoke existing sessions. Password recovery is admin-assisted without email infrastructure; temporary/bootstrap passwords must be changed immediately, using a restricted session until completed. Sessions last exactly 30 days without sliding renewal.

## Architecture and hosting

Proposed architecture: phone browser → Tailscale HTTPS → Express serving both the built React frontend and `/api/v1` → PostgreSQL.

Use one repository with npm workspaces. Keep server code and secrets out of the frontend/shared contract package. Custom React components use SCSS. Vite is a build/development tool; production serves its compiled files, with an SPA fallback that does not mask API errors. [Vite deployment guidance](https://vite.dev/guide/static-deploy.html).

Recommend standard PostgreSQL for the shared server and development, avoiding differences between database engines. PGlite remains a possible deliberate simplification, but its single-connection model and multiplexing caveats require evaluation. [PGlite connection documentation](https://pglite.dev/docs/pglite-socket).

Recommend Tailscale Serve to provide private HTTPS to the local app, subject to existing server setup. Bind the app to loopback, or publish its container port only to loopback; keep PostgreSQL on an internal network. Family phones need permitted Tailscale access as well as app accounts. [Tailscale Serve](https://tailscale.com/docs/reference/tailscale-cli/serve).

Use Docker Compose for the app and PostgreSQL on Ubuntu, with Tailscale on the host as the proposed HTTPS entry point. Persist database data, run migrations explicitly, restart the service on failure, schedule backups outside the database volume, and verify a restore before relying on the app. Keep deployment and rollback instructions in the repository. Keep database operator access separate from the application's database credentials.

## Acceptance criteria

- On a phone, a user logs a set, reloads, and sees matching reps, decimal weight in pounds, set number, RPE, and performed time.
- A fresh entry defaults to set 1. Copying a saved set 3 prefills a new set 4 with matching exercise, reps, weight, and RPE; it has a new ID/time, is saved separately, and leaves the source unchanged.
- A user creates multiple fresh entries for the same exercise in one day, each starting at set 1, without data loss or a session requirement.
- RPE omitted on create becomes 5; fractional/out-of-range RPE and invalid numbers are rejected by both API and database constraints.
- A timed-out create can be retried without creating an additional set.
- A second user cannot read, change, or delete another user's records/plans, including by guessing IDs. Admin app/API requests obey the same ownership rules. Users cannot use admin endpoints; separate database operator access remains available outside the app.
- A user's new exercise remains outside the shared catalog until admin approves it; rejection keeps it out. Users cannot approve their own submissions or inspect others' pending submissions.
- The submitter can record and retrieve sets against their pending exercise. A different user cannot use that pending exercise ID. After approval, the exercise becomes shared but its previously logged sets remain private; rejection preserves existing sets.
- A plan displays `Barbell squats [3x10]` and stays distinct from recorded sets.
- A plan saved for `2026-10-21` remains on that date after reload or a timezone change; it has no scheduled time input.
- Disabling an account invalidates its active sessions; the last admin remains recoverable.
- The app works over phone cellular data with Tailscale connected, survives a server restart, and restores historical records from a tested backup.

## Deferred scope

Offline storage/sync, native mobile apps, recurring programs, bodyweight tracking, kilogram support, automatic parsing of plan notes, social feeds, wearables, rest timers, progress charts, and email recovery. These can be reconsidered after the basic logging flow is used at the gym.

## Milestone 2 contract decisions

The generated `openapi.yaml`, `API-RULES.md`, and `API-EXAMPLES.md` now define the persistence/REST details. Admin-only rename/archive is confirmed. New plans follow set exercise eligibility; rejected/archived references remain readable and may be retained during edits, but are unavailable for new selection. Renaming reflects the current name through the same exercise ID, including history.

Add `GET /auth/csrf`, `PATCH /preferences`, and atomic `PUT /planned-exercises/order` to the REST outline above. Usernames are canonical lowercase ASCII, 3–32 characters; new/reset passwords are 12–128 characters. Initial user timezone is explicitly supplied and never changes automatically while traveling. Weights are decimal strings; performed instants require an offset/Z and exactly three fractional digits. Pagination uses bounded limit/offset with deterministic ID tie-breakers.

The SQL schema additionally retains immutable workout-create identities (UUID, owner, normalized request hash, server creation time) independently of sets. This supports safe retries after edits/deletion; deleted set values are not retained in that ledger. Identical retries return the current row, or 410 if deleted. Different payload/owner reuse returns generic 409. See API-RULES.md for transactional handling.

These are contract/schema decisions, not completed endpoint implementation. Authentication/session lifetime and forced-change policy are implemented in milestone 3; ownership and concurrency API evidence remains the milestone 4 gate.

## Milestone 3 authentication delivery

Only two application roles exist: user and admin, in a single family instance with no tenancy layer. Authentication/account endpoints and own timezone preferences are implemented. User responses now include `mustChangePassword`; new/bootstrap/reset accounts are restricted until changing to a different password. Session lifetime is 30 absolute days. See `AUTH.md` for CLI bootstrap, cookie/CSRF/proxy configuration, rate limiting, revocation and verification. Exercise/set/plan endpoints are now implemented in milestone 4; browser forms remain later work.

## Milestone 4 domain API delivery

The complete v1 API is implemented and verified before frontend work. `API-GATE.md` records real PostgreSQL evidence for private set/plan ownership (including admin requests), exercise approval/lifecycle, safe create retries and post-edit/delete replay, decimal and timestamp fidelity, calendar dates/DST, stable history and atomic plan ordering/concurrency. Browser forms, failed-save UX, actual phone checks and private deployment remain their planned milestones.

## First-run setup decision — October 22, 2026

The user chose a browser-based initial setup flow: on an unconfigured installation's first visit, choose the first admin's username/password and initial timezone. There are no standard/default credentials. This first password is chosen by its owner and is immediately usable; passwords assigned by an admin or CLI and password resets still require a change. Initial setup closes permanently after completion. All later account creation/recovery remains admin-managed; the application has no ongoing public signup.
