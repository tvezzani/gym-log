import { Router } from 'express';
import type { Pool } from 'pg';
import {
  exerciseCreateSchema,
  exercisePatchSchema,
  exerciseListQuerySchema,
  exerciseReviewQuerySchema,
  idSchema,
} from '@gym-log/contracts';
import { parse, HttpError } from '../errors.js';
import { body, run, page, exerciseDTO, type ExerciseRow } from './common.js';

export function exerciseRouter(pool: Pool) {
  const router = Router();
  router.get('/exercises', async (req, res) => {
    const input = parse(exerciseListQuerySchema, req.query);
    const rows = await run(
      pool,
      res,
      async (db) =>
        (
          await db.query<ExerciseRow>(
            "SELECT * FROM app.exercises WHERE status='approved' AND archived_at IS NULL ORDER BY lower(name),id LIMIT $1 OFFSET $2",
            [input.limit + 1, input.offset],
          )
        ).rows,
    );
    res.json(page(rows.map(exerciseDTO), input));
  });
  router.post('/exercises', async (req, res) => {
    const input = body(req, exerciseCreateSchema);
    const result = await run(pool, res, async (db, owner) =>
      exerciseDTO(
        (
          await db.query<ExerciseRow>(
            'INSERT INTO app.exercises(name,submitted_by) VALUES($1,$2) RETURNING *',
            [input.name, owner],
          )
        ).rows[0]!,
      ),
    );
    res.status(201).json(result);
  });
  router.get('/exercise-submissions', async (req, res) => {
    const input = parse(exerciseListQuerySchema, req.query);
    const rows = await run(
      pool,
      res,
      async (db, owner) =>
        (
          await db.query<ExerciseRow>(
            'SELECT * FROM app.exercises WHERE submitted_by=$1 ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3',
            [owner, input.limit + 1, input.offset],
          )
        ).rows,
    );
    res.json(page(rows.map(exerciseDTO), input));
  });
  router.get('/admin/exercises', async (req, res) => {
    const input = parse(exerciseReviewQuerySchema, req.query);
    const rows = await run(
      pool,
      res,
      async (db) =>
        (
          await db.query<ExerciseRow>(
            'SELECT * FROM app.exercises WHERE status=$1 ORDER BY created_at,id LIMIT $2 OFFSET $3',
            [input.status, input.limit + 1, input.offset],
          )
        ).rows,
      true,
    );
    res.json(page(rows.map(exerciseDTO), input));
  });
  router.patch('/exercises/:id', async (req, res) => {
    const id = parse(idSchema, req.params.id).toLowerCase(),
      input = body(req, exercisePatchSchema);
    const result = await run(
      pool,
      res,
      async (db) => {
        const row = (
          await db.query<ExerciseRow>(
            'SELECT * FROM app.exercises WHERE id=$1 FOR UPDATE',
            [id],
          )
        ).rows[0];
        if (!row) throw new HttpError(404, 'NOT_FOUND', 'Exercise not found');
        return exerciseDTO(
          (
            await db.query<ExerciseRow>(
              'UPDATE app.exercises SET name=$2,archived_at=CASE WHEN $3::boolean IS NULL THEN archived_at WHEN $3 THEN COALESCE(archived_at,statement_timestamp()) ELSE NULL END WHERE id=$1 RETURNING *',
              [id, input.name ?? row.name, input.isArchived ?? null],
            )
          ).rows[0]!,
        );
      },
      true,
    );
    res.json(result);
  });
  for (const action of ['approve', 'reject'] as const)
    router.post(`/admin/exercises/:id/${action}`, async (req, res) => {
      const id = parse(idSchema, req.params.id).toLowerCase();
      const result = await run(
        pool,
        res,
        async (db, owner) => {
          const row = (
            await db.query<ExerciseRow>(
              'SELECT * FROM app.exercises WHERE id=$1 FOR UPDATE',
              [id],
            )
          ).rows[0];
          if (!row) throw new HttpError(404, 'NOT_FOUND', 'Exercise not found');
          if (row.status !== 'pending')
            throw new HttpError(
              409,
              'CONFLICT',
              'Exercise has already been reviewed',
            );
          return exerciseDTO(
            (
              await db.query<ExerciseRow>(
                'UPDATE app.exercises SET status=$2,reviewed_by=$3,reviewed_at=statement_timestamp() WHERE id=$1 RETURNING *',
                [id, action === 'approve' ? 'approved' : 'rejected', owner],
              )
            ).rows[0]!,
          );
        },
        true,
      );
      res.json(result);
    });
  return router;
}
