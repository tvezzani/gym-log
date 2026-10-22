# Gym Log

A minimalist, self-hosted gym log for a family. Working title; the API, phone logging, plans/settings and admin frontend are implemented.

Each workout record is one independent set. Version 1 requires a connection to the Ubuntu server through Tailscale.

Confirmed scope: pounds only, whole-number RPE, private dated plans, shared exercise names with admin approval, and admin-managed accounts. Workout history is private through the app; the database owner retains direct database access. Deployment uses Docker Compose.

Users can log privately against their own pending exercise submissions. Plans use calendar dates without scheduled times. Dumbbell weights follow each user's convention.

- [Product requirements](docs/PRD.md)
- [Build checklist](docs/CHECKLIST.md)
- [Questions and decisions](docs/QUESTIONS.md)
- [Implementation plan](docs/PLAN.md)

## Stack

TypeScript, React + Vite, custom components with SCSS, Node + Express, PostgreSQL, and REST. Use npm workspaces for one repository. Database access and credentials stay in the API.

Workspace layout:

```text
apps/
  api/                 Express API; serves the built frontend in production
  web/                 React + Vite + SCSS
packages/
  contracts/           Request/response types and runtime validation
db/
  migrations/          Versioned SQL migrations
docs/                  PRD, checklist, decisions
infra/                 Deployment configuration and backup instructions
```

The API foundation is runnable. The milestone 2 API contract and domain migrations are in place. Authentication, account administration and own preferences are implemented. Exercise/set/plan endpoints are implemented in milestone 4; the core phone frontend is implemented in milestone 5, with plans/settings and admin screens in milestone 6. Node 24.22.1 LTS, TypeScript, Express 5, `pg`, Zod, and node-pg-migrate are pinned through package manifests and `package-lock.json`. PostgreSQL 17 uses an immutable image digest in the development Compose file.

## Development in Ubuntu WSL

The active development checkout is `/home/tvezzani/dev/gym-log`. Use Ubuntu terminals and Linux tools there. The original Windows folder is an older copy; do not edit both checkouts. Git history and existing plan changes were verified before scaffolding.

Linux Node 24.22.1 was installed under `~/.local/lib` with executables linked from `~/.local/bin`. The archive checksum was checked against Node's published SHA-256 sums. For a fresh machine, install the release in `.nvmrc` using your Node version manager.

Native Docker Engine and the Compose plugin run inside Ubuntu, installed using [Docker's official Ubuntu repository](https://docs.docker.com/engine/install/ubuntu/). Docker Desktop is not required. The Docker service is enabled under systemd; Docker commands use `sudo`. The user was not added to the docker group.

From an Ubuntu terminal:

```bash
cd ~/dev/gym-log
export PATH="$HOME/.local/bin:$PATH"
node --version # v24.22.1
npm ci
npm run setup:env
npm run db:up
npm run db:migrate
npm run db:check
npm run check
npm run test:db
npm run dev
```

`setup:env` creates a mode-600 `.env` with random local passwords and preserves an existing file. `.env.example` documents the fields. Keep `.env`, backups, and database storage out of Git. This is development configuration, not production credentials or deployment configuration.

The API binds to `127.0.0.1:3000`. Check it from another Ubuntu terminal:

```bash
curl --fail http://127.0.0.1:3000/api/v1/health
# {"status":"ok"}
```

`npm run dev` watches API source; restart it after editing contracts (the contracts package is compiled at startup). For the phone frontend, run `npm run dev:api` and `npm run dev:web` in separate terminals, then open `http://127.0.0.1:5173`. This API command sets the exact browser origin for CSRF validation; use it instead of the API-only `dev` command when running Vite. See `apps/web/README.md`. `npm run build && npm start` checks the compiled API. The API checks its database connection before listening. Public health reports process liveness only; `npm run db:check` is the internal database readiness check. API errors use a JSON `error.code` and `error.message` without exception details.

PostgreSQL binds only to `127.0.0.1:5433` and stores data in the `gym-log-dev_postgres-data` Docker volume. The runtime role `gym_app` has data access in the `app` schema without schema creation or migration access. The local operator role `gym_operator` owns migrations and initializes roles. Do not run the API using the operator URL. No default application account is created.

```bash
npm run db:logs
npm run db:stop # preserves data
sudo systemctl status docker
sudo systemctl start docker # if necessary
```

The role initialization script runs only for an empty volume. Editing passwords in `.env` does not rotate existing PostgreSQL passwords; change them explicitly through the operator connection and update the matching URL. If port 5433 is occupied, change `DB_PORT` and both database URLs together. Never delete a volume to troubleshoot without checking its contents and backups first.

Migration authoring, transactional failure behavior, and recovery guidance are in `db/README.md`. Domain tables are defined by the milestone 2 migration. `npm run check` runs the build, type checks, lint, formatting checks, and API smoke tests. PostgreSQL startup, migrations, readiness, and role permissions also require the real database checks; the smoke tests alone do not prove those.

Before moving to another checkout, commit or otherwise preserve all work, keeping credentials and data outside Git.

## Scaffold verification — October 21, 2026

Verified a fresh `npm ci`, build, type checks, lint, formatting checks, and two API smoke tests. The real PostgreSQL integration check passed: the runtime role cannot create tables or read migration records, and an operator-created table permits runtime data access with an exact decimal round-trip. The temporary probe table was removed.

The baseline migration applied successfully and a second run reported no pending migrations. Both `npm start` and `npm run dev` served the expected health JSON. PostgreSQL was healthy and bound only to loopback port 5433. Test API processes were stopped; PostgreSQL was left running. Domain features and production deployment remain future milestones.

## API contract and schema

- `docs/openapi.yaml`: generated OpenAPI 3.1 contract with all v1 endpoint examples.
- `docs/API-RULES.md`: validation, exercise eligibility, ownership, retry and transaction rules.
- `docs/API-EXAMPLES.md`: request/read/edit flows; all documented v1 API endpoints are implemented.
- `packages/contracts`: browser-safe runtime schemas and inferred types.
- `db/README.md`: migration, local fixture, isolated database-test and recovery commands.

Run `npm run docs:generate` after changing contracts, and `npm run check` to detect stale or invalid OpenAPI as well as source issues. Run `npm run test:db` for real schema/permission evidence. Optional local sample data: `npm run db:fixtures -- --confirm-local-fixtures`; accounts stay disabled and have no usable passwords. The complete API is implemented; the core phone frontend now uses these endpoints.

## Authentication and roles

See `docs/AUTH.md` for first-run browser setup, optional CLI recovery and the API workflow. Exactly two application roles exist: user and admin. This is one family instance without tenancy.

Sessions last 30 days, without sliding renewal. New/bootstrap/reset accounts must immediately change their password; `mustChangePassword` exposes the restricted state. Auth/account endpoints include Argon2id hashing, PostgreSQL sessions, CSRF and exact-origin checks, role guards, revocation, rate limits and concurrency-safe last-admin protection. There are no default credentials. On first visit, an unconfigured installation shows a browser form to create the first admin; subsequent visits show login. Browser login/password-change forms are implemented.

Configuration now requires a random `AUTH_SECRET` and exact `APP_ORIGIN`; `.env.example` documents them. New `.env` files receive a random secret through setup. Existing files are preserved and must be deliberately extended if missing fields. Docker/API startup commands remain above; production requires HTTPS and explicitly verified proxy configuration. `npm run auth:cleanup` removes expired auth rows. No family account was created automatically during implementation.

## Domain API gate

Exercises, sets/history and private dated plans are implemented. `docs/API-GATE.md` records the passed milestone 4 API gate and its limits; run `npm run test:domain` for the focused real PostgreSQL scenarios, or `npm run test:db` for the full database/API suite. The tests create and remove disposable databases, leaving development history alone.

The core phone logging frontend is implemented. `docs/FRONTEND-GATE.md` records browser verification, safe draft/retry recovery and the remaining actual-device check. `docs/MANAGEMENT-GATE.md` records the plans/settings and admin workflow checks. The next implementation milestone is private deployment, backups and tested recovery. No real family login was created automatically.

## First-run admin setup

Start the database, run `npm run db:migrate`, then start `npm run dev:api` and `npm run dev:web` in separate Ubuntu terminals. Open `http://127.0.0.1:5173`: an unconfigured installation asks you to choose an admin username, password and timezone. The chosen password is ready for normal login; no temporary/default credentials or CLI bootstrap are required. Already-configured installations keep the existing login screen.

Setup completion persists in PostgreSQL and never reopens automatically if admins are disabled/demoted. The new migration preserves all existing accounts and logging data. `docs/AUTH.md` describes recovery and the unchanged temporary-password policy for admin-created/reset accounts.
