import { useState, type FormEvent } from 'react';
import { z } from 'zod';
import {
  authSchema,
  csrfSchema,
  loginSchema,
  passwordChangeSchema,
  type User,
} from '@gym-log/contracts';
import { api, message } from './api';
import { Brand, Icon, Notice } from './components';
export function Secret({
  label,
  name,
  value,
  onChange,
  autoComplete,
  minLength = 1,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  minLength?: number;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <label className="field">
      <span>{label}</span>
      <span className="secret">
        <input
          name={name}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          required
          minLength={minLength}
          maxLength={128}
        />
        <button
          type="button"
          className="icon-button"
          aria-label={
            visible
              ? `Hide ${label.toLowerCase()}`
              : `Show ${label.toLowerCase()}`
          }
          aria-pressed={visible}
          onClick={() => setVisible(!visible)}
        >
          <Icon name="eye" />
        </button>
      </span>
    </label>
  );
}
export function Login({
  onLogin,
  expected = '',
  note = '',
}: {
  onLogin: (u: User) => void;
  expected?: string;
  note?: string;
}) {
  const [username, setUsername] = useState(expected),
    [password, setPassword] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const input = loginSchema.parse({
        username: username.trim().toLowerCase(),
        password,
      });
      const pre = await api.request('/auth/csrf', csrfSchema);
      api.csrf = pre.csrfToken;
      const result = await api.request(
        '/auth/login',
        authSchema,
        'POST',
        input,
      );
      api.csrf = result.csrfToken;
      setPassword('');
      onLogin(result.user);
    } catch (e) {
      setError(
        e instanceof z.ZodError
          ? 'Enter your username and password.'
          : message(e),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login">
      <div className="login-brand">
        <Brand />
        <p>Your effort. One set at a time.</p>
      </div>
      <form onSubmit={submit} className="login-form">
        <div>
          <p className="eyebrow">WELCOME BACK</p>
          <h1>Let’s get to work.</h1>
        </div>
        {note && <Notice>{note}</Notice>}
        <fieldset disabled={busy}>
          <label className="field">
            <span>Username</span>
            <input
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              readOnly={!!expected}
              required
              autoFocus
            />
          </label>
          <Secret
            label="Password"
            name="password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
          />
        </fieldset>
        {error && <Notice error>{error}</Notice>}
        <button className="primary wide" disabled={busy}>
          {busy ? 'Logging in…' : 'Log in'}
          <span aria-hidden="true">↗</span>
        </button>
        <p className="muted fine">Your account is managed by your admin.</p>
      </form>
      <p className="login-footer">A little stronger, every day.</p>
    </main>
  );
}
export function PasswordChange({
  required,
  onDone,
  onBack,
}: {
  required: boolean;
  onDone: () => void;
  onBack?: () => void;
}) {
  const [current, setCurrent] = useState(''),
    [next, setNext] = useState(''),
    [confirm, setConfirm] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next !== confirm) {
      setError('New passwords must match.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const input = passwordChangeSchema.parse({
        currentPassword: current,
        newPassword: next,
      });
      await api.request('/auth/password', z.undefined(), 'PATCH', input);
      api.csrf = '';
      onDone();
    } catch (e) {
      setError(
        e instanceof z.ZodError
          ? e.issues.map((i) => i.message).join('. ')
          : message(e),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="password-page">
      <Brand />
      <p className="eyebrow">ACCOUNT SECURITY</p>
      <h1>{required ? 'Make it yours.' : 'Change password'}</h1>
      <p className="muted">
        {required
          ? 'Choose a new password before you start logging.'
          : 'Changing your password signs you out on every device.'}
      </p>
      <form onSubmit={submit}>
        <fieldset disabled={busy}>
          <Secret
            label="Current password"
            name="currentPassword"
            value={current}
            onChange={setCurrent}
            autoComplete="current-password"
          />
          <Secret
            label="New password"
            name="newPassword"
            value={next}
            onChange={setNext}
            autoComplete="new-password"
            minLength={12}
          />
          <Secret
            label="Confirm new password"
            name="confirmPassword"
            value={confirm}
            onChange={setConfirm}
            autoComplete="new-password"
            minLength={12}
          />
          <p className="fine muted">Use 12–128 characters.</p>
        </fieldset>
        {error && <Notice error>{error}</Notice>}
        <button className="primary wide" disabled={busy}>
          {busy ? 'Changing…' : 'Change password'}
        </button>
        {onBack && (
          <button
            className="text-button wide"
            type="button"
            onClick={onBack}
            disabled={busy}
          >
            Back to log
          </button>
        )}
      </form>
    </main>
  );
}
