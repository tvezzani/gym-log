import express, { type ErrorRequestHandler } from 'express';
import type { Pool } from 'pg';
import type { ApiErrorResponse, HealthResponse } from '@gym-log/contracts';
import type { Config } from './config.js';
import { HttpError } from './errors.js';
import { createAuthRouter } from './auth/routes.js';
import { createDomainRouter } from './domain/routes.js';

export function createApp(options?: { pool: Pool; config: Config }) {
  const app = express();
  app.disable('x-powered-by');
  if (options?.config.TRUST_PROXY === 'loopback')
    app.set('trust proxy', 'loopback');
  app.use(express.json({ limit: '32kb' }));
  app.get('/api/v1/health', (_req, res) =>
    res.json({ status: 'ok' } satisfies HealthResponse),
  );
  if (options) {
    // Auth router establishes fresh session/CSRF guards before domain handlers.
    app.use(
      '/api/v1',
      createAuthRouter(options.pool, options.config),
      createDomainRouter(options.pool),
    );
  }
  app.use((_req, res) =>
    res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'Route not found' },
    } satisfies ApiErrorResponse),
  );
  const handleError: ErrorRequestHandler = (
    error: unknown,
    _req,
    res,
    _next,
  ) => {
    if (error instanceof HttpError) {
      if (error.retryAfter) res.set('Retry-After', String(error.retryAfter));
      const result: ApiErrorResponse = {
        error: { code: error.code, message: error.message },
      };
      if (error.fieldErrors) result.error.fieldErrors = error.fieldErrors;
      res.set('Cache-Control', 'no-store').status(error.status).json(result);
      return;
    }
    const status =
      typeof error === 'object' && error !== null && 'status' in error
        ? error.status
        : undefined;
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? error.code
        : undefined;
    const errors: Record<number, ApiErrorResponse['error']> = {
      400: { code: 'INVALID_JSON', message: 'Request body must be valid JSON' },
      413: {
        code: 'BODY_TOO_LARGE',
        message: 'Request body exceeds the limit',
      },
      415: {
        code: 'UNSUPPORTED_ENCODING',
        message: 'Unsupported request encoding',
      },
    };
    if (typeof status === 'number' && errors[status]) {
      res.status(status).json({ error: errors[status] });
      return;
    }
    if (code === '23505' || code === '23503') {
      res.status(409).json({
        error: { code: 'CONFLICT', message: 'Resource conflict' },
      } satisfies ApiErrorResponse);
      return;
    }
    if (code === '23514') {
      res.status(422).json({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid request' },
      } satisfies ApiErrorResponse);
      return;
    }
    console.error('Request failed');
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Request failed' },
    } satisfies ApiErrorResponse);
  };
  app.use(handleError);
  return app;
}
