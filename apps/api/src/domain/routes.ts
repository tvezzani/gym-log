import { Router } from 'express';
import type { Pool } from 'pg';
import { exerciseRouter } from './exercises.js';
import { workoutRouter } from './workouts.js';
import { planRouter } from './plans.js';
export function createDomainRouter(pool: Pool) {
  const router = Router();
  router.use(exerciseRouter(pool), workoutRouter(pool), planRouter(pool));
  return router;
}
