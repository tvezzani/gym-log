import { useRef, type FormEvent } from 'react';
import {
  preferencesPatchSchema,
  userSchema,
  exerciseListSchema,
  canSelectExercise,
} from '@gym-log/contracts';
import { api } from './api';
import { Notice } from './components';
import {
  baseDraft,
  failure,
  useRemoteList,
  exerciseStatus,
  type ManagementProps,
} from './management';
import type { User } from '@gym-log/contracts';
export function Settings({
  user,
  draft,
  onDraft,
  onUser,
  onPassword,
  onExercises,
}: {
  onUser: (user: User) => void;
  onPassword: () => void;
  onExercises: () => void;
} & ManagementProps) {
  const form = draft?.kind === 'timezone' ? draft : null,
    inFlight = useRef(false);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form || form.busy || inFlight.current) return;
    let input;
    try {
      input = preferencesPatchSchema.parse({ timeZone: form.timeZone.trim() });
    } catch (e) {
      onDraft(failure(form, e));
      return;
    }
    inFlight.current = true;
    onDraft({ ...form, busy: true, error: '' });
    try {
      const next = await api.request(
        '/preferences',
        userSchema,
        'PATCH',
        input,
      );
      onDraft(null);
      onUser(next);
    } catch (e) {
      onDraft(failure(form, e));
    } finally {
      inFlight.current = false;
    }
  }
  return (
    <section className="management-screen" aria-label="Settings">
      <p className="eyebrow">
        @{user.username} · {user.role}
      </p>
      <form
        className="management-form"
        aria-label="Timezone settings"
        onSubmit={save}
      >
        <h2>Your timezone</h2>
        <p className="fine muted">
          Today and history use this timezone. Plan dates stay unchanged.
          Traveling does not change it automatically.
        </p>
        <label className="field">
          <span>Timezone</span>
          <input
            aria-label="Timezone"
            value={form?.timeZone ?? user.timeZone}
            disabled={(!!draft && !form) || form?.busy}
            onChange={(e) =>
              onDraft({
                ...(form ?? { ...baseDraft(user), kind: 'timezone' }),
                timeZone: e.target.value,
                error: '',
              })
            }
            required
            list="timezone-suggestions"
          />
          <datalist id="timezone-suggestions">
            {[
              'UTC',
              'America/Denver',
              'America/New_York',
              'America/Chicago',
              'America/Los_Angeles',
              'Europe/London',
              'Asia/Tokyo',
              'Australia/Sydney',
            ].map((zone) => (
              <option value={zone} key={zone} />
            ))}
          </datalist>
        </label>
        {form?.error && <Notice error>{form.error}</Notice>}
        <button className="primary wide" disabled={!form || form.busy}>
          {form?.busy ? 'Saving…' : 'Save timezone'}
        </button>
        {form && (
          <button
            type="button"
            className="text-button wide"
            disabled={form.busy}
            onClick={() => onDraft(null)}
          >
            Cancel timezone change
          </button>
        )}
      </form>
      <button className="secondary wide" onClick={onPassword}>
        Change password
      </button>
      <button className="secondary wide" onClick={onExercises}>
        My exercises
      </button>
    </section>
  );
}
export function MyExercises({
  user,
  revision,
  onAdd,
  onLog,
}: {
  user: User;
  revision: number;
  onAdd: () => void;
  onLog: (id: string) => void;
}) {
  const list = useRemoteList(
    '/exercise-submissions',
    exerciseListSchema,
    `${user.id}:${revision}`,
  );
  return (
    <section className="management-screen" aria-label="My exercises">
      <p className="fine muted">
        Your submissions and their review status. Only admins can rename
        exercises.
      </p>
      <div className="screen-tools">
        <button className="primary" onClick={onAdd}>
          Add new exercise
        </button>
        <button
          className="text-button"
          onClick={list.reload}
          disabled={list.loading}
        >
          Refresh submissions
        </button>
      </div>
      {list.error && <Notice error>{list.error}</Notice>}
      {list.loading ? (
        <p className="loading" role="status">
          Loading submissions…
        </p>
      ) : !list.items.length && !list.error ? (
        <p className="empty">You haven’t submitted any exercises yet.</p>
      ) : (
        list.items.map((row) => (
          <article
            key={row.id}
            className="management-card"
            aria-label={row.name}
          >
            <h2>{row.name}</h2>
            <p className="status-pill">{exerciseStatus(row)}</p>
            {row.status === 'rejected' && (
              <p className="fine muted">
                Existing sets and plans are kept. This exercise cannot be
                selected for new entries.
              </p>
            )}
            {row.archivedAt && (
              <p className="fine muted">
                Archived exercises remain in existing history and plans.
              </p>
            )}
            <button
              className="text-button"
              disabled={!canSelectExercise(row, user.id)}
              onClick={() => onLog(row.id)}
            >
              Log set ↗
            </button>
          </article>
        ))
      )}
    </section>
  );
}
