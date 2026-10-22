# Gym Log

A minimalist, self-hosted gym log for a family. Working title; development scaffolding is in place.

Each workout record is one independent set. Version 1 requires a connection to the Ubuntu server through Tailscale.

Confirmed scope: pounds only, whole-number RPE, private dated plans, shared exercise names with superadmin approval, and admin-managed accounts. Workout history is private through the app; the database owner retains direct database access. Deployment uses Docker Compose.

Members can log privately against their own pending exercise submissions. Plans use calendar dates without scheduled times. Dumbbell weights follow each user's convention.

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

The API foundation is runnable. The milestone 2 API contract and domain migrations are in place. Domain endpoints, authentication, and the frontend follow in later milestones. Node 24.22.1 LTS, TypeScript, Express 5, `pg`, Zod, and node-pg-migrate are pinned through package manifests and `package-lock.json`. PostgreSQL 17 uses an immutable image digest in the development Compose file.

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

`npm run dev` watches API source; restart it after editing contracts (the contracts package is compiled at startup). There is no frontend server yet. `npm run build && npm start` checks the compiled API. The API checks its database connection before listening. Public health reports process liveness only; `npm run db:check` is the internal database readiness check. API errors use a JSON `error.code` and `error.message` without exception details.

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
- `docs/API-EXAMPLES.md`: request/read/edit flows; feature endpoints are planned, not implemented yet.
- `packages/contracts`: browser-safe runtime schemas and inferred types.
- `db/README.md`: migration, local fixture, isolated database-test and recovery commands.

Run `npm run docs:generate` after changing contracts, and `npm run check` to detect stale or invalid OpenAPI as well as source issues. Run `npm run test:db` for real schema/permission evidence. Optional local sample data: `npm run db:fixtures -- --confirm-local-fixtures`; accounts stay disabled and have no usable passwords. The next build milestone is authentication/account administration.
