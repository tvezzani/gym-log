# Database development

Run `npm run db:up`, then `npm run db:migrate` and `npm run db:check` from the repository root in Ubuntu WSL. Docker uses sudo; migrations use the separate operator URL. PostgreSQL's initialization script provisions the restricted `gym_app` role on an empty volume. No application login is created by migration.

Use timestamp-prefixed SQL files in `db/migrations` with node-pg-migrate `-- Up Migration` / `-- Down Migration` markers. Keep documentation outside that directory. Migrations are tracked in `public.pgmigrations`, serialized with the migration tool's lock, and transactional by default. Never disable the lock/transaction behavior casually. A failure rolls back: fix its cause and rerun. Do not edit applied migrations.

The baseline grants runtime data access in the `app` schema through operator default privileges. The domain migration creates users, exercises, workouts, private plans, sessions and a durable create-request identity ledger. The runtime role cannot create tables, read migration records, or update/delete retry identities. Database access belongs only in the API/operator tooling; end-user ownership checks are still mandatory in handlers.

Weights use `numeric(8,3)` and must be precision-validated before SQL conversion. Reps/set number/RPE use numeric range and integral-value CHECKs so direct numeric fractional inputs are rejected instead of rounded on assignment to integer types. pg returns numeric as text; convert only the bounded integer fields to JSON numbers. Keep weights decimal strings and select plan dates as `planned_date::text`.

```bash
npm run test:db
```

This checks the actual development runtime permissions, then creates a uniquely named disposable database to apply migrations from empty, rerun them, test constraints/history/ordering, and prove failure rollback with a deliberate division-by-zero migration. It drops only its generated database and temporary files. It uses an operator with CREATE DATABASE privileges; it does not clear the development database or seed tests into it.

```bash
npm run db:fixtures -- --confirm-local-fixtures
```

Fixtures are optional, explicitly limited to `NODE_ENV=development` and a loopback `gym_log` database. They create three disabled `fixture_*` accounts, an approved exercise, a private pending exercise, one historical set, and one dated plan with stable IDs. They run in one transaction and can be repeated. Their placeholder password hashes are not usable credentials; accounts remain disabled. Existing fixture-account conflicts abort, rather than overwriting account changes. They are not production/bootstrap data. Bootstrap of a real active admin with a supplied stdin secret is available through `npm run admin:bootstrap`; see `docs/AUTH.md`.

There is no destructive v1 account deletion. User/exercise foreign keys restrict deletion while referenced. Sets may be deleted, but the immutable owner/request-hash identity remains to prevent retry resurrection. Session cleanup can delete expired rows; it must not prune retry identities. Sessions expire after 30 absolute days; new/bootstrap/reset accounts require an immediate password change. `npm run auth:cleanup` removes expired sessions and rate-limit buckets.

Before production migration, take and test a backup and document compatible app/schema versions. The domain down section refuses destructive rollback; the original baseline down is non-destructive. Restore a verified backup or add a reviewed forward recovery migration. An app rollback does not undo a database migration. Production backup/restore automation and the operations runbook remain in the deployment milestone.
