import { z } from 'zod';
import {
  idSchema,
  nameSchema,
  timestampSchema,
  exerciseStatusSchema,
  paginationQuerySchema,
  paginationSchema,
} from './primitives.js';

export const exerciseSchema = z.strictObject({
  id: idSchema,
  name: nameSchema,
  status: exerciseStatusSchema,
  submittedBy: idSchema,
  reviewedBy: idSchema.nullable(),
  reviewedAt: timestampSchema.nullable(),
  archivedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export const exerciseCreateSchema = z.strictObject({ name: nameSchema });
export const exercisePatchSchema = z
  .strictObject({
    name: nameSchema.optional(),
    isArchived: z.boolean().optional(),
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    'Provide at least one field',
  );
export const exerciseListQuerySchema = paginationQuerySchema;
export const exerciseReviewQuerySchema = paginationQuerySchema.extend({
  status: exerciseStatusSchema.default('pending'),
});
export const exerciseListSchema = z.strictObject({
  items: z.array(exerciseSchema),
  pagination: paginationSchema,
});
export type Exercise = z.infer<typeof exerciseSchema>;

export function canSelectExercise(
  exercise: Pick<Exercise, 'status' | 'submittedBy' | 'archivedAt'>,
  userId: string,
): boolean {
  return (
    exercise.archivedAt === null &&
    (exercise.status === 'approved' ||
      (exercise.status === 'pending' &&
        exercise.submittedBy.toLowerCase() === userId.toLowerCase()))
  );
}
export function canRetainExercise(
  existingId: string,
  selectedId: string,
  exercise: Pick<Exercise, 'status' | 'submittedBy' | 'archivedAt'>,
  userId: string,
): boolean {
  return (
    existingId.toLowerCase() === selectedId.toLowerCase() ||
    canSelectExercise(exercise, userId)
  );
}
