import type { Request, Response } from 'express';
import type { Pool, PoolClient } from 'pg';
import type { ZodType } from 'zod';
import {
  canSelectExercise,
  normalizeWeight,
  type Exercise,
  type Workout,
  type Plan,
} from '@gym-log/contracts';
import { HttpError, parse } from '../errors.js';
import { authorizedTransaction, type AuthContext } from '../auth/service.js';

export function body<T>(req: Request, schema: ZodType<T>): T {
  if (!req.is('application/json'))
    throw new HttpError(
      415,
      'UNSUPPORTED_ENCODING',
      'Content-Type must be application/json',
    );
  return parse(schema, req.body);
}
export function run<T>(
  pool: Pool,
  res: Response,
  work: (db: PoolClient, owner: string) => Promise<T>,
  admin = false,
): Promise<T> {
  const auth = res.locals.auth as AuthContext | undefined;
  if (!auth)
    throw new HttpError(401, 'UNAUTHENTICATED', 'Authentication required');
  if (admin && auth.user.role !== 'admin')
    throw new HttpError(403, 'FORBIDDEN', 'Admin role required');
  return authorizedTransaction(pool, auth, { admin }, (db, fresh) =>
    work(db, fresh.user.id),
  );
}
export const page = <T>(
  rows: T[],
  input: { limit: number; offset: number },
) => ({
  items: rows.slice(0, input.limit),
  pagination: {
    limit: input.limit,
    offset: input.offset,
    hasMore: rows.length > input.limit,
  },
});
export interface ExerciseRow {
  id: string;
  name: string;
  status: Exercise['status'];
  submitted_by: string;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
}
interface ReferenceRow {
  exercise_id: string;
  exercise_name: string;
  exercise_status: Exercise['status'];
  exercise_archived_at: Date | null;
}
export interface WorkoutRow extends ReferenceRow {
  id: string;
  user_id: string;
  performed_at: Date;
  reps: string;
  weight: string;
  set_number: string;
  rpe: string;
  created_at: Date;
  updated_at: Date;
}
export interface PlanRow extends ReferenceRow {
  id: string;
  user_id: string;
  planned_date: string;
  notes: string;
  sort_order: number;
  created_at: Date;
  updated_at: Date;
}
export const exerciseDTO = (row: ExerciseRow): Exercise => ({
  id: row.id,
  name: row.name,
  status: row.status,
  submittedBy: row.submitted_by,
  reviewedBy: row.reviewed_by,
  reviewedAt: row.reviewed_at?.toISOString() ?? null,
  archivedAt: row.archived_at?.toISOString() ?? null,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});
const reference = (row: ReferenceRow) => ({
  id: row.exercise_id,
  name: row.exercise_name,
  status: row.exercise_status,
  archivedAt: row.exercise_archived_at?.toISOString() ?? null,
});
export const workoutDTO = (row: WorkoutRow): Workout => ({
  id: row.id,
  userId: row.user_id,
  exerciseId: row.exercise_id,
  exercise: reference(row),
  performedAt: row.performed_at.toISOString(),
  reps: Number(row.reps),
  weight: normalizeWeight(row.weight),
  setNumber: Number(row.set_number),
  rpe: Number(row.rpe),
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});
export const planDTO = (row: PlanRow): Plan => ({
  id: row.id,
  userId: row.user_id,
  exerciseId: row.exercise_id,
  exercise: reference(row),
  plannedDate: row.planned_date,
  notes: row.notes,
  sortOrder: row.sort_order,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});
export const workoutSelect = `SELECT w.*,e.name AS exercise_name,e.status AS exercise_status,e.archived_at AS exercise_archived_at FROM app.workouts w JOIN app.exercises e ON e.id=w.exercise_id`;
export const planSelect = `SELECT p.id,p.user_id,p.exercise_id,p.planned_date::text AS planned_date,p.notes,p.sort_order,p.created_at,p.updated_at,e.name AS exercise_name,e.status AS exercise_status,e.archived_at AS exercise_archived_at FROM app.planned_exercises p JOIN app.exercises e ON e.id=p.exercise_id`;
export async function ownedWorkout(
  db: PoolClient,
  id: string,
  owner: string,
  lock = false,
): Promise<WorkoutRow | null> {
  return (
    (
      await db.query<WorkoutRow>(
        `${workoutSelect} WHERE w.id=$1 AND w.user_id=$2${lock ? ' FOR UPDATE OF w' : ''}`,
        [id, owner],
      )
    ).rows[0] ?? null
  );
}
export async function ownedPlan(
  db: PoolClient,
  id: string,
  owner: string,
  lock = false,
): Promise<PlanRow | null> {
  return (
    (
      await db.query<PlanRow>(
        `${planSelect} WHERE p.id=$1 AND p.user_id=$2${lock ? ' FOR UPDATE OF p' : ''}`,
        [id, owner],
      )
    ).rows[0] ?? null
  );
}
export async function eligibleExercise(
  db: PoolClient,
  id: string,
  owner: string,
): Promise<ExerciseRow> {
  const row = (
    await db.query<ExerciseRow>(
      'SELECT * FROM app.exercises WHERE id=$1 FOR SHARE',
      [id],
    )
  ).rows[0];
  if (!row || (row.status !== 'approved' && row.submitted_by !== owner))
    throw new HttpError(404, 'NOT_FOUND', 'Exercise not found');
  if (
    !canSelectExercise(
      {
        status: row.status,
        submittedBy: row.submitted_by,
        archivedAt: row.archived_at?.toISOString() ?? null,
      },
      owner,
    )
  )
    throw new HttpError(
      409,
      'EXERCISE_UNAVAILABLE',
      'Exercise is unavailable for new entries',
    );
  return row;
}
export async function lockPlanDates(
  db: PoolClient,
  owner: string,
  dates: string[],
): Promise<void> {
  for (const date of [...new Set(dates)].sort())
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `plan:${owner}:${date}`,
    ]);
}
export async function appendPosition(
  db: PoolClient,
  owner: string,
  date: string,
): Promise<number> {
  const row = (
    await db.query<{ count: number; last: number }>(
      'SELECT count(*)::int AS count,COALESCE(max(sort_order),-1)::int AS last FROM app.planned_exercises WHERE user_id=$1 AND planned_date=$2::date',
      [owner, date],
    )
  ).rows[0]!;
  if (row.count >= 500 || row.last >= 2147483647)
    throw new HttpError(
      409,
      'CONFLICT',
      'Plan date is full; reorder or remove an entry',
    );
  return row.last + 1;
}
