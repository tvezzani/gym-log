import { z } from 'zod';
import {
  idSchema,
  nameSchema,
  timestampSchema,
  weightSchema,
  positiveIntSchema,
  rpeSchema,
  exerciseStatusSchema,
  paginationQuerySchema,
  paginationSchema,
} from './primitives.js';

export const exerciseReferenceSchema = z.strictObject({
  id: idSchema,
  name: nameSchema,
  status: exerciseStatusSchema,
  archivedAt: timestampSchema.nullable(),
});
const editable = z.strictObject({
  exerciseId: idSchema,
  performedAt: timestampSchema,
  reps: positiveIntSchema,
  weight: weightSchema,
  setNumber: positiveIntSchema,
  rpe: rpeSchema,
});
export const workoutCreateSchema = editable.extend({
  id: idSchema,
  setNumber: positiveIntSchema.default(1),
  rpe: rpeSchema.default(5),
});
export const workoutPatchSchema = editable
  .partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    'Provide at least one field',
  );
export const workoutSchema = editable.extend({
  id: idSchema,
  userId: idSchema,
  exercise: exerciseReferenceSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export const workoutListQuerySchema = paginationQuerySchema
  .extend({
    exerciseId: idSchema.optional(),
    start: timestampSchema.optional(),
    end: timestampSchema.optional(),
  })
  .refine(
    (value) =>
      !value.start ||
      !value.end ||
      Date.parse(value.start) < Date.parse(value.end),
    'start must precede end',
  );
export const workoutListSchema = z.strictObject({
  items: z.array(workoutSchema),
  pagination: paginationSchema,
});

export function canonicalWorkoutCreate(input: unknown): string {
  const value = workoutCreateSchema.parse(input);
  const [whole, rawFraction] = value.weight.split('.');
  const fraction = rawFraction?.replace(/0+$/, '');
  return JSON.stringify({
    id: value.id.toLowerCase(),
    exerciseId: value.exerciseId.toLowerCase(),
    performedAt: new Date(value.performedAt).toISOString(),
    reps: value.reps,
    weight: fraction ? `${whole}.${fraction}` : whole,
    setNumber: value.setNumber,
    rpe: value.rpe,
  });
}
export type WorkoutCreate = z.input<typeof workoutCreateSchema>;
export type Workout = z.infer<typeof workoutSchema>;
