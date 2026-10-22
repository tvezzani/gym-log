import { nameSchema } from '../src/primitives.js';
import {
  canSelectExercise,
  canRetainExercise,
  contractSchemas,
} from '../src/index.js';
import { examples } from '../src/examples.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  dateSchema,
  timestampSchema,
  weightSchema,
  timeZoneSchema,
  positiveIntSchema,
  rpeSchema,
} from '../src/primitives.js';
import {
  workoutCreateSchema,
  workoutPatchSchema,
  workoutListQuerySchema,
  canonicalWorkoutCreate,
} from '../src/workouts.js';
import { planReorderSchema } from '../src/plans.js';

const request = {
  id: 'a3b65f0f-fc21-4fe8-81a4-bc9e1ecc0001',
  exerciseId: 'a3b65f0f-fc21-4fe8-81a4-bc9e1ecc0002',
  performedAt: '2026-10-21T12:34:56.123-06:00',
  reps: 10,
  weight: '135.500',
};

test('weights are bounded decimal strings without rounding or float conversion', () => {
  for (const value of ['0', '0.001', '135.500', '99999.999'])
    assert.ok(weightSchema.safeParse(value).success, value);
  for (const value of [
    1.5,
    '-1',
    '1e3',
    '1.0001',
    '100000',
    '01',
    '.5',
    'NaN',
    'Infinity',
    ' 1',
  ])
    assert.equal(weightSchema.safeParse(value).success, false, String(value));
});

test('calendar dates reject overflow and leap errors without changing their day', () => {
  for (const value of ['2024-02-29', '2026-10-21', '0001-01-01', '9999-12-31'])
    assert.equal(dateSchema.parse(value), value);
  for (const value of [
    '2026-02-29',
    '2026-04-31',
    '2026-13-01',
    '2026-00-01',
    '0000-01-01',
    '2026-1-01',
    '2026-10-21T00:00:00Z',
  ])
    assert.equal(dateSchema.safeParse(value).success, false, value);
  assert.ok(timeZoneSchema.safeParse('America/Denver').success);
  assert.ok(timeZoneSchema.safeParse('UTC').success);
  assert.equal(timeZoneSchema.safeParse('Definitely/Unknown').success, false);
});

test('timestamps require an explicit offset and exactly millisecond precision', () => {
  assert.ok(timestampSchema.safeParse(request.performedAt).success);
  assert.ok(timestampSchema.safeParse('2026-10-21T18:34:56.123Z').success);
  for (const value of [
    '2026-10-21T18:34:56.1234Z',
    '2026-10-21T18:34:56.123',
    '2026-02-30T18:34:56.123Z',
    '2026-10-21',
  ])
    assert.equal(timestampSchema.safeParse(value).success, false, value);
});

test('retry normalization preserves one identity across defaults, offsets, and decimal spellings', () => {
  const normalized = canonicalWorkoutCreate(request);
  assert.equal(
    normalized,
    canonicalWorkoutCreate({
      ...request,
      weight: '135.5',
      rpe: 5,
      setNumber: 1,
      performedAt: '2026-10-21T18:34:56.123Z',
    }),
  );
  assert.notEqual(normalized, canonicalWorkoutCreate({ ...request, reps: 11 }));
  assert.equal(workoutCreateSchema.parse(request).rpe, 5);
  assert.equal(workoutCreateSchema.parse(request).setNumber, 1);
  assert.equal(
    workoutCreateSchema.safeParse({ ...request, userId: request.id }).success,
    false,
  );
  assert.equal(workoutPatchSchema.safeParse({}).success, false);
  assert.deepEqual(workoutPatchSchema.parse({ reps: 12 }), { reps: 12 });
});

test('integer bounds, ordering bounds, and full reorder IDs are validated', () => {
  for (const value of [0, -1, 1.5, 2147483648, NaN])
    assert.equal(positiveIntSchema.safeParse(value).success, false);
  for (const value of [0, 11, 5.5])
    assert.equal(rpeSchema.safeParse(value).success, false);
  assert.deepEqual(workoutListQuerySchema.parse({}), { limit: 50, offset: 0 });
  assert.equal(
    workoutListQuerySchema.safeParse({ limit: '101' }).success,
    false,
  );
  assert.equal(
    workoutListQuerySchema.safeParse({
      start: '2026-10-22T00:00:00.000Z',
      end: '2026-10-21T00:00:00.000Z',
    }).success,
    false,
  );
  assert.equal(
    planReorderSchema.safeParse({
      plannedDate: '2026-10-21',
      orderedIds: [request.id, request.id],
    }).success,
    false,
  );
});

test('exercise selection distinguishes own pending, shared approved, and retained unavailable references', () => {
  const own = {
    status: 'pending' as const,
    submittedBy: request.id,
    archivedAt: null,
  };
  assert.equal(canSelectExercise(own, request.id), true);
  assert.equal(canSelectExercise(own, request.exerciseId), false);
  assert.equal(
    canSelectExercise({ ...own, status: 'approved' }, request.exerciseId),
    true,
  );
  assert.equal(
    canSelectExercise({ ...own, status: 'rejected' }, request.id),
    false,
  );
  assert.equal(
    canSelectExercise(
      { ...own, status: 'approved', archivedAt: request.performedAt },
      request.id,
    ),
    false,
  );
  assert.equal(
    canRetainExercise(
      request.exerciseId,
      request.exerciseId,
      { ...own, status: 'rejected' },
      request.id,
    ),
    true,
  );
});

test('all documented request and response examples match runtime contracts', () => {
  for (const [name, schema] of Object.entries(contractSchemas)) {
    assert.ok(
      schema.safeParse(examples[name as keyof typeof examples]).success,
      name,
    );
  }
});

test('names reject control characters and retry UUID normalization is case-insensitive', () => {
  for (const value of ['\u0000', 'bad\nname', ' Leading', 'Trailing '])
    assert.equal(nameSchema.safeParse(value).success, false);
  assert.equal(
    canonicalWorkoutCreate({
      ...request,
      id: request.id.toUpperCase(),
      exerciseId: request.exerciseId.toUpperCase(),
    }),
    canonicalWorkoutCreate(request),
  );
});
