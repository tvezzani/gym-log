import { useState, type FormEvent } from 'react';
import { z } from 'zod';
import {
  setupCreateSchema,
  setupStatusSchema,
  csrfSchema,
  userSchema,
} from '@gym-log/contracts';
import { api, ApiError, message } from './api';
import { Secret } from './Auth';
import { Brand, Notice } from './components';

export function Setup({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState('admin'),
    [password, setPassword] = useState(''),
    [confirm, setConfirm] = useState(''),
    [zone, setZone] = useState(
      () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [completed, setCompleted] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (password !== confirm) {
      setError('Passwords must match.');
      return;
    }
    setBusy(true);
    try {
      const input = setupCreateSchema.parse({
        username: username.trim().toLowerCase(),
        password,
        timeZone: zone.trim(),
      });
      const csrf = await api.request('/auth/csrf', csrfSchema);
      api.csrf = csrf.csrfToken;
      await api.request('/auth/setup', userSchema, 'POST', input);
      setPassword('');
      setConfirm('');
      api.csrf = '';
      onDone();
    } catch (e) {
      setError(
        e instanceof z.ZodError
          ? e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('. ')
          : message(e),
      );
      if (
        e instanceof ApiError &&
        (e.uncertain || e.status === 409 || e.status === 403)
      ) {
        try {
          const status = await api.request('/auth/setup', setupStatusSchema);
          if (!status.setupRequired) {
            setPassword('');
            setConfirm('');
            setCompleted(true);
            setError(
              'Setup is complete. Continue to log in with the account that was created.',
            );
          }
        } catch {
          /* Preserve the form when completion cannot be checked. */
        }
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="password-page setup-page">
      <Brand />
      <p className="eyebrow">FIRST-TIME SETUP</p>
      <h1>Your log starts here.</h1>
      <p className="muted">
        Create the first admin account for this Gym Log. You’ll use it to sign
        in and manage family accounts.
      </p>
      <form onSubmit={submit}>
        <fieldset disabled={busy || completed}>
          <label className="field">
            <span>Username</span>
            <input
              aria-label="Username"
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              minLength={3}
              maxLength={32}
              autoFocus
            />
            <small className="muted">
              3–32 lowercase letters, numbers or underscores.
            </small>
          </label>
          <Secret
            label="Password"
            name="password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            minLength={12}
          />
          <Secret
            label="Confirm password"
            name="confirmPassword"
            value={confirm}
            onChange={setConfirm}
            autoComplete="new-password"
            minLength={12}
          />
          <p className="fine muted">
            Use 12–128 characters. This is the password you’ll sign in with.
          </p>
          <label className="field setup-zone">
            <span>Timezone</span>
            <input
              aria-label="Timezone"
              name="timeZone"
              value={zone}
              onChange={(e) => setZone(e.target.value)}
              required
            />
            <small className="muted">
              Used for Today and history. For example, America/Denver.
            </small>
          </label>
        </fieldset>
        {error && <Notice error={!completed}>{error}</Notice>}
        {completed ? (
          <button type="button" className="primary wide" onClick={onDone}>
            Continue to log in
          </button>
        ) : (
          <button className="primary wide" disabled={busy}>
            {busy ? 'Creating admin…' : 'Create admin account'}
          </button>
        )}
      </form>
    </main>
  );
}
