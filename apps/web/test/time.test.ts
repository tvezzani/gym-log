import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  dayBounds,
  historyBounds,
  performedInstant,
  repeatedTime,
  wallTime,
  shiftDate,
} from '../src/time.ts';
import { createPayload, makeDraft } from '../src/draft.ts';
test('stored timezone produces real 23/25-hour day bounds and stable calendar dates', () => {
  for (const [date, start, end, hours] of [
    ['2026-03-08', '2026-03-08T07:00:00.000Z', '2026-03-09T06:00:00.000Z', 23],
    ['2026-11-01', '2026-11-01T06:00:00.000Z', '2026-11-02T07:00:00.000Z', 25],
  ] as const) {
    const bounds = dayBounds(date, 'America/Denver');
    assert.deepEqual(bounds, { start, end });
    assert.equal(
      (Date.parse(bounds.end) - Date.parse(bounds.start)) / 3600000,
      hours,
    );
  }
  assert.equal(shiftDate('2026-12-31', 1), '2027-01-01');
  assert.equal(
    wallTime('2026-10-22T05:10:12.123Z', 'America/Denver'),
    '2026-10-21T23:10:12.123',
  );
});
test('performed times reject nonexistent local times and explicitly distinguish repeated times', () => {
  assert.throws(
    () => performedInstant('2026-03-08T02:30:00.123', 'America/Denver'),
    /does not exist/,
  );
  assert.equal(repeatedTime('2026-11-01T01:30:00.123', 'America/Denver'), true);
  assert.equal(
    performedInstant('2026-11-01T01:30:00.123', 'America/Denver', 'earlier'),
    '2026-11-01T07:30:00.123Z',
  );
  assert.equal(
    performedInstant('2026-11-01T01:30:00.123', 'America/Denver', 'later'),
    '2026-11-01T08:30:00.123Z',
  );
});
test('fresh set defaults are independent and decimal text survives payload creation', () => {
  const draft = makeDraft(
    'owner',
    'America/Denver',
    '2026-10-21',
    'a3b65f0f-fc21-4fe8-81a4-bc9e1ecc0002',
  );
  assert.equal(draft.fields.setNumber, '1');
  assert.equal(draft.fields.rpe, '5');
  assert.equal(draft.fields.weight, '');
  draft.fields.weight = '135.125';
  draft.fields.reps = '10';
  draft.fields.localTime = '2026-10-21T12:34:56.123';
  const input = createPayload(draft, 'a3b65f0f-fc21-4fe8-81a4-bc9e1ecc0003');
  assert.equal(input.weight, '135.125');
  assert.equal(input.performedAt, '2026-10-21T18:34:56.123Z');
  draft.fields.reps = '1.5';
  assert.throws(() => createPayload(draft, input.id));
});

test('history bounds remain valid at the supported calendar extremes', () => {
  assert.equal(
    historyBounds('0001-01-01', 'Asia/Tokyo').start,
    '0001-01-01T00:00:00.000Z',
  );
  assert.deepEqual(historyBounds('9999-12-31', 'America/Denver'), {
    start: '9999-12-31T07:00:00.000Z',
  });
});
