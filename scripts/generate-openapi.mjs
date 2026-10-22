import { readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import YAML from 'yaml';
import prettier from 'prettier';
import SwaggerParser from '@apidevtools/swagger-parser';
import {
  contractSchemas,
  timestampSchema,
  dateSchema,
  idSchema,
} from '../packages/contracts/dist/index.js';
import { examples } from '../packages/contracts/dist/examples.js';

const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const json = (name) => ({
  'application/json': { schema: ref(name), example: examples[name] },
});
const error = (description) => ({ description, content: json('ApiError') });
const query = (name, schema, description, required = false) => ({
  name,
  in: 'query',
  required,
  schema,
  description,
});
const paging = [
  query(
    'limit',
    { type: 'integer', minimum: 1, maximum: 100, default: 50 },
    'Maximum returned items',
  ),
  query(
    'offset',
    { type: 'integer', minimum: 0, maximum: 100000, default: 0 },
    'Items to skip in deterministic ordering; no snapshot guarantee across concurrent writes',
  ),
];
function jsonSchema(schema) {
  const value = z.toJSONSchema(schema, {
    io: 'input',
    target: 'draft-2020-12',
  });
  delete value.$schema;
  return value;
}
const uuidQuery = (name, description) =>
  query(name, jsonSchema(idSchema), description);
const timeQuery = (name, description) =>
  query(name, jsonSchema(timestampSchema), description);
const dateQuery = query(
  'plannedDate',
  { ...jsonSchema(dateSchema), format: 'date' },
  'Real calendar date; no timezone conversion',
  true,
);
const paths = {};
function operation(method, path, id, tag, summary, response, options = {}) {
  const mutation = !['get', 'head'].includes(method);
  const status =
    options.status ??
    (method === 'post' && !path.startsWith('/auth') ? 201 : 200);
  const responses = {
    [status]: response
      ? {
          description: options.description ?? 'Success',
          content: json(response),
        }
      : { description: options.description ?? 'Success; no response body' },
    500: error('Unexpected failure; no internal details'),
  };
  const parameters = [...(options.query ?? [])];
  if (path.includes('{id}'))
    parameters.unshift({
      name: 'id',
      in: 'path',
      required: true,
      schema: { type: 'string', format: 'uuid' },
      description:
        'Resource UUID; private resources are looked up within the authenticated owner',
    });
  if (!options.public) {
    Object.assign(responses, {
      401: error(
        'Missing, expired, revoked, or invalid session; disabled accounts cannot authenticate',
      ),
      403: error('Role or CSRF denial'),
      404: error(
        'Unknown or inaccessible resource; do not disclose another owner',
      ),
    });
  }
  if (parameters.length || options.request)
    responses[422] = error(
      'Runtime validation failed; fieldErrors contain paths and messages, never input values',
    );
  if (mutation) {
    parameters.push({
      name: 'X-CSRF-Token',
      in: 'header',
      required: true,
      schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{43}$' },
      description:
        'Token obtained from /auth/csrf or authenticated login response; tied to the cookie context',
    });
    Object.assign(responses, {
      400: error('Malformed JSON'),
      409: error(
        'State conflict; includes last active admin protection, exercise eligibility, or retry-ID conflict',
      ),
      413: error('Request body exceeds 32 KiB'),
      415: error('Unsupported request encoding'),
    });
  }
  Object.assign(responses, options.responses ?? {});
  const value = {
    operationId: id,
    tags: [tag],
    summary,
    description:
      options.notes ??
      'Planned endpoint; milestone 2 defines the contract. Implementation follows in milestones 3 and 4.',
    security: options.public
      ? mutation
        ? [{ csrf: [] }]
        : []
      : mutation
        ? [{ session: [], csrf: [] }]
        : [{ session: [] }],
    responses,
  };
  if (parameters.length) value.parameters = parameters;
  if (options.request)
    value.requestBody = { required: true, content: json(options.request) };
  paths[path] ??= {};
  paths[path][method] = value;
}
operation(
  'get',
  '/health',
  'health',
  'Operations',
  'Minimal process liveness',
  'Health',
  {
    public: true,
    notes:
      'Implemented. No database details. Internal readiness uses npm run db:check.',
  },
);
operation(
  'get',
  '/auth/csrf',
  'getCsrf',
  'Authentication',
  'Obtain a CSRF token',
  'Csrf',
  {
    public: true,
    notes:
      'Planned. Sets an opaque signed pre-login context cookie when unauthenticated; after login returns the session CSRF token. Same-origin only; Cache-Control: no-store.',
    responses: { 429: error('Rate limit exceeded') },
  },
);
operation(
  'get',
  '/auth/setup',
  'setupStatus',
  'Authentication',
  'Check whether first-run setup is required',
  'SetupStatus',
  {
    public: true,
    notes:
      'Implemented. Returns only setupRequired. Existing or previously configured installations with real admins remain closed even if every admin is disabled or demoted. Exact disabled development fixtures are not usable accounts. Same-origin reads only.',
  },
);
operation(
  'post',
  '/auth/setup',
  'setupAdmin',
  'Authentication',
  'Create the first admin once',
  'User',
  {
    public: true,
    status: 201,
    request: 'SetupCreate',
    notes:
      'Implemented. Same-origin and signed pre-login CSRF required. Serialized with CLI bootstrap and admin mutations. The owner chooses their final password; mustChangePassword=false. No session is issued; log in normally. Later accounts/reset/CLI bootstrap keep mandatory password changes.',
    responses: {
      403: error('Invalid origin or signed CSRF context'),
      409: error('Setup already completed or username unavailable'),
      429: error('Setup rate limit exceeded'),
    },
  },
);
operation(
  'post',
  '/auth/login',
  'login',
  'Authentication',
  'Log in and rotate the opaque session',
  'Auth',
  {
    public: true,
    request: 'Login',
    notes:
      'Planned. Requires the pre-login CSRF cookie/token and same-origin check. Canonical lowercase username; password is untouched. Sets the HttpOnly session cookie; returns no session secret or hash. Session lifetime and reset policy are settled before milestone 3.',
    responses: {
      401: error(
        'Invalid username/password or disabled account; use one generic message',
      ),
      403: error('Invalid CSRF context or origin'),
      429: error('Login rate limit exceeded'),
    },
  },
);
operation(
  'post',
  '/auth/logout',
  'logout',
  'Authentication',
  'Revoke the current session and clear its cookie',
  null,
  { status: 204 },
);
operation(
  'get',
  '/auth/me',
  'me',
  'Authentication',
  'Read own account and CSRF token',
  'Auth',
);
operation(
  'patch',
  '/auth/password',
  'changePassword',
  'Authentication',
  'Change own password and revoke existing sessions',
  null,
  {
    request: 'PasswordChange',
    status: 204,
    notes:
      'Planned. Verify current password; revoke all own sessions including the current one. The caller logs in again. No password/hash is returned.',
  },
);
operation(
  'patch',
  '/preferences',
  'updatePreferences',
  'Accounts',
  'Change own explicit history timezone',
  'User',
  {
    request: 'PreferencesPatch',
    notes:
      'Planned. A stored IANA timezone groups performed instants. Plans remain unchanged calendar dates. Never follow phone timezone changes automatically.',
  },
);
operation(
  'get',
  '/exercises',
  'listExercises',
  'Exercises',
  'List approved, unarchived shared exercises',
  'ExerciseList',
  {
    query: paging,
    notes:
      'Planned. Shared across authenticated family accounts only. Order lower(name) ASC, id ASC. Names need not be unique. This never includes other users’ pending or rejected exercises.',
  },
);
operation(
  'post',
  '/exercises',
  'submitExercise',
  'Exercises',
  'Submit a private pending exercise',
  'Exercise',
  {
    request: 'ExerciseCreate',
    notes:
      'Planned. submittedBy is the session user. The submitter may use it privately while pending. Approval shares only the exercise; sets/plans remain private.',
  },
);
operation(
  'get',
  '/exercise-submissions',
  'ownSubmissions',
  'Exercises',
  'List own exercise submissions and review status',
  'ExerciseList',
  {
    query: paging,
    notes:
      'Planned. Includes own pending, approved, rejected, and archived submissions. Order createdAt DESC, id DESC. Merge own unarchived pending entries into the logging picker.',
  },
);
operation(
  'patch',
  '/exercises/{id}',
  'maintainExercise',
  'Administration',
  'Admin-only rename or archive/unarchive',
  'Exercise',
  {
    request: 'ExercisePatch',
    notes:
      'Planned. Only admin may rename any exercise. IDs and all historical references survive name/status changes. isArchived=true records server time; false clears archival. No exercise deletion endpoint.',
  },
);
operation(
  'get',
  '/admin/exercises',
  'reviewQueue',
  'Administration',
  'List submissions for admin review',
  'ExerciseList',
  {
    query: [
      ...paging,
      query(
        'status',
        {
          type: 'string',
          enum: ['pending', 'approved', 'rejected'],
          default: 'pending',
        },
        'Review status',
      ),
    ],
    notes:
      'Planned. Admin only. Order createdAt ASC, id ASC. Admin access does not grant history/plan access.',
  },
);
for (const action of ['approve', 'reject'])
  operation(
    'post',
    `/admin/exercises/{id}/${action}`,
    `${action}Exercise`,
    'Administration',
    `Admin ${action}s a pending submission`,
    'Exercise',
    {
      status: 200,
      notes: `Planned. Only pending entries can be reviewed; lock the exercise row. Record reviewer and server timestamp. ${action === 'approve' ? 'Approval shares the stable exercise ID.' : 'Rejection preserves old sets/plans but prevents new selection.'} No rejection-reason field.`,
    },
  );
operation(
  'get',
  '/workouts',
  'listWorkouts',
  'Sets',
  'List only own independent sets',
  'WorkoutList',
  {
    query: [
      ...paging,
      uuidQuery(
        'exerciseId',
        'Filter own history by exercise; unavailable historical exercises remain valid filters',
      ),
      timeQuery('start', 'Inclusive lower bound; start must precede end'),
      timeQuery('end', 'Exclusive upper bound'),
    ],
    notes:
      'Planned. Owner always comes from the session, including admin. Order performedAt DESC, id DESC. Latest values: exerciseId + limit=1 + offset=0, with no time bounds. Clients compute local-day boundaries with IANA timezone rules (23/24/25-hour days), not a fixed 24-hour span.',
  },
);
operation(
  'post',
  '/workouts',
  'createWorkout',
  'Sets',
  'Create a set or safely retry its original request',
  'Workout',
  {
    request: 'WorkoutCreate',
    notes:
      'Planned. Require client UUID and stable performedAt. Hash canonicalWorkoutCreate output using server SHA-256 and store owner/hash in the immutable retry ledger in the same transaction as the set. First creation returns 201; identical owner/request replay returns 200 with the current saved row, without applying changes. Different payload or owner returns generic 409. If subsequently deleted, identical replay returns 410 and never resurrects it. Check retry identity before current exercise eligibility. See API-RULES.md.',
    responses: {
      200: {
        description:
          'Identical retry, including after later edits; current saved row',
        content: json('Workout'),
      },
      410: error(
        'Original set was deleted; retry identity is retained and cannot recreate it',
      ),
    },
  },
);
operation(
  'get',
  '/workouts/{id}',
  'getWorkout',
  'Sets',
  'Read an owned set',
  'Workout',
);
operation(
  'patch',
  '/workouts/{id}',
  'updateWorkout',
  'Sets',
  'Edit an owned set',
  'Workout',
  {
    request: 'WorkoutPatch',
    notes:
      'Planned. The same existing exercise reference may be retained even if rejected/archived; changing it requires current eligibility. Fields omitted by PATCH remain unchanged. The original create-request hash never changes.',
  },
);
operation(
  'delete',
  '/workouts/{id}',
  'deleteWorkout',
  'Sets',
  'Delete an owned set while retaining retry identity',
  null,
  { status: 204 },
);
operation(
  'get',
  '/planned-exercises',
  'listPlans',
  'Plans',
  'List own plan entries for one date',
  'PlanList',
  {
    query: [...paging, dateQuery],
    notes:
      'Planned. Order sortOrder ASC, id ASC. Notes remain plain free text; there is no automatic plan completion or creation of sets.',
  },
);
operation(
  'post',
  '/planned-exercises',
  'createPlan',
  'Plans',
  'Append a plan entry to an owned date',
  'Plan',
  {
    request: 'PlanCreate',
    notes:
      'Planned. Server creates UUID and appends after the current last position, locking the owner/date. Maximum 500 entries per owner/date. New plans use the same exercise eligibility as new sets.',
  },
);
operation(
  'patch',
  '/planned-exercises/{id}',
  'updatePlan',
  'Plans',
  'Edit an owned plan entry',
  'Plan',
  {
    request: 'PlanPatch',
    notes:
      'Planned. Retaining an existing rejected/archived exercise is allowed. Changing exercise requires current eligibility. Moving dates locks both owner/date keys in sorted order and appends on the destination date, enforcing its 500-entry bound.',
  },
);
operation(
  'delete',
  '/planned-exercises/{id}',
  'deletePlan',
  'Plans',
  'Delete an owned plan entry',
  null,
  { status: 204 },
);
operation(
  'put',
  '/planned-exercises/order',
  'reorderPlans',
  'Plans',
  'Atomically replace one owned date’s complete ordering',
  null,
  {
    request: 'PlanReorder',
    status: 204,
    notes:
      'Planned. orderedIds must include every current entry for the authenticated owner and plannedDate exactly once (maximum 500); an empty list is valid only for an empty date. Under the common owner/date lock, compare membership, defer plans_owner_date_order, update all positions to 0..n-1, and commit. Any mismatch/conflicting concurrent membership returns 409 with no partial reorder. Do not expose foreign-owner IDs.',
  },
);
operation(
  'get',
  '/admin/users',
  'listAccounts',
  'Administration',
  'Admin lists account summaries',
  'AccountList',
  {
    query: paging,
    notes:
      'Planned. Order username ASC, id ASC. Deliberately shaped summaries exclude password hashes and sessions; do not join other users’ sets/plans.',
  },
);
operation(
  'post',
  '/admin/users',
  'createAccount',
  'Administration',
  'Admin creates an account',
  'User',
  { request: 'AccountCreate' },
);
operation(
  'patch',
  '/admin/users/{id}',
  'updateAccount',
  'Administration',
  'Admin changes role or active state',
  'User',
  {
    request: 'AccountPatch',
    notes:
      'Planned. Disable revokes sessions. Protect the last active admin using a common transaction lock, not a count-then-update race. No destructive account deletion.',
  },
);
operation(
  'post',
  '/admin/users/{id}/reset-password',
  'resetPassword',
  'Administration',
  'Admin resets a password and revokes sessions',
  null,
  {
    request: 'AccountReset',
    status: 204,
    notes:
      'Planned. Admin supplies the temporary password through this authenticated request; never return it, log it, or include a hash. Forced-change policy is decided before authentication implementation, not silently added here.',
  },
);

const implemented = new Set(Object.keys(paths));
for (const [path, methods] of Object.entries(paths))
  for (const [method, op] of Object.entries(methods)) {
    if (implemented.has(path)) {
      op.description = op.description.startsWith('Planned endpoint;')
        ? 'Implemented.'
        : op.description.replace(/^Planned\./, 'Implemented.');
      op.description = op.description.replace(
        'Session lifetime and reset policy are settled before milestone 3.',
        'Sessions expire after exactly 30 days without sliding renewal. New/bootstrap/reset passwords require an immediate change; user.mustChangePassword describes this restriction.',
      );
      op.description = op.description.replace(
        'Forced-change policy is decided before authentication implementation, not silently added here.',
        'Sets mustChangePassword=true. The next login permits only reading own auth state, obtaining CSRF, changing the password or signing out until a different password is chosen.',
      );
      if (path === '/auth/password')
        op.description +=
          ' The new password must differ from the current password. Success clears mustChangePassword and revokes every own session.';
      if (path === '/admin/users' && method === 'post')
        op.description += ' The account starts with mustChangePassword=true.';
      if (path === '/admin/users/{id}' && method === 'patch')
        op.description +=
          ' Role changes also revoke the target’s sessions. Exactly two roles exist: user and admin; no tenancy layer.';
      if (path === '/auth/me')
        op.description += ' Allowed during a required password change.';
      if (op.responses[403])
        op.responses[403].description =
          'Role/CSRF/origin denial, or PASSWORD_CHANGE_REQUIRED until the password is changed';
    }
    if (!['get', 'head'].includes(method))
      op.parameters.push({
        name: 'Origin',
        in: 'header',
        required: true,
        schema: { type: 'string', format: 'uri' },
        description:
          'Must exactly match configured APP_ORIGIN. Required for browser and CLI API mutations.',
      });
  }
paths['/admin/users'].post.responses[201].content['application/json'].example =
  { ...examples.User, mustChangePassword: true };
const loginContent =
  paths['/auth/login'].post.responses[200].content['application/json'];
delete loginContent.example;
loginContent.examples = {
  normal: { value: examples.Auth },
  passwordChangeRequired: {
    value: {
      ...examples.Auth,
      user: { ...examples.User, mustChangePassword: true },
    },
  },
};

// The shared exercise list must demonstrate an approved row, not a private submission.
const approved = {
  ...examples.Exercise,
  status: 'approved',
  reviewedBy: 'a3b65f0f-fc21-4fe8-81a4-bc9e1ecc0005',
  reviewedAt: examples.Exercise.createdAt,
};
paths['/exercises'].get.responses[200].content['application/json'].example = {
  ...examples.ExerciseList,
  items: [approved],
};
paths['/admin/exercises/{id}/approve'].post.responses[200].content[
  'application/json'
].example = approved;
paths['/admin/exercises/{id}/reject'].post.responses[200].content[
  'application/json'
].example = { ...approved, status: 'rejected' };
const errorCodes = {
  400: 'INVALID_JSON',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  410: 'GONE',
  413: 'BODY_TOO_LARGE',
  415: 'UNSUPPORTED_ENCODING',
  422: 'VALIDATION_ERROR',
  429: 'RATE_LIMITED',
  500: 'INTERNAL_ERROR',
};
for (const path of Object.values(paths))
  for (const op of Object.values(path))
    for (const [status, response] of Object.entries(op.responses)) {
      if (Number(status) >= 400)
        response.content['application/json'].example =
          Number(status) === 422
            ? examples.ApiError
            : {
                error: {
                  code: errorCodes[status],
                  message: response.description,
                },
              };
    }
const schemas = Object.fromEntries(
  Object.entries(contractSchemas).map(([name, schema]) => {
    const value = z.toJSONSchema(schema, {
      io: 'input',
      target: 'draft-2020-12',
    });
    delete value.$schema;
    if (name.endsWith('Patch')) value.minProperties = 1;
    return [name, value];
  }),
);
schemas.PlanReorder.properties.orderedIds.uniqueItems = true;
const document = {
  openapi: '3.1.0',
  info: {
    title: 'Gym Log API',
    version: '0.3.0',
    description:
      'The complete v1 API is implemented and verified against PostgreSQL, including authentication, accounts, exercises, independent sets and private plans. Family-private shared catalog; owner-private sets/plans. All writes require the server. API-RULES.md documents cross-field, ownership, eligibility, and concurrency rules beyond JSON Schema.',
  },
  servers: [{ url: '/api/v1' }],
  tags: [
    'Operations',
    'Authentication',
    'Accounts',
    'Exercises',
    'Sets',
    'Plans',
    'Administration',
  ].map((name) => ({ name })),
  paths,
  components: {
    securitySchemes: {
      session: {
        type: 'apiKey',
        in: 'cookie',
        name: 'gym_session',
        description:
          'Opaque secret, HttpOnly, Secure in production, SameSite=Lax; HTTPS in production. Local loopback HTTP may omit Secure. Never expose the secret in JSON.',
      },
      csrf: { type: 'apiKey', in: 'header', name: 'X-CSRF-Token' },
    },
    schemas,
  },
};
await SwaggerParser.validate(structuredClone(document));
const output = await prettier.format(
  YAML.stringify(document, { lineWidth: 0 }),
  { parser: 'yaml', singleQuote: true },
);
const destination = new URL('../docs/openapi.yaml', import.meta.url);
if (process.argv.includes('--check')) {
  if ((await readFile(destination, 'utf8')) !== output)
    throw new Error('OpenAPI is stale; run npm run docs:generate');
  console.log('OpenAPI validates and matches the shared schemas');
} else {
  await writeFile(destination, output);
  console.log('Generated and validated docs/openapi.yaml');
}
