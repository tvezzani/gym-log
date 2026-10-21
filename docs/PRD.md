# Gym Log — draft PRD

Updated: October 21, 2026. This is a discussion draft, not a finalized implementation specification.

## Goal

Log a lifting set quickly from a phone, see what was just completed, and view upcoming exercises. Host the app and database on a personal Ubuntu server, with access through Tailscale. Support separate logins for family members.

## Confirmed requirements

- A workout record represents one independent set. There is no workout-session entity in v1.
- Each record has an exercise, time performed with millisecond precision, reps, weight, set number, RPE, and owning user.
- RPE is between 1 and 10 and defaults to 5.
- Exercise definitions have an ID and name.
- Planned exercises reference exercise definitions and include a date/time and free-text notes, displayed as `Barbell squats [3x10]`.
- Username/password login and a superadmin for user control.
- Online only in v1; Ubuntu hosting; phone access through Tailscale.
- Local Git version control. TypeScript/React/Vite/Express/PostgreSQL/SCSS are the preferred stack, subject to final choices.

## Proposed first release

1. Log in and land on today's recorded sets, with a prominent Log set action.
2. Choose an exercise; enter reps and weight; review/edit the suggested set number and RPE; save.
3. After the server confirms, show the saved row and prepare the next entry with the same exercise, reps, and weight. RPE starts at 5 for each new entry.
4. Keep the form intact on failure and make the save state obvious. Refreshing shows persisted sets.
5. Edit or delete an incorrectly entered set. Allow entering a set performed earlier.
6. View history by day and filter by exercise. Show the last recorded values for the selected exercise.
7. Create, order, edit, and delete planned exercise entries. Logging from a plan preselects its exercise; notes remain free text.
8. Superadmin creates/disables accounts and resets passwords. Users can change their own passwords.

Proposed defaults pending answers: records and plans are private to their owner; one shared exercise catalog; members may add exercises; only superadmin may rename/archive catalog entries. No public signup. Superadmin controls accounts, without a workout-browsing feature for other users.

## Minimal screens

- **Today:** dated set list, next-set entry form, today's planned exercises.
- **History:** day navigation, exercise filter, edit/delete actions.
- **Plan:** dated exercise list with notes and ordering.
- **Settings:** password and unit/timezone preferences; superadmin account controls.

Use large touch targets, numeric keyboards, visible labels, and a clear saved/saving/failed state. Keep the phone keyboard from hiding Save. No dashboards or charts are needed to log a set.

## Data model

Names below use API camelCase; SQL may use snake_case. IDs are UUIDs. Every foreign key is enforced by the database.

| Entity | Fields |
| --- | --- |
| User | `id`, `username`, `passwordHash`, `role` (`member` / `superadmin`), `isActive`, `preferredWeightUnit`, `timeZone`, `createdAt` |
| Exercise | `id`, `name`, `archivedAt`, `createdAt` |
| Workout | `id`, `exerciseId`, `performedAt`, `reps`, `weight`, `weightUnit`, `setNumber`, `rpe`, `userId`, `createdAt`, `updatedAt` |
| PlannedExercise | `id`, `exerciseId`, `userId`, `scheduledAt`, `notes`, `sortOrder`, `createdAt`, `updatedAt` |
| AuthSession | Session identifier/secret representation, `userId`, expiry; stored server-side in PostgreSQL |

Important rules:

- `performedAt` is when the set happened; `createdAt` is when the server stored it. Default performed time to now but allow editing. Use `timestamptz(3)` and ISO 8601 timestamps with an offset or `Z`; render in the chosen user timezone. Milliseconds are precision, not a unique identifier. [PostgreSQL date/time documentation](https://www.postgresql.org/docs/current/datatype-datetime.html).
- Use `numeric(8,3)` for weight, rather than an inexact float; reject excess decimal places at the API. Proposed API representation: a decimal string such as `"135.5"`. Preserve the recorded unit on each set even if a preference later changes. Unit choice and dumbbell/bodyweight conventions are open. [PostgreSQL numeric documentation](https://www.postgresql.org/docs/current/datatype-numeric.html).
- `reps` and `setNumber` are positive integers; `weight` is nonnegative. Zero-rep attempts and assisted/negative weight are not included unless requested.
- Proposed `rpe`: integer 1–10, database/API default 5. Ask whether half points are needed. A defaulted 5 is not proof that effort was explicitly rated.
- Set numbering is a UI aid, not an identity or unique key. Reset behavior is open. The same exercise can have multiple set 1 records in a day. Editing/deleting a record does not silently renumber others.
- `userId` comes from the authenticated session, never from a client-selected owner. Apply ownership checks to every record operation, including referenced resources.
- Archive exercises in use rather than deleting referenced definitions. Archived names remain visible in history and are excluded from new selections.
- A planned entry produces no completed sets automatically. Do not parse `3x10` into structured targets in v1. Exact scheduling versus a calendar date is still open.
- Index workout history by `(userId, performedAt)` and `(userId, exerciseId, performedAt)`; plans by `(userId, scheduledAt, sortOrder)`.

## REST outline

Base path: `/api/v1`. The API is developed and documented before the UI.

| Area | Endpoints |
| --- | --- |
| Authentication | `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `PATCH /auth/password` |
| Exercises | `GET /exercises`, `POST /exercises`, `PATCH /exercises/:id` (rename/archive, role checked) |
| Sets | `GET /workouts`, `POST /workouts`, `GET /workouts/:id`, `PATCH /workouts/:id`, `DELETE /workouts/:id` |
| Plans | `GET /planned-exercises`, `POST /planned-exercises`, `PATCH /planned-exercises/:id`, `DELETE /planned-exercises/:id` |
| Account administration | `GET /admin/users`, `POST /admin/users`, `PATCH /admin/users/:id`, `POST /admin/users/:id/reset-password` |
| Operations | `GET /health` (minimal public status), internal readiness check including the database |

List endpoints support bounded pagination and time/exercise filters. Filter timestamps use a start-inclusive/end-exclusive interval calculated for the user's selected day. Validate input at runtime and return consistent field errors. Document request/response schemas in OpenAPI.

Prevent accidental duplicate saves: generate a set UUID once per submission; safely retry the identical create request with the same ID, and reject conflicting reuse. Disable Save while pending. This is request retry protection, not offline synchronization.

## Login and administration

Store salted password hashes using a maintained Argon2id library. Never store or return raw passwords. Use opaque server-side sessions in PostgreSQL with HttpOnly, Secure, SameSite cookies, appropriate expiry, session rotation on login, CSRF protection for mutations, and login rate limiting. Configure proxy trust only for the deployment topology. [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [Express production guidance](https://expressjs.com/en/advanced/best-practice-security/).

Bootstrap the first superadmin through a server command, with no committed/default password. Block disabling or demoting the last active superadmin. Account disable and password reset revoke existing sessions. Propose admin-assisted password recovery without email infrastructure; decide whether temporary passwords must be changed at next login.

## Architecture and hosting

Proposed architecture: phone browser → Tailscale HTTPS → Express serving both the built React frontend and `/api/v1` → PostgreSQL.

Use one repository with npm workspaces. Keep server code and secrets out of the frontend/shared contract package. Custom React components use SCSS. Vite is a build/development tool; production serves its compiled files, with an SPA fallback that does not mask API errors. [Vite deployment guidance](https://vite.dev/guide/static-deploy.html).

Recommend standard PostgreSQL for the shared server and development, avoiding differences between database engines. PGlite remains a possible deliberate simplification, but its single-connection model and multiplexing caveats require evaluation. [PGlite connection documentation](https://pglite.dev/docs/pglite-socket).

Recommend Tailscale Serve to provide private HTTPS to the local app, subject to existing server setup. Bind the app to loopback, or publish its container port only to loopback; keep PostgreSQL on an internal network. Family phones need permitted Tailscale access as well as app accounts. [Tailscale Serve](https://tailscale.com/docs/reference/tailscale-cli/serve).

Choose Docker Compose versus native systemd after checking server preferences. Persist database data, run migrations explicitly, restart the service on failure, schedule backups outside the database volume, and verify a restore before relying on the app. Keep deployment and rollback instructions in the repository.

## Acceptance criteria

- On a phone, a user logs a set, reloads, and sees matching reps, decimal weight/unit, set number, RPE, and performed time.
- A user records the same exercise twice in one day, including manually resetting to set 1, without data loss or an invented session requirement.
- RPE omitted on create becomes 5; out-of-range RPE and invalid numbers are rejected by both API and database constraints.
- A timed-out create can be retried without creating an additional set.
- A second user cannot read, change, or delete another user's records/plans, including by guessing IDs. Members cannot use admin endpoints.
- A plan displays `Barbell squats [3x10]` and stays distinct from recorded sets.
- Disabling an account invalidates its active sessions; the last superadmin remains recoverable.
- The app works over phone cellular data with Tailscale connected, survives a server restart, and restores historical records from a tested backup.

## Deferred scope

Offline storage/sync, native mobile apps, recurring programs, automatic parsing of plan notes, social feeds, wearables, rest timers, progress charts, and email recovery. These can be reconsidered after the basic logging flow is used at the gym.
