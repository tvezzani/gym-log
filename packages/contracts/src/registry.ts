import { healthSchema, apiErrorSchema } from './primitives.js';
import {
  setupStatusSchema,
  setupCreateSchema,
  userSchema,
  csrfSchema,
  authSchema,
  loginSchema,
  passwordChangeSchema,
  accountCreateSchema,
  accountPatchSchema,
  accountResetSchema,
  preferencesPatchSchema,
  accountListSchema,
} from './accounts.js';
import {
  exerciseSchema,
  exerciseCreateSchema,
  exercisePatchSchema,
  exerciseListSchema,
} from './exercises.js';
import {
  workoutSchema,
  workoutCreateSchema,
  workoutPatchSchema,
  workoutListSchema,
} from './workouts.js';
import {
  planSchema,
  planCreateSchema,
  planPatchSchema,
  planReorderSchema,
  planListSchema,
} from './plans.js';

export const contractSchemas = {
  SetupStatus: setupStatusSchema,
  SetupCreate: setupCreateSchema,
  Health: healthSchema,
  ApiError: apiErrorSchema,
  User: userSchema,
  Csrf: csrfSchema,
  Auth: authSchema,
  Login: loginSchema,
  PasswordChange: passwordChangeSchema,
  AccountCreate: accountCreateSchema,
  AccountPatch: accountPatchSchema,
  AccountReset: accountResetSchema,
  PreferencesPatch: preferencesPatchSchema,
  AccountList: accountListSchema,
  Exercise: exerciseSchema,
  ExerciseCreate: exerciseCreateSchema,
  ExercisePatch: exercisePatchSchema,
  ExerciseList: exerciseListSchema,
  Workout: workoutSchema,
  WorkoutCreate: workoutCreateSchema,
  WorkoutPatch: workoutPatchSchema,
  WorkoutList: workoutListSchema,
  Plan: planSchema,
  PlanCreate: planCreateSchema,
  PlanPatch: planPatchSchema,
  PlanReorder: planReorderSchema,
  PlanList: planListSchema,
};
