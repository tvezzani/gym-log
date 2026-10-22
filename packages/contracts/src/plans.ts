import { z } from 'zod';
import {
  idSchema,
  timestampSchema,
  dateSchema,
  paginationQuerySchema,
  paginationSchema,
} from './primitives.js';
import { exerciseReferenceSchema } from './workouts.js';

const editable = z.strictObject({
  exerciseId: idSchema,
  plannedDate: dateSchema,
  notes: z.string().max(2000),
});
export const planCreateSchema = editable.extend({
  notes: z.string().max(2000).default(''),
});
export const planPatchSchema = editable
  .partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    'Provide at least one field',
  );
export const planSchema = editable.extend({
  id: idSchema,
  userId: idSchema,
  sortOrder: z.number().int().min(0).max(2147483647),
  exercise: exerciseReferenceSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export const planListQuerySchema = paginationQuerySchema.extend({
  plannedDate: dateSchema,
});
export const planListSchema = z.strictObject({
  items: z.array(planSchema),
  pagination: paginationSchema,
});
export const planReorderSchema = z
  .strictObject({
    plannedDate: dateSchema,
    orderedIds: z.array(idSchema).max(500),
  })
  .refine(
    (value) =>
      new Set(value.orderedIds.map((id) => id.toLowerCase())).size ===
      value.orderedIds.length,
    'Each ID must appear once',
  );
export type Plan = z.infer<typeof planSchema>;
