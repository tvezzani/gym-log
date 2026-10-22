import { useRef, useState, type FormEvent } from 'react';
import { z } from 'zod';
import {
  accountListSchema,
  accountCreateSchema,
  accountResetSchema,
  userSchema,
  exerciseListSchema,
  exerciseSchema,
  exercisePatchSchema,
  type User,
  type Exercise,
} from '@gym-log/contracts';
import { api, message } from './api';
import { Notice } from './components';
import { Secret } from './Auth';
import {
  baseDraft,
  failure,
  useRemoteList,
  exerciseStatus,
  type ManagementProps,
} from './management';
export function Accounts({
  user,
  draft,
  onDraft,
  revision,
  onChanged,
  onSignedOut,
}: ManagementProps & { onSignedOut: (note: string) => void }) {
  const list = useRemoteList(
      '/admin/users',
      accountListSchema,
      `${user.id}:${revision}`,
    ),
    form = draft?.kind === 'account' || draft?.kind === 'reset' ? draft : null;
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const inFlight = useRef(false);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form || form.busy || inFlight.current) return;
    let input;
    try {
      input =
        form.kind === 'account'
          ? accountCreateSchema.parse({
              username: form.username.trim().toLowerCase(),
              password: form.password,
              role: form.role,
              timeZone: form.timeZone.trim(),
            })
          : accountResetSchema.parse({ temporaryPassword: form.password });
    } catch (e) {
      onDraft(failure(form, e));
      return;
    }
    inFlight.current = true;
    onDraft({ ...form, busy: true, error: '' });
    try {
      if (form.kind === 'account') {
        const created = await api.request(
          '/admin/users',
          userSchema,
          'POST',
          input,
        );
        setNotice(
          `Account ${created.username} created. They must change their temporary password when they log in.`,
        );
      } else {
        await api.request(
          `/admin/users/${form.target.id}/reset-password`,
          z.undefined(),
          'POST',
          input,
        );
        setNotice(
          `Password reset for ${form.target.username}. All their sessions were signed out.`,
        );
      }
      onDraft(null);
      onChanged();
      list.reload();
      if (form.kind === 'reset' && form.target.id === user.id)
        onSignedOut(
          'Your password was reset. Log in with the temporary password, then choose a new one.',
        );
    } catch (e) {
      onDraft(failure(form, e));
    } finally {
      inFlight.current = false;
    }
  }
  async function update(
    target: User,
    change: { role?: User['role']; isActive?: boolean },
  ) {
    if (busy || inFlight.current) return;
    if (
      !window.confirm(
        `${change.role ? `Change ${target.username} to ${change.role}` : `${change.isActive ? 'Enable' : 'Disable'} ${target.username}`}? Role changes and disabling sign out that account.`,
      )
    )
      return;
    setBusy(true);
    inFlight.current = true;
    setError('');
    try {
      const next = await api.request(
        `/admin/users/${target.id}`,
        userSchema,
        'PATCH',
        change,
      );
      setNotice(`Updated ${next.username}.`);
      onChanged();
      list.reload();
      if (target.id === user.id && (!next.isActive || next.role !== user.role))
        onSignedOut('Your account changed. Log in again to continue.');
    } catch (e) {
      setError(message(e));
      list.reload();
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  }
  return (
    <section className="management-screen" aria-label="Account administration">
      <p className="fine muted">
        Manage accounts and access. Workouts and plans stay private to their
        owners.
      </p>
      <div className="screen-tools">
        <button
          className="primary"
          disabled={!!draft || busy}
          onClick={() =>
            onDraft({
              ...baseDraft(user),
              kind: 'account',
              username: '',
              password: '',
              role: 'user',
              timeZone: user.timeZone,
            })
          }
        >
          Create account
        </button>
        <button
          className="text-button"
          onClick={list.reload}
          disabled={list.loading}
        >
          Refresh accounts
        </button>
      </div>
      {form && (
        <form
          className="management-form"
          aria-label={
            form.kind === 'account' ? 'Create account' : 'Reset password'
          }
          onSubmit={save}
        >
          <h2>
            {form.kind === 'account'
              ? 'Create account'
              : `Reset ${form.target.username}’s password`}
          </h2>
          <fieldset disabled={form.busy}>
            {form.kind === 'account' && (
              <>
                <label className="field">
                  <span>Username</span>
                  <input
                    aria-label="New username"
                    value={form.username}
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    onChange={(e) =>
                      onDraft({ ...form, username: e.target.value, error: '' })
                    }
                    required
                    minLength={3}
                    maxLength={32}
                  />
                </label>
                <label className="field">
                  <span>Role</span>
                  <select
                    aria-label="Account role"
                    value={form.role}
                    onChange={(e) =>
                      onDraft({ ...form, role: e.target.value as User['role'] })
                    }
                  >
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                  </select>
                </label>
                <label className="field">
                  <span>Timezone</span>
                  <input
                    aria-label="Account timezone"
                    value={form.timeZone}
                    onChange={(e) =>
                      onDraft({ ...form, timeZone: e.target.value, error: '' })
                    }
                    required
                  />
                </label>
              </>
            )}
            <Secret
              label="Temporary password"
              name="temporaryPassword"
              value={form.password}
              onChange={(password) => onDraft({ ...form, password, error: '' })}
              autoComplete="new-password"
              minLength={12}
            />
            <p className="fine muted">
              12–128 characters. Share it directly; the user must change it on
              login.
              {form.kind === 'reset'
                ? ' Resetting revokes every session and does not enable a disabled account.'
                : ''}
            </p>
          </fieldset>
          {form.error && <Notice error>{form.error}</Notice>}
          {form.uncertain && (
            <p className="fine muted">
              The request may have completed. Refresh the account list to review
              its current state before continuing.
            </p>
          )}
          <button className="primary wide" disabled={form.busy}>
            {form.busy
              ? 'Saving…'
              : form.kind === 'account'
                ? 'Save account'
                : 'Reset password'}
          </button>
          <button
            className="text-button wide"
            type="button"
            disabled={form.busy}
            onClick={() => onDraft(null)}
          >
            Cancel account form
          </button>
        </form>
      )}
      {notice && <Notice>{notice}</Notice>}
      {(error || list.error) && <Notice error>{error || list.error}</Notice>}
      {list.loading ? (
        <p className="loading" role="status">
          Loading accounts…
        </p>
      ) : (
        list.items.map((target) => (
          <article
            className="management-card"
            aria-label={target.username}
            key={target.id}
          >
            <div className="card-heading">
              <h2>
                {target.username}
                {target.id === user.id ? ' (you)' : ''}
              </h2>
              <span className="status-pill">
                {target.role} · {target.isActive ? 'Active' : 'Disabled'}
              </span>
            </div>
            <p className="fine muted">
              {target.timeZone}
              {target.mustChangePassword ? ' · Password change required' : ''}
            </p>
            <div className="row-actions">
              <button
                disabled={busy || !!draft}
                onClick={() => update(target, { isActive: !target.isActive })}
              >
                {target.isActive ? 'Disable' : 'Enable'}
              </button>
              <button
                disabled={busy || !!draft}
                onClick={() =>
                  update(target, {
                    role: target.role === 'admin' ? 'user' : 'admin',
                  })
                }
              >
                Make {target.role === 'admin' ? 'user' : 'admin'}
              </button>
              <button
                disabled={busy || !!draft}
                onClick={() =>
                  onDraft({
                    ...baseDraft(user),
                    kind: 'reset',
                    target,
                    password: '',
                  })
                }
              >
                Reset password
              </button>
            </div>
          </article>
        ))
      )}
    </section>
  );
}
export function Catalog({
  user,
  draft,
  onDraft,
  revision,
  onChanged,
}: ManagementProps) {
  const [status, setStatus] = useState<Exercise['status']>('pending'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const inFlight = useRef(false);
  const list = useRemoteList(
      `/admin/exercises?status=${status}`,
      exerciseListSchema,
      `${user.id}:${revision}`,
    ),
    form = draft?.kind === 'rename' ? draft : null;
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form || form.busy || inFlight.current) return;
    let input;
    try {
      input = exercisePatchSchema.parse({ name: form.name.trim() });
    } catch (e) {
      onDraft(failure(form, e));
      return;
    }
    onDraft({ ...form, busy: true, error: '' });
    inFlight.current = true;
    try {
      await api.request(
        `/exercises/${form.exercise.id}`,
        exerciseSchema,
        'PATCH',
        input,
      );
      onDraft(null);
      onChanged();
      list.reload();
      setNotice('Exercise name updated everywhere it is used.');
    } catch (e) {
      onDraft(failure(form, e));
    } finally {
      inFlight.current = false;
    }
  }
  async function action(
    row: Exercise,
    kind: 'approve' | 'reject' | 'archive' | 'restore' | 'delete',
  ) {
    if (busy || inFlight.current) return;
    if (
      kind === 'delete' &&
      !window.confirm(
        `Permanently delete ${row.name}? This is allowed only when no workout or plan uses it.`,
      )
    )
      return;
    if (
      kind === 'reject' &&
      !window.confirm(
        `Reject ${row.name}? Existing records will remain, but new entries cannot use it.`,
      )
    )
      return;
    setBusy(true);
    inFlight.current = true;
    setError('');
    try {
      if (kind === 'delete')
        await api.request(`/exercises/${row.id}`, z.undefined(), 'DELETE');
      else if (kind === 'approve' || kind === 'reject')
        await api.request(
          `/admin/exercises/${row.id}/${kind}`,
          exerciseSchema,
          'POST',
        );
      else
        await api.request(`/exercises/${row.id}`, exerciseSchema, 'PATCH', {
          isArchived: kind === 'archive',
        });
      setNotice(
        kind === 'approve'
          ? 'Exercise approved and shared. Sets and plans remain private.'
          : kind === 'delete'
            ? 'Unused exercise deleted.'
            : 'Exercise updated.',
      );
      onChanged();
      list.reload();
    } catch (e) {
      setError(message(e));
      list.reload();
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  }
  return (
    <section className="management-screen" aria-label="Exercise administration">
      <p className="fine muted">
        Approve sharing, maintain names, or archive exercises. Delete only
        unused exercises; referenced exercises must be archived.
      </p>
      <div className="screen-tools">
        <label className="field compact">
          <span>Review status</span>
          <select
            aria-label="Review status"
            value={status}
            onChange={(e) => setStatus(e.target.value as Exercise['status'])}
            disabled={busy}
          >
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </label>
        <button
          className="text-button"
          onClick={list.reload}
          disabled={list.loading}
        >
          Refresh catalog
        </button>
      </div>
      {form && (
        <form
          className="management-form"
          aria-label="Rename exercise"
          onSubmit={save}
        >
          <h2>Rename exercise</h2>
          <label className="field">
            <span>Exercise name</span>
            <input
              aria-label="Exercise name"
              value={form.name}
              maxLength={120}
              required
              disabled={form.busy}
              onChange={(e) =>
                onDraft({ ...form, name: e.target.value, error: '' })
              }
            />
          </label>
          <p className="fine muted">
            The new name appears in existing history and plans.
          </p>
          {form.error && <Notice error>{form.error}</Notice>}
          <button className="primary wide" disabled={form.busy}>
            {form.busy ? 'Saving…' : 'Save name'}
          </button>
          <button
            className="text-button wide"
            type="button"
            disabled={form.busy}
            onClick={() => onDraft(null)}
          >
            Cancel rename
          </button>
        </form>
      )}
      {notice && <Notice>{notice}</Notice>}
      {(error || list.error) && <Notice error>{error || list.error}</Notice>}
      {list.loading ? (
        <p className="loading" role="status">
          Loading catalog…
        </p>
      ) : !list.items.length && !list.error ? (
        <p className="empty">No {status} exercises.</p>
      ) : (
        list.items.map((row) => (
          <article
            className="management-card"
            aria-label={row.name}
            key={row.id}
          >
            <h2>{row.name}</h2>
            <p className="status-pill">{exerciseStatus(row)}</p>
            <div className="row-actions">
              {row.status === 'pending' && (
                <>
                  <button
                    className="text-button"
                    disabled={busy || !!draft}
                    onClick={() => action(row, 'approve')}
                  >
                    Approve
                  </button>
                  <button
                    disabled={busy || !!draft}
                    onClick={() => action(row, 'reject')}
                  >
                    Reject
                  </button>
                </>
              )}
              <button
                disabled={busy || !!draft}
                onClick={() =>
                  onDraft({
                    ...baseDraft(user),
                    kind: 'rename',
                    exercise: row,
                    name: row.name,
                  })
                }
              >
                Rename
              </button>
              <button
                disabled={busy || !!draft}
                onClick={() =>
                  action(row, row.archivedAt ? 'restore' : 'archive')
                }
              >
                {row.archivedAt ? 'Unarchive' : 'Archive'}
              </button>
              <button
                className="danger-text"
                disabled={busy || !!draft}
                onClick={() => action(row, 'delete')}
              >
                Delete exercise
              </button>
            </div>
          </article>
        ))
      )}
    </section>
  );
}
