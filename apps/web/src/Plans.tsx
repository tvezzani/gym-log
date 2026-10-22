import { useRef, useState, type FormEvent } from 'react';
import { z } from 'zod';
import {
  dateSchema,
  planCreateSchema,
  planPatchSchema,
  planSchema,
  planListSchema,
  planReorderSchema,
  type Exercise,
  type Plan,
} from '@gym-log/contracts';
import { api, message } from './api';
import { Notice, Icon } from './components';
import {
  baseDraft,
  failure,
  useRemoteList,
  exerciseStatus,
  type ManagementProps,
} from './management';
import { dateLabel, shiftDate } from './time';
export function Plans({
  user,
  draft,
  onDraft,
  revision,
  onChanged,
  date,
  onDate,
  exercises,
  onLog,
  onAddExercise,
}: {
  date: string;
  onDate: (date: string) => void;
  exercises: Exercise[];
  onLog: (id: string) => void;
  onAddExercise: () => void;
} & ManagementProps) {
  const list = useRemoteList(
      `/planned-exercises?plannedDate=${date}`,
      planListSchema,
      `${user.id}:${revision}`,
    ),
    form = draft?.kind === 'plan' ? draft : null;
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const inFlight = useRef(false);
  function edit(row?: Plan) {
    onDraft({
      ...baseDraft(user),
      kind: 'plan',
      id: row?.id ?? null,
      exerciseId: row?.exerciseId ?? '',
      plannedDate: row?.plannedDate ?? date,
      notes: row?.notes ?? '',
      original: row?.exercise ?? null,
    });
    setNotice('');
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form || form.busy || inFlight.current || (!form.id && form.uncertain))
      return;
    let input;
    try {
      input = (form.id ? planPatchSchema : planCreateSchema).parse({
        exerciseId: form.exerciseId,
        plannedDate: form.plannedDate,
        notes: form.notes,
      });
    } catch (e) {
      onDraft(failure(form, e));
      return;
    }
    inFlight.current = true;
    onDraft({ ...form, busy: true, error: '' });
    try {
      await api.request(
        form.id ? `/planned-exercises/${form.id}` : '/planned-exercises',
        planSchema,
        form.id ? 'PATCH' : 'POST',
        input,
      );
      onDraft(null);
      setNotice(`Plan saved for ${dateLabel(form.plannedDate)}.`);
      onChanged();
      list.reload();
    } catch (e) {
      onDraft(failure(form, e));
    } finally {
      inFlight.current = false;
    }
  }
  async function remove(row: Plan) {
    if (busy || !window.confirm(`Delete ${row.exercise.name} from this plan?`))
      return;
    setBusy(true);
    setError('');
    try {
      await api.request(
        `/planned-exercises/${row.id}`,
        z.undefined(),
        'DELETE',
      );
      onChanged();
      list.reload();
      setNotice('Plan entry deleted.');
    } catch (e) {
      setError(message(e));
      list.reload();
    } finally {
      setBusy(false);
    }
  }
  async function move(index: number, direction: number) {
    if (busy || inFlight.current) return;
    const ids = list.items.map((p) => p.id),
      target = index + direction;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    setBusy(true);
    inFlight.current = true;
    setError('');
    try {
      await api.request(
        '/planned-exercises/order',
        z.undefined(),
        'PUT',
        planReorderSchema.parse({ plannedDate: date, orderedIds: ids }),
      );
      onChanged();
      list.reload();
      setNotice('Plan order saved.');
    } catch (e) {
      setError(`${message(e)} The list has been reloaded.`);
      list.reload();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="management-screen" aria-label="Plan">
      <div className="date-bar">
        <button
          className="icon-button accent"
          aria-label="Previous plan day"
          disabled={date === '0001-01-01' || busy}
          onClick={() => onDate(shiftDate(date, -1))}
        >
          <Icon name="back" />
        </button>
        <label className="field compact">
          <span>Plan date</span>
          <input
            aria-label="Plan date"
            type="date"
            min="0001-01-01"
            max="9999-12-31"
            value={date}
            onChange={(e) => {
              if (dateSchema.safeParse(e.target.value).success)
                onDate(e.target.value);
            }}
          />
        </label>
        <button
          className="icon-button accent"
          aria-label="Next plan day"
          disabled={date === '9999-12-31' || busy}
          onClick={() => onDate(shiftDate(date, 1))}
        >
          <Icon name="next" />
        </button>
      </div>
      <p className="fine muted">
        Private notes for this date. Logging a set is always a separate save.
      </p>
      <div className="screen-tools">
        <button
          className="primary"
          disabled={!!draft || busy}
          onClick={() => edit()}
        >
          <Icon name="plus" /> Add plan entry
        </button>
        <button
          className="text-button"
          onClick={list.reload}
          disabled={list.loading}
        >
          Reload plans
        </button>
      </div>
      {form && (
        <form
          className="management-form"
          aria-label={form.id ? 'Edit plan entry' : 'New plan entry'}
          onSubmit={save}
        >
          <h2>{form.id ? 'Edit plan entry' : 'New plan entry'}</h2>
          <fieldset disabled={form.busy || (!form.id && form.uncertain)}>
            <label className="field">
              <span>Exercise</span>
              <select
                aria-label="Plan exercise"
                value={form.exerciseId}
                onChange={(e) =>
                  onDraft({ ...form, exerciseId: e.target.value, error: '' })
                }
                required
              >
                <option value="">Choose an exercise</option>
                {form.original &&
                  !exercises.some((e) => e.id === form.original!.id) && (
                    <option value={form.original.id}>
                      {form.original.name} · {exerciseStatus(form.original)}{' '}
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
            </label>
            <label className="field">
              <span>Date</span>
              <input
                aria-label="Entry date"
                type="date"
                min="0001-01-01"
                max="9999-12-31"
                value={form.plannedDate}
                onChange={(e) =>
                  onDraft({ ...form, plannedDate: e.target.value, error: '' })
                }
                required
              />
            </label>
            <label className="field">
              <span>Notes</span>
              <textarea
                aria-label="Plan notes"
                value={form.notes}
                maxLength={2000}
                rows={3}
                placeholder="For example, 3×10"
                onChange={(e) =>
                  onDraft({ ...form, notes: e.target.value, error: '' })
                }
              />
            </label>
          </fieldset>
          {form.error && <Notice error>{form.error}</Notice>}
          {form.uncertain && !form.id ? (
            <>
              <p className="fine muted">
                This entry may already have been saved. Reload and check the
                plan before adding another.
              </p>
              <button
                type="button"
                className="secondary wide"
                onClick={() => {
                  onDate(form.plannedDate);
                  list.reload();
                }}
              >
                Check plan list
              </button>
              <button
                type="button"
                className="text-button wide"
                onClick={() => onDraft(null)}
              >
                Close after reviewing
              </button>
            </>
          ) : (
            <>
              <button className="primary wide" disabled={form.busy}>
                {form.busy ? 'Saving…' : 'Save plan entry'}
              </button>
              <button
                type="button"
                className="text-button wide"
                disabled={form.busy}
                onClick={() => onDraft(null)}
              >
                Cancel plan edit
              </button>
            </>
          )}
        </form>
      )}
      {notice && <Notice>{notice}</Notice>}
      {(error || list.error) && <Notice error>{error || list.error}</Notice>}
      {list.loading ? (
        <p className="loading" role="status">
          Loading plan…
        </p>
      ) : !list.error && !list.items.length ? (
        <div className="empty">
          <h2>Make room for your next workout.</h2>
          <p>Add an exercise and any notes you want to bring with you.</p>
          <button className="text-button" onClick={onAddExercise}>
            Add new exercise
          </button>
        </div>
      ) : (
        <ol className="plan-list">
          {list.items.map((row, index) => (
            <li
              className="management-card"
              key={row.id}
              aria-label={row.exercise.name}
            >
              <div className="card-heading">
                <h2>{row.exercise.name}</h2>
                <span className="status-pill">
                  {exerciseStatus(row.exercise)}
                </span>
              </div>
              {row.notes && <p className="plan-notes">{row.notes}</p>}
              <div className="row-actions">
                <button
                  className="text-button"
                  disabled={!exercises.some((e) => e.id === row.exerciseId)}
                  onClick={() => onLog(row.exerciseId)}
                >
                  Log set ↗
                </button>
                <button disabled={!!draft || busy} onClick={() => edit(row)}>
                  Edit
                </button>
                <button
                  disabled={!!draft || busy}
                  onClick={() => remove(row)}
                  className="danger-text"
                >
                  Delete
                </button>
                <button
                  aria-label={`Move ${row.exercise.name} up`}
                  disabled={index === 0 || busy || !!draft}
                  onClick={() => move(index, -1)}
                >
                  ↑
                </button>
                <button
                  aria-label={`Move ${row.exercise.name} down`}
                  disabled={index === list.items.length - 1 || busy || !!draft}
                  onClick={() => move(index, 1)}
                >
                  ↓
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
