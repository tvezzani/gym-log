import { workoutCreateSchema, type Workout } from '@gym-log/contracts';
import { initialTime, performedInstant, wallTime } from './time';
export interface Fields {
  exerciseId: string;
  weight: string;
  reps: string;
  setNumber: string;
  rpe: string;
  localTime: string;
  occurrence: 'earlier' | 'later';
}
export interface Draft {
  ownerId: string;
  zone: string;
  fields: Fields;
  edit: Workout | null;
  attempt: ReturnType<typeof workoutCreateSchema.parse> | null;
  phase: 'editing' | 'saving' | 'uncertain' | 'deleted' | 'conflict';
  error: string;
  fieldErrors: { path: string; message: string }[];
}
export function makeDraft(
  ownerId: string,
  zone: string,
  date: string,
  exerciseId = '',
  source?: Workout,
  edit = false,
): Draft {
  const instant = source?.performedAt;
  const local =
    edit && instant ? wallTime(instant, zone) : initialTime(date, zone);
  return {
    ownerId,
    zone,
    fields: {
      exerciseId: source?.exerciseId ?? exerciseId,
      weight: source?.weight ?? '',
      reps: source ? String(source.reps) : '',
      setNumber: source
        ? String(edit ? source.setNumber : source.setNumber + 1)
        : '1',
      rpe: source ? String(source.rpe) : '5',
      localTime: local,
      occurrence:
        edit && instant && performedInstant(local, zone, 'earlier') !== instant
          ? 'later'
          : 'earlier',
    },
    edit: edit ? (source ?? null) : null,
    attempt: null,
    phase: 'editing',
    error: '',
    fieldErrors: [],
  };
}
export function createPayload(draft: Draft, id: string) {
  return workoutCreateSchema.parse({
    id,
    exerciseId: draft.fields.exerciseId,
    weight: draft.fields.weight,
    reps: Number(draft.fields.reps),
    setNumber: Number(draft.fields.setNumber),
    rpe: Number(draft.fields.rpe),
    performedAt: performedInstant(
      draft.fields.localTime,
      draft.zone,
      draft.fields.occurrence,
    ),
  });
}
