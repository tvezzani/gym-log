import { useEffect, useRef, useState, type FormEvent } from 'react';
import { z } from 'zod';
import {
  workoutSchema,
  workoutListSchema,
  type Exercise,
  type Workout,
} from '@gym-log/contracts';
import { api, ApiError, message } from './api';
import { type Draft, createPayload } from './draft';
import { repeatedTime, timeLabel } from './time';
import { Icon, Modal, Notice } from './components';
export function Composer({
  draft,
  setDraft,
  exercises,
  onSaved,
  onAddExercise,
  onClose,
}: {
  draft: Draft;
  setDraft: (d: Draft | null) => void;
  exercises: Exercise[];
  onSaved: (row: Workout, recovered?: boolean) => void;
  onAddExercise: () => void;
  onClose: () => void;
}) {
  const [last, setLast] = useState<Workout | null>(null),
    [lastState, setLastState] = useState(''),
    [checking, setChecking] = useState(false);
  const inFlight = useRef(false);
  const locked = draft.phase !== 'editing',
    busy = draft.phase === 'saving' || checking;
  const chosen = exercises.find((e) => e.id === draft.fields.exerciseId);
  useEffect(() => {
    let live = true;
    setLast(null);
    if (!draft.fields.exerciseId) {
      setLastState('');
      return;
    }
    setLastState('Loading last values…');
    api
      .request(
        `/workouts?exerciseId=${encodeURIComponent(draft.fields.exerciseId)}&limit=1`,
        workoutListSchema,
      )
      .then((p) => {
        if (live) {
          setLast(p.items[0] ?? null);
          setLastState(
            p.items.length ? '' : 'No previous sets for this exercise.',
          );
        }
      })
      .catch(() => {
        if (live)
          setLastState('Last values unavailable. You can still enter a set.');
      });
    return () => {
      live = false;
    };
  }, [draft.fields.exerciseId]);
  function field(name: keyof Draft['fields'], value: string) {
    setDraft({
      ...draft,
      fields: { ...draft.fields, [name]: value },
      error: '',
      fieldErrors: [],
    });
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (inFlight.current || ['deleted', 'conflict'].includes(draft.phase))
      return;
    let payload;
    try {
      payload =
        draft.attempt ??
        createPayload(draft, draft.edit?.id ?? crypto.randomUUID());
    } catch (e) {
      setDraft({
        ...draft,
        error:
          e instanceof z.ZodError
            ? 'Check the highlighted fields.'
            : message(e),
        fieldErrors:
          e instanceof z.ZodError
            ? e.issues.map((i) => ({
                path: String(i.path[0]),
                message:
                  (
                    {
                      exerciseId: 'Choose an available exercise.',
                      weight:
                        'Use pounds from 0 to 99999.999, with up to three decimal places.',
                      reps: 'Enter whole reps from 1 to 2147483647.',
                      setNumber:
                        'Enter a whole set number from 1 to 2147483647.',
                      rpe: 'Enter a whole RPE from 1 to 10.',
                    } as Record<string, string>
                  )[String(i.path[0])] ?? i.message,
              }))
            : [],
      });
      return;
    }
    inFlight.current = true;
    const saving = {
      ...draft,
      attempt: payload,
      phase: 'saving' as const,
      error: '',
      fieldErrors: [],
    };
    setDraft(saving);
    try {
      const { id, ...fields } = payload;
      const row = await api.request(
        draft.edit ? `/workouts/${id}` : '/workouts',
        workoutSchema,
        draft.edit ? 'PATCH' : 'POST',
        draft.edit ? fields : payload,
      );
      onSaved(row);
    } catch (e) {
      const apiError = e instanceof ApiError ? e : null;
      const preserve =
        draft.phase === 'uncertain' ||
        draft.phase === 'conflict' ||
        (apiError?.status === 409 && apiError.code === 'CONFLICT') ||
        apiError?.uncertain ||
        apiError?.status === 401 ||
        apiError?.code === 'PASSWORD_CHANGE_REQUIRED';
      const phase =
        apiError?.status === 410
          ? 'deleted'
          : preserve
            ? 'uncertain'
            : 'editing';
      setDraft({
        ...saving,
        phase,
        attempt: phase === 'editing' ? null : payload,
        error:
          phase === 'uncertain'
            ? `Save not confirmed. Your values are locked so retrying cannot create a second set. ${message(e)}`
            : message(e),
        fieldErrors: apiError?.fields ?? [],
      });
    } finally {
      inFlight.current = false;
    }
  }
  async function check() {
    if (inFlight.current || !draft.attempt) return;
    setChecking(true);
    try {
      const row = await api.request(
        `/workouts/${draft.attempt.id}`,
        workoutSchema,
      );
      onSaved(row, true);
    } catch (e) {
      setDraft({
        ...draft,
        error:
          e instanceof ApiError && e.status === 404
            ? 'No saved set is visible yet. Retry the original save to resolve it safely.'
            : message(e),
      });
    } finally {
      setChecking(false);
    }
  }
  const errorFor = (path: string) =>
    draft.fieldErrors.find((e) => e.path === path)?.message;
  function input(
    label: string,
    name: 'weight' | 'reps' | 'setNumber' | 'rpe',
    mode: 'decimal' | 'numeric',
  ) {
    const err = errorFor(name);
    return (
      <label className="field">
        <span>{label}</span>
        <input
          name={name}
          aria-label={label}
          inputMode={mode}
          type="text"
          value={draft.fields[name]}
          onChange={(e) => field(name, e.target.value)}
          required
          aria-invalid={!!err}
          aria-describedby={err ? `${name}-error` : undefined}
        />
        {err && (
          <small id={`${name}-error`} className="field-error">
            {err}
          </small>
        )}
      </label>
    );
  }
  return (
    <Modal
      title={draft.edit ? 'Edit set' : 'Log a set'}
      onClose={onClose}
      busy={busy}
    >
      <form className="composer" onSubmit={save}>
        <p className="muted fine">
          {draft.edit
            ? 'Update this independent set.'
            : 'Log your effort in pounds.'}
        </p>
        <fieldset disabled={locked || checking}>
          <label className="field">
            <span>Exercise</span>
            <select
              name="exerciseId"
              aria-label="Exercise"
              data-initial-focus
              value={draft.fields.exerciseId}
              onChange={(e) => field('exerciseId', e.target.value)}
              required
              aria-invalid={!!errorFor('exerciseId')}
              autoFocus
            >
              <option value="">Choose an exercise</option>
              {draft.edit && !chosen && (
                <option value={draft.edit.exerciseId}>
                  {draft.edit.exercise.name} ·{' '}
                  {draft.edit.exercise.archivedAt
                    ? 'archived'
                    : draft.edit.exercise.status}{' '}
                  (keep existing)
                </option>
              )}
              {exercises.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                  {e.status === 'pending' ? ' · pending, private' : ''}
                </option>
              ))}
            </select>
            {errorFor('exerciseId') && (
              <small className="field-error">
                Choose an available exercise.
              </small>
            )}
          </label>
          <button
            type="button"
            className="text-button exercise-create-action"
            onClick={onAddExercise}
          >
            <Icon name="plus" /> Add new exercise
          </button>
          {chosen?.status === 'pending' && (
            <p className="fine accent">
              Your pending exercise stays private until approval.
            </p>
          )}
          <div className="last-values">
            {last ? (
              <>
                <span className="eyebrow">LAST RECORDED</span>
                <strong>
                  {last.weight} <small>lbs</small>
                  <span>×</span>
                  {last.reps} <small>reps</small>
                  <span>·</span>
                  <small>RPE {last.rpe}</small>
                </strong>
                <span className="fine muted">
                  {new Intl.DateTimeFormat('en-US', {
                    timeZone: draft.zone,
                    month: 'short',
                    day: 'numeric',
                  }).format(new Date(last.performedAt))}{' '}
                  · {timeLabel(last.performedAt, draft.zone)}
                </span>
              </>
            ) : (
              <span className="fine muted">
                {lastState || 'Select an exercise to see your last values.'}
              </span>
            )}
          </div>
          <div className="form-grid">
            {input('Weight (lbs)', 'weight', 'decimal')}
            {input('Reps', 'reps', 'numeric')}
            {input('Set number', 'setNumber', 'numeric')}
            {input('RPE (1–10)', 'rpe', 'numeric')}
          </div>
          <label className="field">
            <span>Performed at</span>
            <input
              name="localTime"
              type="datetime-local"
              step="0.001"
              min="0001-01-01T00:00"
              max="9999-12-31T23:59:59.999"
              value={draft.fields.localTime}
              onChange={(e) => field('localTime', e.target.value)}
              required
            />
            <small className="muted">{draft.zone}</small>
          </label>
          {repeatedTime(draft.fields.localTime, draft.zone) && (
            <label className="field">
              <span>This time occurs twice. Which one?</span>
              <select
                value={draft.fields.occurrence}
                onChange={(e) => field('occurrence', e.target.value)}
              >
                <option value="earlier">
                  First occurrence (before clocks turn back)
                </option>
                <option value="later">
                  Second occurrence (after clocks turn back)
                </option>
              </select>
            </label>
          )}
        </fieldset>
        {draft.error && <Notice error>{draft.error}</Notice>}
        {!!draft.fieldErrors.length && (
          <p className="fine error-text">
            {draft.fieldErrors
              .filter(
                (e) =>
                  ![
                    'exerciseId',
                    'weight',
                    'reps',
                    'setNumber',
                    'rpe',
                  ].includes(e.path),
              )
              .map((e) => e.message)
              .join('. ')}
          </p>
        )}
        <footer className="save-bar">
          {draft.phase === 'deleted' ? (
            <>
              <p className="fine">
                The original set was deleted. It will not be recreated by a
                retry.
              </p>
              <button
                type="button"
                className="primary wide"
                onClick={() => {
                  setDraft(null);
                  onClose();
                }}
              >
                Acknowledge deletion
              </button>
            </>
          ) : draft.phase === 'conflict' ? (
            <>
              <p className="fine">
                Resolve this submission before starting another set.
              </p>
              <button
                type="button"
                className="primary wide"
                onClick={check}
                disabled={busy}
              >
                Check saved set
              </button>
            </>
          ) : (
            <>
              <button
                className="primary wide"
                disabled={busy || (!draft.fields.exerciseId && !locked)}
              >
                {busy
                  ? 'Saving…'
                  : draft.phase === 'uncertain'
                    ? 'Retry same save'
                    : draft.edit
                      ? 'Save changes'
                      : 'Save set'}
                <span aria-hidden="true">↗</span>
              </button>
              {draft.phase === 'uncertain' && (
                <button
                  type="button"
                  className="text-button wide"
                  onClick={check}
                  disabled={busy}
                >
                  Check saved set
                </button>
              )}
            </>
          )}
        </footer>
      </form>
    </Modal>
  );
}
