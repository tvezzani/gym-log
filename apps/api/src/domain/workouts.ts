import { Router } from 'express';
import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import {
  workoutCreateSchema,
  workoutPatchSchema,
  workoutListQuerySchema,
  idSchema,
  canonicalWorkoutCreate,
  normalizeWeight,
} from '@gym-log/contracts';
import { parse, HttpError } from '../errors.js';
import {
  body,
  run,
  page,
  workoutDTO,
  workoutSelect,
  ownedWorkout,
  eligibleExercise,
  type WorkoutRow,
} from './common.js';

export function workoutRouter(pool: Pool) {
  const router = Router();
  router.get('/workouts', async (req, res) => {
    const input = parse(workoutListQuerySchema, req.query);
    const rows = await run(
      pool,
      res,
      async (db, owner) =>
        (
          await db.query<WorkoutRow>(
            `${workoutSelect} WHERE w.user_id=$1 AND ($2::uuid IS NULL OR w.exercise_id=$2) AND ($3::timestamptz IS NULL OR w.performed_at >= $3) AND ($4::timestamptz IS NULL OR w.performed_at < $4) ORDER BY w.performed_at DESC,w.id DESC LIMIT $5 OFFSET $6`,
            [
              owner,
              input.exerciseId ?? null,
              input.start ?? null,
              input.end ?? null,
              input.limit + 1,
              input.offset,
            ],
          )
        ).rows,
    );
    res.json(page(rows.map(workoutDTO), input));
  });
  router.post('/workouts', async (req, res) => {
    const input = body(req, workoutCreateSchema),
      id = input.id.toLowerCase(),
      exerciseId = input.exerciseId.toLowerCase();
    const hash = createHash('sha256')
      .update(canonicalWorkoutCreate(input))
      .digest('hex');
    const result = await run(pool, res, async (db, owner) => {
      const inserted = await db.query(
        'INSERT INTO app.workout_create_requests(id,user_id,request_hash) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING RETURNING id',
        [id, owner, hash],
      );
      if (!inserted.rowCount) {
        const original = (
          await db.query<{ user_id: string; request_hash: string }>(
            'SELECT user_id,request_hash FROM app.workout_create_requests WHERE id=$1',
            [id],
          )
        ).rows[0];
        if (
          !original ||
          original.user_id !== owner ||
          original.request_hash !== hash
        )
          throw new HttpError(409, 'CONFLICT', 'Request identity conflict');
        const saved = await ownedWorkout(db, id, owner, true);
        if (!saved)
          throw new HttpError(410, 'GONE', 'Original set was deleted');
        return { created: false, workout: workoutDTO(saved) };
      }
      await eligibleExercise(db, exerciseId, owner);
      await db.query(
        'INSERT INTO app.workouts(id,user_id,exercise_id,performed_at,reps,weight,set_number,rpe) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          id,
          owner,
          exerciseId,
          input.performedAt,
          input.reps,
          normalizeWeight(input.weight),
          input.setNumber,
          input.rpe,
        ],
      );
      return {
        created: true,
        workout: workoutDTO((await ownedWorkout(db, id, owner))!),
      };
    });
    res.status(result.created ? 201 : 200).json(result.workout);
  });
  router.get('/workouts/:id', async (req, res) => {
    const id = parse(idSchema, req.params.id).toLowerCase();
    const row = await run(pool, res, (db, owner) =>
      ownedWorkout(db, id, owner),
    );
    if (!row) throw new HttpError(404, 'NOT_FOUND', 'Set not found');
    res.json(workoutDTO(row));
  });
  router.patch('/workouts/:id', async (req, res) => {
    const id = parse(idSchema, req.params.id).toLowerCase(),
      input = body(req, workoutPatchSchema);
    const result = await run(pool, res, async (db, owner) => {
      const old = await ownedWorkout(db, id, owner, true);
      if (!old) throw new HttpError(404, 'NOT_FOUND', 'Set not found');
      const exerciseId = input.exerciseId?.toLowerCase() ?? old.exercise_id;
      if (exerciseId !== old.exercise_id)
        await eligibleExercise(db, exerciseId, owner);
      await db.query(
        'UPDATE app.workouts SET exercise_id=$3,performed_at=$4,reps=$5,weight=$6,set_number=$7,rpe=$8 WHERE id=$1 AND user_id=$2',
        [
          id,
          owner,
          exerciseId,
          input.performedAt ?? old.performed_at,
          input.reps ?? old.reps,
          input.weight === undefined
            ? old.weight
            : normalizeWeight(input.weight),
          input.setNumber ?? old.set_number,
          input.rpe ?? old.rpe,
        ],
      );
      return workoutDTO((await ownedWorkout(db, id, owner))!);
    });
    res.json(result);
  });
  router.delete('/workouts/:id', async (req, res) => {
    const id = parse(idSchema, req.params.id).toLowerCase();
    await run(pool, res, async (db, owner) => {
      if (
        !(
          await db.query(
            'DELETE FROM app.workouts WHERE id=$1 AND user_id=$2 RETURNING id',
            [id, owner],
          )
        ).rowCount
      )
        throw new HttpError(404, 'NOT_FOUND', 'Set not found');
    });
    res.sendStatus(204);
  });
  return router;
}
