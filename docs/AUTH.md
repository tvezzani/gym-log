# Authentication and accounts

Milestone 3, October 21, 2026. This is one family instance with exactly two application roles: `user` and `admin`. There are no organizations, tenant identifiers, tenant-specific roles, or tenancy boundary. Sets and plans remain private to their owner, including when the caller is an admin. The database runtime/operator identities are infrastructure credentials, not additional application roles.

## Agreed login policy

- Sessions expire after exactly 30 × 24 hours. Expiry is absolute; requests do not extend it. Signing in creates a fresh random session secret and revokes the current same-user session, if present.
- New accounts, first-admin bootstrap, and admin password resets set `mustChangePassword=true`. Login returns the flag. Only CSRF retrieval, own auth state, password change and logout are available until a different password is chosen. This applies to admins too.
- A successful own-password change clears the flag and revokes all own sessions, including the current one. Log in again using the new password. Admin reset, disable and any role change revoke the target's sessions. Resetting a disabled account does not enable it.
- New/reset passwords are 12–128 characters and are not trimmed or normalized. The new password must differ from the current password. Passwords are hashed using Argon2id, with 19456 KiB memory, two iterations, one lane and a random salt, using the maintained [node-argon2 library](https://github.com/ranisalt/node-argon2) and the [OWASP baseline](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).

## Local configuration

Run migrations and source checks from Ubuntu:

```bash
cd ~/dev/gym-log
export PATH="$HOME/.local/bin:$PATH"
npm ci
npm run setup:env
npm run db:up
npm run db:migrate
npm run check
npm run test:db
npm run dev
```

`.env.example` now includes `AUTH_SECRET` (64 random hex characters), `APP_ORIGIN` (an exact origin without a trailing slash) and `TRUST_PROXY` (`none` by default). New environments generate the secret through `setup:env`. Existing `.env` files are preserved by that command; add missing auth fields deliberately. The active development checkout's `.env` was extended without changing existing database credentials, and remains ignored/mode 600. Never commit it.

Development/test HTTP is allowed only for loopback origins, such as `http://127.0.0.1:3000`. Use that exact configured origin for mutations; `localhost` is a different origin. Production requires an HTTPS origin, HTTPS requests, and Secure cookies. No CORS access is enabled. If a verified loopback reverse proxy terminates TLS, explicitly set `TRUST_PROXY=loopback`; it must overwrite forwarded headers. Otherwise leave it at `none`. This follows [Express's proxy guidance](https://expressjs.com/en/guide/behind-proxies/). Production Tailscale/Compose deployment remains milestone 7.

## First-run browser setup

After starting the database, applying migrations and running `npm run dev:api` plus `npm run dev:web`, open `http://127.0.0.1:5173`. An unconfigured installation shows **First-time setup** before the login screen. Choose the first admin's username, password, confirmation and initial timezone. Usernames use 3–32 lowercase letters, numbers or underscores; the UI normalizes case. Passwords use 12–128 characters and are never trimmed or normalized. There are no default credentials.

The chosen setup password is final: this account has `mustChangePassword=false` and can log in normally without choosing a second password immediately. Admin-assigned initial passwords, CLI bootstrap/recovery passwords and admin resets remain temporary and still require an immediate change. No login session is issued by setup itself.

Public GET `/api/v1/auth/setup` returns only `{setupRequired:boolean}` with no account details. POST to the same path accepts `{username,password,timeZone}`, requires exact Origin and signed pre-login CSRF, is rate limited, and returns a shaped User with 201. Browser and CLI initialization share the admin transaction lock so competing requests cannot create two first admins. The UI handles a stale setup page or a lost creation response by rechecking completion and directing the user to login.

`app.installation` records completion in the same transaction as first-admin creation. A restricted database trigger also covers CLI/operator-created admins and role promotions. Existing installations with any real admin are marked complete on migration. Only the exact disabled, unusable sample identities from the development fixture script are exempt; a narrowly scoped forward migration reconciles a fixture-only database without changing sample data. Disabling or demoting all admins, session expiry or restarting the API never reopens public setup. Runtime database credentials can read the marker but cannot reset it, delete it or call its privileged trigger function. Missing state fails closed. The migration does not create an account, change existing credentials, or erase data.

## Bootstrap the first real admin

The browser setup above is the normal first-run path. The optional local CLI remains available for operator bootstrap/recovery. It creates an active admin only if none exists; the same transaction lock used by account administration serializes concurrent bootstrap attempts. It requires an explicit username/timezone and receives the password through stdin. There is no default password and it is never echoed or logged.

In an interactive **Ubuntu Bash** terminal:

```bash
read -r -s -p 'Temporary bootstrap password: ' gym_bootstrap_password
printf '\n'
printf '%s' "$gym_bootstrap_password" | npm run admin:bootstrap -- --username tim --time-zone America/Denver
unset gym_bootstrap_password
```

Choose your own canonical lowercase username and temporary password. The account initially requires a password change. Log in through the browser and complete its required password-change screen. No real family admin was created automatically during implementation. Integration tests bootstrap only inside a disposable database.

If an active admin already exists, bootstrap fails rather than creating a second one. Existing admins create additional accounts through the API. Disabling/demoting the final active admin is blocked, even for concurrent requests. Database-operator recovery remains separate; do not weaken the guard or expose operator credentials through the API.

## API flow

1. GET `/api/v1/auth/csrf`; retain its HttpOnly `gym_preauth` cookie and returned `csrfToken`. The context expires after ten minutes and is HMAC-signed with `AUTH_SECRET`.
2. POST `/api/v1/auth/login` with username/password, the cookie, exact `Origin`, and `X-CSRF-Token`. The response sets `gym_session` and returns `{user,csrfToken}`. No raw session secret/hash is returned in JSON.
3. If `user.mustChangePassword`, PATCH `/api/v1/auth/password` with `currentPassword` and a different `newPassword`, the session cookie, `Origin`, and session CSRF token. Success is 204 and clears/revokes the session. Repeat the login flow with the new password.
4. Use GET `/auth/me`, PATCH `/preferences`, and authorized `/admin/users` routes as documented in OpenAPI. All mutations require both `Origin` and a session-bound CSRF token. POST `/auth/logout` revokes the current session and clears its cookie.

CSRF failures and role denial return 403. Required-change restrictions return `PASSWORD_CHANGE_REQUIRED` (403); missing/expired/revoked/disabled auth returns 401. All request/response shapes, field errors and examples are in generated `openapi.yaml`. Admin-created accounts start as users unless a admin role is explicitly supplied; only those two enum values are accepted.

Admin account endpoints are implemented: list/create, enable/disable, change role, and reset password. They deliberately return user summaries without password hashes, session data, or other users' workouts/plans. `/preferences` changes only the current user's timezone. Exercise/set/plan handlers are implemented and verified in milestone 4; see `API-GATE.md`.

## Storage, revocation and rate limits

Session secrets and CSRF tokens use 32 random bytes. PostgreSQL stores SHA-256 session-token hashes, never raw session secrets. Session cookies are HttpOnly, SameSite=Lax, scoped to `/api/v1`, and Secure in production. The separate CSRF token can be returned only through the same-origin API. Auth responses use `Cache-Control: no-store`.

Authenticated operations recheck the active account, current role, forced-change flag, live session and expiry. Mutation transactions lock the account before reading auth again in a fresh statement snapshot; login verifies the hash again by identity under the same account lock before creating a session. This prevents a concurrent disable/reset from leaving a surviving old-password login. Last-admin changes and bootstrap additionally use a common PostgreSQL advisory transaction lock.

Login is limited to 30 attempts per IP and 10 per IP/username pair within a 15-minute fixed window, including successful attempts. Password changes are limited to 10 per user and CSRF retrieval to 60 per IP in that window. Limits are atomic PostgreSQL rows, survive app restarts and work across API processes. Bucket keys are HMAC digests; no raw password, username, or IP is stored in those rows. Untrusted forwarding headers do not change the client IP. Unknown/disabled users get generic login errors; unknown-user verification uses a dummy Argon2 hash.

Run the explicit cleanup command periodically (scheduling belongs to deployment):

```bash
npm run auth:cleanup
```

It removes expired session/rate-limit rows only. Revoked sessions remain unusable until expiry/cleanup. It does not delete accounts, workout retry identities or user history.

## Verification and limits

`npm run test:db` creates a uniquely named disposable PostgreSQL database and proves bootstrap, real hashes/sessions, the mandatory-change restriction, session rotation/expiry, user denial, admin account controls, reset/disable/role revocation, reset/login races, CSRF/origin checks, HTTPS cookies/proxy configuration, persistent rate limits, and concurrent protection of the last admin. It removes that test database afterward. `npm run check` also validates source types, lint, formatting, examples and generated OpenAPI drift.

First-run setup and login/change-password browser forms are implemented and verified against real sessions and PostgreSQL. The full workout/plan ownership API gate now passes. Deployment HTTPS, proxy topology and phone checks remain their planned milestones.

## Role labels — October 21, 2026

The application/API now uses exactly `user` and `admin`. The role-rename migration converts existing accounts in place and updates the default, constraint and active-admin index. Earlier applied migrations retain their original historical labels. Account IDs, password hashes, active state, required-password-change flags, and session identities are preserved. Infrastructure database roles remain separate.
