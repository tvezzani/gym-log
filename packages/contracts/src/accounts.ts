import { z } from 'zod';
import {
  idSchema,
  timestampSchema,
  usernameSchema,
  timeZoneSchema,
  roleSchema,
  passwordSchema,
  paginationQuerySchema,
  paginationSchema,
} from './primitives.js';

export const userSchema = z.strictObject({
  id: idSchema,
  username: usernameSchema,
  role: roleSchema,
  isActive: z.boolean(),
  mustChangePassword: z.boolean(),
  timeZone: timeZoneSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export const csrfSchema = z.strictObject({
  csrfToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
export const authSchema = csrfSchema.extend({ user: userSchema });
export const loginSchema = z.strictObject({
  username: usernameSchema,
  password: z.string().min(1).max(128),
});
export const passwordChangeSchema = z
  .strictObject({
    currentPassword: z.string().min(1).max(128),
    newPassword: passwordSchema,
  })
  .refine((value) => value.currentPassword !== value.newPassword, {
    message: 'Choose a different password',
    path: ['newPassword'],
  });
export const accountCreateSchema = z.strictObject({
  username: usernameSchema,
  password: passwordSchema,
  role: roleSchema.default('user'),
  timeZone: timeZoneSchema,
});
export const accountPatchSchema = z
  .strictObject({
    role: roleSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    'Provide at least one field',
  );
export const accountResetSchema = z.strictObject({
  temporaryPassword: passwordSchema,
});
export const preferencesPatchSchema = z.strictObject({
  timeZone: timeZoneSchema,
});
export const accountListQuerySchema = paginationQuerySchema;
export const accountListSchema = z.strictObject({
  items: z.array(userSchema),
  pagination: paginationSchema,
});
export type User = z.infer<typeof userSchema>;
export type AccountCreate = z.input<typeof accountCreateSchema>;

export const setupStatusSchema = z.strictObject({ setupRequired: z.boolean() });
export const setupCreateSchema = accountCreateSchema.omit({ role: true });
export type SetupCreate = z.infer<typeof setupCreateSchema>;
