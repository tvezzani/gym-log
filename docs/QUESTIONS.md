# Questions and decisions

## Confirmed

| Topic             | Decision                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------- |
| Workout meaning   | Each record is an independent set; no session entity in v1                                        |
| Connectivity      | Online only in v1                                                                                 |
| Hosting           | Separate Ubuntu server                                                                            |
| Phone access      | Tailscale                                                                                         |
| RPE default/range | Whole numbers only; default 5; range 1–10                                                         |
| Planning notes    | Free text displayed after the exercise name                                                       |
| Version control   | Local Git                                                                                         |
| Set numbering     | Fresh entry defaults to 1; copy a selected record and increment its number                        |
| Weight            | Pounds only; bodyweight tracking outside v1                                                       |
| Plans             | Private dated lists; no recurring routines in v1                                                  |
| Exercise catalog  | Shared; new exercises require superadmin approval                                                 |
| History privacy   | Private through app/API, including superadmin; database owner retains direct access to everything |
| Deployment        | Docker Compose on Ubuntu                                                                          |
| Accounts/recovery | Admin-created accounts and admin-assisted password reset; no signup/email features                |
| Pending exercises | Submitter can log privately while pending; shared selection requires approval                     |
| Dumbbells         | User's convention; preserve entered pounds without interpreting individual versus combined weight |
| Plan scheduling   | Calendar date only; SQL `date` / API `YYYY-MM-DD`; no scheduled time                              |

## Remaining implementation details

The API/schema details are settled below. The remaining decisions belong to later milestones:

1. **Login:** absolute session lifetime and whether temporary/bootstrap passwords require an immediate change (before milestone 3).
2. **Phone verification:** actual family phone/browser for keyboard and layout checks.
3. **Production server:** RAM/storage, services/ports, Tailscale access, backup destination and retention.

Positive-rep strength sets and plain dated plans remain the v1 scope. Failed attempts, warmup markers, timed holds, cardio and done/skipped markers are deferred features.

## Scaffolding decisions — October 21, 2026

- Active checkout: `/home/tvezzani/dev/gym-log` in Ubuntu WSL, using Linux Node/npm.
- Node 24.22.1 LTS; npm workspaces; exact package versions and npm lockfile. Express 5, TypeScript, `pg` for parameterized SQL, Zod for browser-safe runtime contracts, and node-pg-migrate with versioned SQL files.
- Development uses native Docker Engine and the Compose CLI in Ubuntu, with Docker commands behind sudo. Docker Desktop is not used and docker-group access was not granted.
- PostgreSQL 17 image pinned by digest; loopback-only port 5433, persistent named volume, distinct runtime and operator roles. Production configuration remains a later milestone.
- Health endpoint reports minimal liveness; database readiness is an operator command, checked at API startup as well. The web workspace remains reserved until the API gate passes.

Scaffolding choices above are adopted; the milestone 2 decisions below settle the catalog, time and contract details.

## Milestone 2 decisions — October 21, 2026

- User confirmed admin-only exercise rename to keep the model simple. There are no private aliases or member rename proposals.
- Preserve old sets/plans when an exercise is rejected/archived; allow edits retaining the existing reference and block new selections. New plans use the same eligibility as sets. No rejection-reason field.
- Adopt explicit stored timezone grouping and an own-preferences endpoint; initial timezone is required on account creation. Plan dates never shift.
- Adopt canonical lowercase ASCII usernames (3–32), password bounds (12–128 for new/reset passwords), bounded pagination and atomic full-date plan reorder as documented in `API-RULES.md`.
- Use exactly millisecond ISO timestamps, decimal-string weights, strict request schemas and server metadata. Persist immutable create-request owner/hash identities to protect retries after edit/delete.
- Schema and generated REST examples are recorded in `openapi.yaml`, `API-EXAMPLES.md` and SQL migrations. Session lifetime and forced temporary-password changes are still undecided for milestone 3. Phone and production-server questions remain open.

This section settles the earlier exercise/time/account-format proposals; it does not settle authentication lifetime or deployment details.
