export const ids = {
  user: 'a3b65f0f-fc21-4fe8-81a4-bc9e1ecc0001',
  exercise: 'a3b65f0f-fc21-4fe8-81a4-bc9e1ecc0002',
  workout: 'a3b65f0f-fc21-4fe8-81a4-bc9e1ecc0003',
  plan: 'a3b65f0f-fc21-4fe8-81a4-bc9e1ecc0004',
};
const instant = '2026-10-21T18:34:56.123Z';
const user = {
  id: ids.user,
  username: 'alex',
  role: 'user',
  isActive: true,
  mustChangePassword: false,
  timeZone: 'America/Denver',
  createdAt: instant,
  updatedAt: instant,
};
const exercise = {
  id: ids.exercise,
  name: 'Barbell squat',
  status: 'pending',
  submittedBy: ids.user,
  reviewedBy: null,
  reviewedAt: null,
  archivedAt: null,
  createdAt: instant,
  updatedAt: instant,
};
const reference = {
  id: exercise.id,
  name: exercise.name,
  status: exercise.status,
  archivedAt: null,
};
const workoutCreate = {
  id: ids.workout,
  exerciseId: ids.exercise,
  performedAt: instant,
  reps: 10,
  weight: '135.5',
  setNumber: 1,
  rpe: 5,
};
const workout = {
  ...workoutCreate,
  exercise: reference,
  userId: ids.user,
  createdAt: instant,
  updatedAt: instant,
};
const planCreate = {
  exerciseId: ids.exercise,
  plannedDate: '2026-10-21',
  notes: '3x10',
};
const plan = {
  ...planCreate,
  id: ids.plan,
  userId: ids.user,
  exercise: reference,
  sortOrder: 0,
  createdAt: instant,
  updatedAt: instant,
};
const pagination = { limit: 50, offset: 0, hasMore: false };
export const examples = {
  SetupStatus: { setupRequired: true },
  SetupCreate: {
    username: 'admin',
    password: 'Example-only-setup-password!',
    timeZone: 'America/Denver',
  },
  Health: { status: 'ok' },
  ApiError: {
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Invalid request',
      fieldErrors: [
        {
          path: 'weight',
          message: 'Use a decimal string with at most three decimal places',
        },
      ],
    },
  },
  User: user,
  Csrf: { csrfToken: 'c'.repeat(43) },
  Auth: { user, csrfToken: 'c'.repeat(43) },
  Login: { username: 'alex', password: 'Example-only-long-password!' },
  PasswordChange: {
    currentPassword: 'Example-only-long-password!',
    newPassword: 'Another-example-password!',
  },
  AccountCreate: {
    username: 'alex',
    password: 'Example-only-long-password!',
    timeZone: 'America/Denver',
    role: 'user',
  },
  AccountPatch: { isActive: false },
  AccountReset: { temporaryPassword: 'Temporary-example-password!' },
  PreferencesPatch: { timeZone: 'UTC' },
  AccountList: { items: [user], pagination },
  Exercise: exercise,
  ExerciseCreate: { name: 'Barbell squat' },
  ExercisePatch: { name: 'Barbell back squat' },
  ExerciseList: { items: [exercise], pagination },
  WorkoutCreate: workoutCreate,
  WorkoutPatch: { reps: 12 },
  Workout: workout,
  WorkoutList: { items: [workout], pagination },
  PlanCreate: planCreate,
  PlanPatch: { notes: '3x8' },
  Plan: plan,
  PlanReorder: { plannedDate: '2026-10-21', orderedIds: [ids.plan] },
  PlanList: { items: [plan], pagination },
};
