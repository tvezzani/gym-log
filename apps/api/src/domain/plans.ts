import { Router } from 'express';
import type { Pool } from 'pg';
import {
  planCreateSchema,
  planPatchSchema,
  planListQuerySchema,
  planReorderSchema,
  idSchema,
} from '@gym-log/contracts';
import { parse, HttpError } from '../errors.js';
import {
  body,
  run,
  page,
  planDTO,
  planSelect,
  ownedPlan,
  eligibleExercise,
  lockPlanDates,
  appendPosition,
  type PlanRow,
} from './common.js';

export function planRouter(pool: Pool) {
  const router = Router();
  router.get('/planned-exercises', async (req, res) => {
    const input = parse(planListQuerySchema, req.query);
    const rows = await run(
      pool,
      res,
      async (db, owner) =>
        (
          await db.query<PlanRow>(
            `${planSelect} WHERE p.user_id=$1 AND p.planned_date=$2::date ORDER BY p.sort_order,p.id LIMIT $3 OFFSET $4`,
            [owner, input.plannedDate, input.limit + 1, input.offset],
          )
        ).rows,
    );
    res.json(page(rows.map(planDTO), input));
  });
  router.post('/planned-exercises', async (req, res) => {
    const input = body(req, planCreateSchema);
    const result = await run(pool, res, async (db, owner) => {
      await lockPlanDates(db, owner, [input.plannedDate]);
      await eligibleExercise(db, input.exerciseId, owner);
      const position = await appendPosition(db, owner, input.plannedDate);
      const row = (
        await db.query<{ id: string }>(
          'INSERT INTO app.planned_exercises(user_id,exercise_id,planned_date,notes,sort_order) VALUES($1,$2,$3::date,$4,$5) RETURNING id',
          [owner, input.exerciseId, input.plannedDate, input.notes, position],
        )
      ).rows[0]!;
      return planDTO((await ownedPlan(db, row.id, owner))!);
    });
    res.status(201).json(result);
  });
  router.put('/planned-exercises/order', async (req, res) => {
    const input = body(req, planReorderSchema),
      ids = input.orderedIds.map((id) => id.toLowerCase());
    await run(pool, res, async (db, owner) => {
      await lockPlanDates(db, owner, [input.plannedDate]);
      const rows = (
        await db.query<{ id: string }>(
          'SELECT id FROM app.planned_exercises WHERE user_id=$1 AND planned_date=$2::date ORDER BY sort_order,id FOR UPDATE',
          [owner, input.plannedDate],
        )
      ).rows;
      const existing = new Set(rows.map((row) => row.id));
      if (rows.length !== ids.length || ids.some((id) => !existing.has(id)))
        throw new HttpError(
          409,
          'CONFLICT',
          'Plan list changed; reload and retry',
        );
      await db.query('SET CONSTRAINTS app.plans_owner_date_order DEFERRED');
      if (ids.length) {
        const result = await db.query(
          'UPDATE app.planned_exercises AS p SET sort_order=chosen.rank::integer-1 FROM unnest($1::uuid[]) WITH ORDINALITY AS chosen(id,rank) WHERE p.id=chosen.id AND p.user_id=$2 AND p.planned_date=$3::date',
          [ids, owner, input.plannedDate],
        );
        if (result.rowCount !== ids.length)
          throw new HttpError(
            409,
            'CONFLICT',
            'Plan list changed; reload and retry',
          );
      }
      await db.query('SET CONSTRAINTS app.plans_owner_date_order IMMEDIATE');
    });
    res.sendStatus(204);
  });
  router.patch('/planned-exercises/:id', async (req, res) => {
    const id = parse(idSchema, req.params.id).toLowerCase(),
      input = body(req, planPatchSchema);
    const result = await run(pool, res, async (db, owner) => {
      const old = await ownedPlan(db, id, owner, true);
      if (!old) throw new HttpError(404, 'NOT_FOUND', 'Plan entry not found');
      const date = input.plannedDate ?? old.planned_date,
        exerciseId = input.exerciseId?.toLowerCase() ?? old.exercise_id;
      await lockPlanDates(db, owner, [old.planned_date, date]);
      if (exerciseId !== old.exercise_id)
        await eligibleExercise(db, exerciseId, owner);
      const position =
        date === old.planned_date
          ? old.sort_order
          : await appendPosition(db, owner, date);
      await db.query(
        'UPDATE app.planned_exercises SET exercise_id=$3,planned_date=$4::date,notes=$5,sort_order=$6 WHERE id=$1 AND user_id=$2',
        [id, owner, exerciseId, date, input.notes ?? old.notes, position],
      );
      return planDTO((await ownedPlan(db, id, owner))!);
    });
    res.json(result);
  });
  router.delete('/planned-exercises/:id', async (req, res) => {
    const id = parse(idSchema, req.params.id).toLowerCase();
    await run(pool, res, async (db, owner) => {
      const row = await ownedPlan(db, id, owner, true);
      if (!row) throw new HttpError(404, 'NOT_FOUND', 'Plan entry not found');
      await lockPlanDates(db, owner, [row.planned_date]);
      await db.query(
        'DELETE FROM app.planned_exercises WHERE id=$1 AND user_id=$2',
        [id, owner],
      );
    });
    res.sendStatus(204);
  });
  return router;
}
