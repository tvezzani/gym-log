import type { ApiErrorResponse } from '@gym-log/contracts';
import type { ZodType } from 'zod';
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: ApiErrorResponse['error']['code'],
    message: string,
    public fieldErrors?: { path: string; message: string }[],
    public retryAfter?: number,
  ) {
    super(message);
  }
}
export function parse<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new HttpError(
      422,
      'VALIDATION_ERROR',
      'Invalid request',
      result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    );
  return result.data;
}
