# Milestone 5 frontend verification

The core phone logging frontend is implemented in the Ubuntu WSL checkout. It follows the supplied screenshot using custom React/SCSS components: charcoal panels, pale yellow actions, compact exercise tables, a floating plus button and calendar grids. The agreed username, RPE and independent-set requirements remain in force.

## Reproduce

Run `npm run check`, `npm run test:db` and `npm run test:web` from the repository root, with the development PostgreSQL service running. Browser installation and the two-terminal development commands are in `apps/web/README.md`. The browser gate builds the assets, creates its own disposable database, migrates it, bootstraps a test account, and removes that database on completion. It does not install a real family account or alter development workout history.

## Observed browser evidence

| Area                 | Evidence                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication       | Username login, mandatory initial password change, sign-in after revocation, reload with a real session cookie, same-origin/CSRF API integration.                                                                                                                                                                                                                                                          |
| Saved sets           | Decimal `135.125` pounds survives SQL storage and browser reload. Copy from set 3 preserves exercise/weight/reps/RPE, uses a new time/UUID and becomes set 4. Fresh entries start at set 1/RPE 5.                                                                                                                                                                                                          |
| Uncertain saves      | A POST is committed, then its response is deliberately dropped. Fields lock; closing/reopening preserves the draft. Repeated submit events produce one request. The original UUID/payload is retried, yielding the saved record with one database row. A deleted original returns 410, is acknowledged explicitly, and is not resurrected. Later failures cannot unlock a previously uncertain submission. |
| Expired session      | Revoke a session before saving, then log in as the draft owner. The form retains values and retries its original submission safely.                                                                                                                                                                                                                                                                        |
| Validation/lifecycle | Fractional reps retain an editable form with a field error. An exercise archived after selection is rejected by the API. An existing archived reference remains editable; copying into a new set is disabled. Own pending exercises remain selectable and visibly private.                                                                                                                                 |
| History and deletion | Backdate to a 23-hour Denver DST day from a browser configured for Tokyo. Day/exercise filters return the correct instant. Delete requires confirmation; cancelling preserves the row and confirming removes it.                                                                                                                                                                                           |
| Layout/accessibility | No horizontal page overflow at 320px, 390px and desktop widths. Native dialog initial focus and focus return, visible input labels and a reachable Save button at a reduced 430px viewport are checked. Preview screenshots were inspected.                                                                                                                                                                |

Unit checks separately verify 23/25-hour day bounds, midnight/date boundaries, exact timestamp conversion, spring-gap rejection, both fall-back occurrences, fresh defaults and decimal payloads. Existing API/database ownership and concurrency gates remain passing.

## Remaining verification and scope

- Test on the actual family phone/browser: number/decimal keyboards, visual viewport changes, touch behavior, Save reachability, and a full gym logging sequence. A reduced desktop viewport is not proof of an actual software keyboard's behavior.
- Milestone 6: editable plans, timezone settings, exercise submission/status and admin catalog/account screens. Today's existing plans can already prefill an explicit set save.
- Milestone 7: same-origin production assets, HTTPS/Tailscale, server access, restart behavior, backups and restore.

Drafts are held only in the running page. Reload/browser restart can lose them; there is no offline persistence or synchronization. Uncertain creates remain immutable until reconciled, including through reauthentication.

## First-run setup follow-up

The browser now checks installation state before choosing setup or login. A real Chromium/PostgreSQL scenario starts with an empty installation, validates password confirmation, creates an admin using a chosen password/timezone, handles a stale second setup page, logs in without an unnecessary second password change, and reloads into the log. Existing temporary-password tests remain passing. API tests verify concurrent setup, persistent completion, origin/CSRF/throttling, migration backfill and read-only runtime access to installation state. `AUTH.md` is the setup/recovery reference.
