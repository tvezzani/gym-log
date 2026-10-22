# API examples

All endpoints below are implemented. The milestone 4 gate exercises these flows through HTTP and real PostgreSQL; see `API-GATE.md`. Every operation also has typed request/response examples in `openapi.yaml`, generated from `packages/contracts/src/examples.ts` and checked against runtime schemas. IDs below are synthetic. Passwords shown in OpenAPI are examples, never installed credentials.

Authenticate with `/auth/csrf` and `/auth/login`, retaining the cookie and returned CSRF token. Authenticated writes require `Origin`, `X-CSRF-Token` and the session cookie. Owner identity is never supplied in JSON.

## Configure a fresh installation

GET `/auth/setup` returns `{"setupRequired":true}` only before initial configuration. Obtain the signed pre-login cookie/token from `/auth/csrf`, then POST `/auth/setup` with exact Origin and CSRF:

```json
{
  "username": "admin",
  "password": "Example-only-chosen-password!",
  "timeZone": "America/Denver"
}
```

201 returns User with role `admin` and `mustChangePassword:false`; no session is created. Log in with the password you chose. Competing or later setup requests return 409; setup stays closed across restarts and disabled/demoted accounts. The browser handles this flow automatically. Admin-created/reset accounts and optional CLI bootstrap still require an immediate password change.

## Submit a name and use it while pending

`POST /api/v1/exercises`

```json
{ "name": "Barbell squat" }
```

201 returns an exercise with a server UUID, `status: "pending"`, the session user as `submittedBy`, and null review/archival metadata. GET `/exercise-submissions` lists it for its owner. Until admin approval it is absent from `/exercises` and unavailable to other users. PATCH `/exercises/{id}` is admin-only, including name changes. Approve/reject via the documented admin routes; approval preserves the ID.

## Create, read, and edit an independent set

`POST /api/v1/workouts`

```json
{
  "id": "a3b65f0f-fc21-4fe8-81a4-bc9e1ecc0003",
  "exerciseId": "a3b65f0f-fc21-4fe8-81a4-bc9e1ecc0002",
  "performedAt": "2026-10-21T12:34:56.123-06:00",
  "reps": 10,
  "weight": "135.500"
}
```

201 returns the persisted row with `weight: "135.5"`, `performedAt: "2026-10-21T18:34:56.123Z"`, `setNumber: 1`, `rpe: 5`, server timestamps and the exercise reference/status. GET `/workouts/a3b65f0f-fc21-4fe8-81a4-bc9e1ecc0003` returns the same owned row. Its complete response shape is in OpenAPI.

Retry that same POST with the same UUID after a timeout. Equivalent decimal spelling (`135.5`), the equivalent UTC instant, and explicit default values have the same normalized request hash. Return 200 and one saved row. A different reps/weight/etc. under that UUID returns 409. After a later edit, identical create retries return the current row without applying old fields; after deletion, they return 410. A new independent set, including Copy as next set, requires a new UUID and performed time.

`PATCH /api/v1/workouts/a3b65f0f-fc21-4fe8-81a4-bc9e1ecc0003`

```json
{ "reps": 12, "rpe": 7 }
```

200 returns the edited row with other fields unchanged. `DELETE` on the same owned URL returns 204. The retry identity is retained. A different owner receives 404 for detail/edit/delete. GET `/workouts?exerciseId=...&limit=1` gives latest recorded values. For a day, send explicit start-inclusive/end-exclusive timestamps computed for the stored timezone (URL-encode numeric `+` offsets).

## Plan for a date and change notes

`POST /api/v1/planned-exercises`

```json
{
  "exerciseId": "a3b65f0f-fc21-4fe8-81a4-bc9e1ecc0002",
  "plannedDate": "2026-10-21",
  "notes": "3x10"
}
```

201 returns a server ID, owner, date, notes and appended `sortOrder`. GET `/planned-exercises?plannedDate=2026-10-21` reads the owned date. PATCH its ID with `{"notes":"3x8"}` and receive the updated row. PUT `/planned-exercises/order` with `{"plannedDate":"2026-10-21","orderedIds":["a3b65f0f-fc21-4fe8-81a4-bc9e1ecc0004"]}` atomically orders all entries on that date (204). DELETE an owned plan ID returns 204.

The date remains `2026-10-21` after timezone changes. Notes are not parsed and no set is produced until a later explicit workout save.

## Account creation/reset and preferences

Admin POST `/admin/users` requires canonical username, a supplied password, an initial IANA `timeZone`, and optional role (user by default). It returns a shaped User object (201), never the password/hash. Admin PATCH `/admin/users/{id}` with `{"isActive":false}` disables/revokes sessions and returns User (200). Admin POST `/admin/users/{id}/reset-password` with a supplied `temporaryPassword` returns 204 and revokes sessions; it never returns credentials. User calls to admin routes return 403. The last active admin is protected.

PATCH `/preferences` with `{"timeZone":"America/Denver"}` returns the caller's updated User object. GET `/auth/me` returns the user and CSRF token. PATCH `/auth/password` takes current/new password, returns 204, and requires logging in again. Sessions last 30 days without sliding renewal. New/bootstrap/reset accounts must change their password immediately; `mustChangePassword` is returned in User. See `AUTH.md`.

## Field validation

For a semantic validation error, return 422:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request",
    "fieldErrors": [
      {
        "path": "weight",
        "message": "Use a decimal string with at most three decimal places"
      }
    ]
  }
}
```

Do not echo invalid passwords, session values, or other submitted data in errors. See `API-RULES.md` for eligibility, pagination, locking, retry normalization and SQL conversion details.
