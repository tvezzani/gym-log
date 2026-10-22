import { z } from 'zod';
const schema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().url(),
  AUTH_SECRET: z.string().regex(/^[0-9a-f]{64}$/i),
  APP_ORIGIN: z.string().url().default('http://127.0.0.1:3000'),
  TRUST_PROXY: z.enum(['none', 'loopback']).default('none'),
});
export type Config = z.infer<typeof schema>;
export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = schema.safeParse(env);
  if (!result.success)
    throw new Error(
      `Invalid environment fields: ${result.error.issues.map((i) => i.path.join('.')).join(', ')}`,
    );
  const origin = new URL(result.data.APP_ORIGIN);
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname);
  if (
    origin.origin !== result.data.APP_ORIGIN ||
    origin.username ||
    origin.password ||
    (result.data.NODE_ENV === 'production'
      ? origin.protocol !== 'https:'
      : origin.protocol !== 'https:' && !(local && origin.protocol === 'http:'))
  )
    throw new Error(
      'APP_ORIGIN must be an exact HTTPS origin (loopback HTTP is permitted in development/test)',
    );
  return result.data;
}
