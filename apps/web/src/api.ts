import { apiErrorSchema } from '@gym-log/contracts';
import type { ZodType } from 'zod';
export class ApiError extends Error {
  constructor(
    message: string,
    public status = 0,
    public code = 'NETWORK',
    public uncertain = false,
    public fields: { path: string; message: string }[] = [],
  ) {
    super(message);
  }
}
export const api = {
  csrf: '',
  onAuthError: (_error: ApiError) => {},
  async request<T>(
    path: string,
    schema: ZodType<T>,
    method = 'GET',
    body?: unknown,
  ): Promise<T> {
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 15000);
    const write = method !== 'GET';
    try {
      const response = await fetch(`/api/v1${path}`, {
        method,
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
        headers: {
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(write ? { 'X-CSRF-Token': api.csrf } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok) {
        const parsed = apiErrorSchema.safeParse(
          await response.json().catch(() => null),
        );
        const e = new ApiError(
          parsed.success
            ? parsed.data.error.message
            : `Request failed (${response.status})`,
          response.status,
          parsed.success ? parsed.data.error.code : 'HTTP',
          write && response.status >= 500,
          parsed.success ? (parsed.data.error.fieldErrors ?? []) : [],
        );
        if (
          e.code === 'PASSWORD_CHANGE_REQUIRED' ||
          (e.status === 401 &&
            !['/auth/login', '/auth/password'].includes(path))
        )
          api.onAuthError(e);
        throw e;
      }
      const parsed = schema.safeParse(
        response.status === 204 ? undefined : await response.json(),
      );
      if (!parsed.success)
        throw new ApiError(
          'The server response could not be verified. Please retry.',
          0,
          'RESPONSE',
          write,
        );
      return parsed.data;
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError(
        'Could not reach the server. Check your connection and try again.',
        0,
        'NETWORK',
        write,
      );
    } finally {
      clearTimeout(timer);
    }
  },
};
export const message = (error: unknown) =>
  error instanceof Error ? error.message : 'Something went wrong. Try again.';
export async function allPages<T>(
  path: string,
  schema: ZodType<{ items: T[]; pagination: { hasMore: boolean } }>,
): Promise<T[]> {
  const items: T[] = [];
  for (let offset = 0; offset <= 100000; offset += 100) {
    const page = await api.request(
      `${path}${path.includes('?') ? '&' : '?'}limit=100&offset=${offset}`,
      schema,
    );
    items.push(...page.items);
    if (!page.pagination.hasMore) return items;
  }
  throw new ApiError(
    'This list is too large. Narrow the date or exercise filter.',
  );
}
