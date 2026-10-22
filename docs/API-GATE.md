# Milestone 4 API gate

Completed October 21, 2026 in `/home/tvezzani/dev/gym-log` (Ubuntu WSL). The complete documented v1 API is implemented before frontend work. No new schema migration was needed for this milestone. Only two application roles exist: user and admin; this remains a single family instance.

## Reproduce the verification

```bash
cd ~/dev/gym-log
export PATH="$HOME/.local/bin:$PATH"
npm run check
npm run test:domain
npm run test:db
```

PostgreSQL must be running and the local operator URL must allow creating disposable databases. The domain test creates a uniquely named database, applies all migrations, bootstraps an admin, creates two users through the real account API, completes the forced-password-change flow and uses real cookie/CSRF authentication. It removes only that disposable database after testing. It does not create a real family login or alter development workout history.

`npm run check` covers build, source/test types, lint, formatting, schema/example tests and generated OpenAPI validity/drift. `test:domain` runs the domain gate by itself; `test:db` includes the existing authentication, migration/role-upgrade and runtime-privilege tests too.

## Observed API evidence

| Requirement              | Real PostgreSQL / HTTP verification                                                                                                                                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Persisted set CRUD       | Create a set with an own pending exercise, read it through detail/history, edit reps/weight/RPE/reference, delete it, and confirm the persisted row/identity state.                                                                                           |
| Ownership                | Two users and an admin attempt list, detail, edit, delete, filter, referenced-ID selection and plan reorder across owners. No role bypasses set/plan ownership; client owner fields are rejected.                                                             |
| Exercise lifecycle       | Own pending permits private logging/planning, another user's pending is unavailable (also for admin logging). Approval shares only the stable catalog ID. Rejection/archive preserves history and blocks new selection. Only admin can review/rename/archive. |
| Historical edits         | Existing rejected/archived references can remain while editing a set/plan. Selecting a different unavailable exercise fails. Admin rename is reflected through the same referenced ID.                                                                        |
| Create retries           | Equivalent weights, timestamps, UUID case and omitted defaults map to one original identity. Concurrent identical creates produce one row; conflicting payload/owner reuse is generic 409. Retries preserve later edits and return 410 after deletion.        |
| Numeric bounds           | Decimal pounds round-trip exactly (including `99999.999` and zero), RPE defaults to 5, fresh set number defaults to 1. Overflow, excess precision, floats in integral fields and malformed decimal input fail before writing a retry identity.                |
| Time/history             | Performed instants preserve milliseconds/offset meaning. Start-inclusive/end-exclusive filters work for 23-hour and 25-hour Denver DST days. ID tie-breakers make paging deterministic; latest values follow performed time rather than insertion time.       |
| Calendar plans           | Dates survive timezone changes, notes stay plain text, CRUD/reordering does not generate workouts, and ownership remains private. Invalid calendar dates fail.                                                                                                |
| Plan concurrency         | Concurrent appends get unique positions; reorder is complete and atomic. Create/reorder conflicts never leave a partial order. Opposite date moves complete safely. The 500-entry date bound and a full 500-entry reorder are tested.                         |
| Eligibility race         | A transaction archives an exercise while a set/plan creation is waiting on its shared row lock. On release the API sees archival, rejects the new entry, and rolls back any new retry identity.                                                               |
| Review/transaction races | Concurrent approve/reject yields one decision and one conflict. Complete transactions retry deadlock/serialization failures up to three times; rolled-back writes do not survive and persistent conflicts become 409.                                         |

The domain scenarios live in `apps/api/test/domain.integration.test.ts` and validate response shapes against shared contracts. Existing auth and SQL constraint tests remain in the same test directory. `docs/openapi.yaml` includes all implemented paths and examples, generated from the same runtime schemas; `docs/API-EXAMPLES.md` explains the create/read/edit flows.

## Implementation boundaries

All domain handlers run behind the session, forced-password-change, same-origin and CSRF guards. They recheck auth inside transactions and derive the owner from the session. New exercise selections hold a shared exercise row lock until commit; review/archive uses an exclusive row lock. Complete failed transactions are rolled back before bounded retry.

Every plan mutation takes the shared owner/date advisory lock; moves acquire both date keys in sorted order. Reorder validates full owner/date membership and defers the per-date position constraint only inside its transaction. Offset pagination does not promise a snapshot across concurrent changes, as documented in API-RULES.md.

The gate is satisfied for starting milestone 5: the core phone logging frontend. Browser/phone UX, uncertain-save form recovery, real-device testing, private deployment, backups and a real gym visit remain later milestones. No frontend or production deployment is included here.
