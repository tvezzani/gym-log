/* eslint-disable no-control-regex -- Exercise names must explicitly reject control characters. */
import { z } from 'zod';

export const idSchema = z.uuid();
export const timestampSchema = z.iso
  .datetime({ offset: true, precision: 3 })
  .refine((value) => {
    const date = new Date(value);
    return (
      Number.isFinite(date.valueOf()) &&
      date.getUTCFullYear() >= 1 &&
      date.getUTCFullYear() <= 9999
    );
  }, 'Invalid instant or unsupported year')
  .describe(
    'ISO 8601 instant with exactly three fractional digits and Z or a numeric offset; responses use UTC Z. Finer precision is rejected.',
  );
export const dateSchema = z
  .string()
  .regex(/^(?!0000)\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const instant = new Date(`${value}T00:00:00.000Z`);
    return (
      Number.isFinite(instant.valueOf()) &&
      instant.toISOString().slice(0, 10) === value
    );
  }, 'Expected a real calendar date')
  .describe(
    'Real YYYY-MM-DD calendar date, years 0001–9999. No timezone conversion.',
  );
export const weightSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,4})(?:\.\d{1,3})?$/)
  .describe(
    'Decimal pounds from 0 to 99999.999. No sign, exponent, leading zeros, or more than three decimal places; never a JSON number. Responses remove trailing fractional zeros.',
  );
export const positiveIntSchema = z.number().int().min(1).max(2147483647);
export const rpeSchema = z.number().int().min(1).max(10);
export const nameSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(
    /^[^\s\u0000-\u001f\u007f](?:[^\u0000-\u001f\u007f]*[^\s\u0000-\u001f\u007f])?$/,
  )
  .describe(
    '1–120 characters, no surrounding whitespace or ASCII control characters. Names need not be unique; IDs identify exercises.',
  );
export const usernameSchema = z
  .string()
  .regex(/^[a-z0-9_]{3,32}$/)
  .describe(
    'Canonical lowercase ASCII username, 3–32 letters, digits or underscore. API username fields require this canonical form; UI may lowercase input.',
  );
export const passwordSchema = z
  .string()
  .min(12)
  .max(128)
  .describe(
    '12–128 characters; never trimmed or normalized. No default password.',
  );
export const timeZoneSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z_]+(?:\/[A-Za-z0-9_+.-]+)*$/)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'Expected an IANA timezone')
  .describe(
    'IANA timezone supported by the server; UTC is allowed. Stored explicitly, never changed automatically while traveling.',
  );
export const roleSchema = z.enum(['user', 'admin']);
export const exerciseStatusSchema = z.enum(['pending', 'approved', 'rejected']);
export const paginationQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
});
export const paginationSchema = z.strictObject({
  limit: z.number().int().min(1).max(100),
  offset: z.number().int().min(0).max(100000),
  hasMore: z.boolean(),
});
export const healthSchema = z.strictObject({ status: z.literal('ok') });
export const apiErrorSchema = z.strictObject({
  error: z.strictObject({
    code: z.enum([
      'VALIDATION_ERROR',
      'UNAUTHENTICATED',
      'PASSWORD_CHANGE_REQUIRED',
      'FORBIDDEN',
      'NOT_FOUND',
      'CONFLICT',
      'GONE',
      'EXERCISE_UNAVAILABLE',
      'RATE_LIMITED',
      'INVALID_JSON',
      'BODY_TOO_LARGE',
      'UNSUPPORTED_ENCODING',
      'INTERNAL_ERROR',
    ]),
    message: z.string(),
    fieldErrors: z
      .array(z.strictObject({ path: z.string(), message: z.string() }))
      .optional(),
  }),
});
export type HealthResponse = z.infer<typeof healthSchema>;
export type ApiErrorResponse = z.infer<typeof apiErrorSchema>;
