import assert from 'node:assert/strict';
import { test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';

test('health is minimal and missing routes return JSON', async () => {
  const app = createApp();
  const health = await request(app).get('/api/v1/health').expect(200);
  assert.deepEqual(health.body, { status: 'ok' });
  assert.equal(health.headers['x-powered-by'], undefined);
  const missing = await request(app).get('/api/v1/missing').expect(404);
  assert.equal(missing.body.error.code, 'NOT_FOUND');
});

test('malformed and oversized request bodies return sanitized errors', async () => {
  const app = createApp();
  const malformed = await request(app)
    .post('/api/v1/missing')
    .set('Content-Type', 'application/json')
    .send('{"secret":')
    .expect(400);
  assert.deepEqual(malformed.body, {
    error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON' },
  });
  const large = await request(app)
    .post('/api/v1/missing')
    .send({ secret: 'x'.repeat(40000) })
    .expect(413);
  assert.equal(large.body.error.code, 'BODY_TOO_LARGE');
});
