import { useRef, type FormEvent } from 'react';
import { z } from 'zod';
import {
  exerciseCreateSchema,
  exerciseSchema,
  type Exercise,
} from '@gym-log/contracts';
import { api, ApiError, message } from './api';
import { Modal, Notice } from './components';

export interface ExerciseDraft {
  ownerId: string;
  name: string;
  error: string;
  saving: boolean;
}
export function AddExercise({
  draft,
  onChange,
  onAdded,
  onClose,
}: {
  draft: ExerciseDraft;
  onChange: (draft: ExerciseDraft) => void;
  onAdded: (exercise: Exercise) => void;
  onClose: () => void;
}) {
  const inFlight = useRef(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    let input;
    try {
      input = exerciseCreateSchema.parse({ name: draft.name.trim() });
    } catch (e) {
      onChange({
        ...draft,
        error:
          e instanceof z.ZodError
            ? 'Enter an exercise name with 1–120 characters and no control characters.'
            : message(e),
      });
      return;
    }
    inFlight.current = true;
    onChange({ ...draft, saving: true, error: '' });
    try {
      onAdded(await api.request('/exercises', exerciseSchema, 'POST', input));
    } catch (e) {
      onChange({
        ...draft,
        saving: false,
        error:
          e instanceof ApiError && e.uncertain
            ? 'Could not confirm whether the exercise was added. Close this form and check the exercise picker before adding it again.'
            : message(e),
      });
    } finally {
      inFlight.current = false;
    }
  }
  return (
    <Modal title="Add new exercise" onClose={onClose} busy={draft.saving}>
      <form className="add-exercise-form" onSubmit={submit}>
        <p className="muted fine">
          Use this exercise in your own log right away. It stays private until
          an admin approves it for everyone.
        </p>
        <fieldset disabled={draft.saving}>
          <label className="field">
            <span>Exercise name</span>
            <input
              aria-label="Exercise name"
              name="exerciseName"
              data-initial-focus
              autoFocus
              autoComplete="off"
              value={draft.name}
              onChange={(e) =>
                onChange({ ...draft, name: e.target.value, error: '' })
              }
              required
              minLength={1}
              maxLength={120}
            />
            <small className="muted">
              For example, Incline dumbbell press.
            </small>
          </label>
        </fieldset>
        {draft.error && <Notice error>{draft.error}</Notice>}
        <button type="submit" className="primary wide" disabled={draft.saving}>
          {draft.saving ? 'Adding…' : 'Add exercise'}
        </button>
        <button
          type="button"
          className="text-button wide"
          onClick={onClose}
          disabled={draft.saving}
        >
          Cancel
        </button>
      </form>
    </Modal>
  );
}
