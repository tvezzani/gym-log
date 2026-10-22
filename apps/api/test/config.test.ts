import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readConfig } from '../src/config.js';
const base = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://example:secret@localhost/test',
  AUTH_SECRET: 'a'.repeat(64),
  APP_ORIGIN: 'http://127.0.0.1:3000',
};
test('auth config requires a secret and an exact secure origin with explicit proxy trust', () => {
  assert.equal(readConfig(base).TRUST_PROXY, 'none');
  assert.throws(
    () => readConfig({ ...base, AUTH_SECRET: 'private-invalid-value' }),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes('AUTH_SECRET') &&
      !error.message.includes('private-invalid-value'),
  );
  assert.throws(() => readConfig({ ...base, NODE_ENV: 'production' }));
  assert.throws(() =>
    readConfig({ ...base, APP_ORIGIN: 'http://example.test' }),
  );
  assert.throws(() =>
    readConfig({ ...base, APP_ORIGIN: 'http://127.0.0.1:3000/path' }),
  );
  assert.equal(
    readConfig({
      ...base,
      NODE_ENV: 'production',
      APP_ORIGIN: 'https://gym.example.test',
      TRUST_PROXY: 'loopback',
    }).TRUST_PROXY,
    'loopback',
  );
});
