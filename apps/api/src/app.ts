import express, { type ErrorRequestHandler } from 'express';
import type { ApiErrorResponse, HealthResponse } from '@gym-log/contracts';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));
  app.get('/api/v1/health', (_req, res) => {
    res.json({ status: 'ok' } satisfies HealthResponse);
  });
  app.use((_req, res) => {
    res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'Route not found' },
    } satisfies ApiErrorResponse);
  });
  const handleError: ErrorRequestHandler = (
    error: unknown,
    _req,
    res,
    _next,
  ) => {
    const status =
      typeof error === 'object' && error !== null && 'status' in error
        ? error.status
        : undefined;
    if (status === 400 || status === 413 || status === 415) {
      const errors: Record<400 | 413 | 415, ApiErrorResponse['error']> = {
        400: {
          code: 'INVALID_JSON',
          message: 'Request body must be valid JSON',
        },
        413: {
          code: 'BODY_TOO_LARGE',
          message: 'Request body exceeds the limit',
        },
        415: {
          code: 'UNSUPPORTED_ENCODING',
          message: 'Unsupported request encoding',
        },
      };
      res
        .status(status)
        .json({ error: errors[status] } satisfies ApiErrorResponse);
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
