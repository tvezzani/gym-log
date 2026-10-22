import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import {
  setupStatusSchema,
  authSchema,
  exerciseListSchema,
  workoutListSchema,
  planListSchema,
  canSelectExercise,
  type User,
  type Exercise,
  type Workout,
  type Plan,
} from '@gym-log/contracts';
import { api, ApiError, allPages, message } from './api';
import { Setup } from './Setup';
import { Login, PasswordChange } from './Auth';
import { Brand, Icon, Modal, Notice } from './components';
import { Calendar } from './Calendar';
import { Composer } from './Composer';
import { AddExercise, type ExerciseDraft } from './AddExercise';
import { type Draft, makeDraft } from './draft';
import {
  todayIn,
  historyBounds,
  shiftDate,
  dateLabel,
  timeLabel,
} from './time';

export function App() {
  const [needsSetup, setNeedsSetup] = useState(false);
  const [user, setUser] = useState<User | null>(null),
    [starting, setStarting] = useState(true),
    [startupError, setStartupError] = useState(''),
    [loginNote, setLoginNote] = useState(''),
    [expected, setExpected] = useState('');
  const [view, setView] = useState<'today' | 'history' | 'password'>('today'),
    [date, setDate] = useState(''),
    [today, setToday] = useState(''),
    [calendar, setCalendar] = useState(false),
    [menu, setMenu] = useState(false);
  const [exercises, setExercises] = useState<Exercise[]>([]),
    [catalogError, setCatalogError] = useState(''),
    [rows, setRows] = useState<Workout[]>([]),
    [plans, setPlans] = useState<Plan[]>([]),
    [hasMore, setHasMore] = useState(false),
    [loading, setLoading] = useState(false),
    [loadingMore, setLoadingMore] = useState(false),
    [loadError, setLoadError] = useState(''),
    [filter, setFilter] = useState(''),
    [refresh, setRefresh] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null),
    [composer, setComposer] = useState(false),
    [selected, setSelected] = useState<Workout | null>(null),
    [deleting, setDeleting] = useState(false),
    [confirmDelete, setConfirmDelete] = useState(false),
    [actionError, setActionError] = useState(''),
    [notice, setNotice] = useState('');
  const [exerciseDraft, setExerciseDraft] = useState<ExerciseDraft | null>(
      null,
    ),
    [exerciseOpen, setExerciseOpen] = useState(false),
    [returnToComposer, setReturnToComposer] = useState(false);
  const acceptUser = useCallback((next: User) => {
    setRows([]);
    setPlans([]);
    setExercises([]);
    setFilter('');
    setNotice('');
    setMenu(false);
    setSelected(null);
    setCalendar(false);
    setUser(next);
    setStarting(false);
    setStartupError('');
    setExpected(next.username);
    setLoginNote('');
    const day = todayIn(next.timeZone);
    setToday(day);
    setDate((current) => current || day);
  }, []);
  useEffect(() => {
    api.onAuthError = (e) => {
      setLoginNote(
        e.code === 'PASSWORD_CHANGE_REQUIRED'
          ? 'Change your password before continuing.'
          : 'Your session ended. Log in again; your unsaved values are still here.',
      );
      setUser((old) =>
        e.code === 'PASSWORD_CHANGE_REQUIRED' && old
          ? { ...old, mustChangePassword: true }
          : null,
      );
      setComposer(false);
      setExerciseOpen(false);
      setSelected(null);
    };
    async function restore() {
      try {
        const setup = await api.request('/auth/setup', setupStatusSchema);
        if (setup.setupRequired) {
          setNeedsSetup(true);
          setStarting(false);
          return;
        }
        const session = await api.request('/auth/me', authSchema);
        api.csrf = session.csrfToken;
        acceptUser(session.user);
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 401))
          setStartupError(message(e));
        else setLoginNote('');
        setStarting(false);
      }
    }
    void restore();
    return () => {
      api.onAuthError = () => {};
    };
  }, [acceptUser]);
  useEffect(() => {
    if (!user) return;
    const tick = () => setToday(todayIn(user.timeZone));
    const timer = setInterval(tick, 30000);
    window.addEventListener('focus', tick);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', tick);
    };
  }, [user]);
  const activeDate = view === 'today' ? today : date;
  const listKey = `${user?.id}:${view}:${activeDate}:${filter}:${refresh}`;
  const listKeyRef = useRef(listKey);
  listKeyRef.current = listKey;
  useEffect(() => {
    if (!user || user.mustChangePassword) return;
    let live = true;
    setCatalogError('');
    Promise.all([
      allPages('/exercises', exerciseListSchema),
      allPages('/exercise-submissions', exerciseListSchema),
    ])
      .then(([shared, own]) => {
        if (live)
          setExercises(
            [
              ...new Map(
                [...shared, ...own]
                  .filter((e) => canSelectExercise(e, user.id))
                  .map((e) => [e.id, e]),
              ).values(),
            ].sort(
              (a, b) =>
                a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
            ),
          );
      })
      .catch((e) => {
        if (live) setCatalogError(message(e));
      });
    return () => {
      live = false;
    };
  }, [user?.id, user?.mustChangePassword, refresh]);
  useEffect(() => {
    if (!user || user.mustChangePassword || !activeDate || view === 'password')
      return;
    let live = true;
    setLoading(true);
    setRows([]);
    setPlans([]);
    setLoadError('');
    setHasMore(false);
    setSelected(null);
    const bounds = historyBounds(activeDate, user.timeZone);
    const query = new URLSearchParams({
      ...bounds,
      limit: '50',
      ...(filter ? { exerciseId: filter } : {}),
    });
    Promise.all([
      api.request(`/workouts?${query}`, workoutListSchema),
      view === 'today'
        ? allPages(
            `/planned-exercises?plannedDate=${activeDate}`,
            planListSchema,
          )
        : Promise.resolve([] as Plan[]),
    ])
      .then(([page, planned]) => {
        if (live) {
          setRows(page.items);
          setHasMore(page.pagination.hasMore);
          setPlans(planned);
        }
      })
      .catch((e) => {
        if (live) setLoadError(message(e));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [
    user?.id,
    user?.mustChangePassword,
    user?.timeZone,
    activeDate,
    filter,
    refresh,
    view,
  ]);
  useEffect(() => {
    if (!draft && !exerciseDraft) return;
    const prevent = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, [draft, exerciseDraft]);
  function newDraft(source?: Workout, edit = false, exerciseId = '') {
    if (!user) return;
    if (draft) {
      setComposer(true);
      setNotice(
        'Finish or discard your current draft before starting another set.',
      );
      return;
    }
    setNotice('');
    setDraft(
      makeDraft(
        user.id,
        user.timeZone,
        source && !edit ? today : activeDate,
        exerciseId,
        source,
        edit,
      ),
    );
    setSelected(null);
    setComposer(true);
  }
  function openAddExercise(fromComposer = false) {
    if (!user || (draft && draft.phase !== 'editing')) return;
    setExerciseDraft(
      (current) =>
        current ?? { ownerId: user.id, name: '', error: '', saving: false },
    );
    setReturnToComposer(fromComposer);
    setComposer(false);
    setSelected(null);
    setExerciseOpen(true);
  }
  function closeAddExercise() {
    setExerciseDraft(null);
    setExerciseOpen(false);
    setComposer(returnToComposer && !!draft);
    setRefresh((n) => n + 1);
  }
  function exerciseAdded(exercise: Exercise) {
    if (!user) return;
    setExercises((current) =>
      [...new Map([...current, exercise].map((e) => [e.id, e])).values()].sort(
        (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
      ),
    );
    setExerciseDraft(null);
    setExerciseOpen(false);
    setRefresh((n) => n + 1);
    setDraft((current) =>
      current
        ? {
            ...current,
            fields: { ...current.fields, exerciseId: exercise.id },
            error: '',
            fieldErrors: [],
          }
        : makeDraft(user.id, user.timeZone, activeDate, exercise.id),
    );
    setComposer(true);
    setNotice(
      `${exercise.name} added. Ready for your private log; sharing awaits admin approval.`,
    );
  }
  function saved(row: Workout, recovered = false) {
    setDraft(null);
    setComposer(false);
    setRefresh((n) => n + 1);
    setNotice(
      `${recovered ? 'Loaded current saved set — review before editing' : 'Saved'} · ${row.exercise.name} · ${row.weight} lbs × ${row.reps} · set ${row.setNumber}`,
    );
  }
  async function more() {
    if (!user || loadingMore) return;
    setLoadingMore(true);
    setLoadError('');
    const originalKey = listKey;
    try {
      const query = new URLSearchParams({
        ...historyBounds(activeDate, user.timeZone),
        limit: '50',
        offset: String(rows.length),
        ...(filter ? { exerciseId: filter } : {}),
      });
      const page = await api.request(`/workouts?${query}`, workoutListSchema);
      if (listKeyRef.current === originalKey) {
        setRows((previous) => [
          ...new Map(
            [...previous, ...page.items].map((r) => [r.id, r]),
          ).values(),
        ]);
        setHasMore(page.pagination.hasMore);
      }
    } catch (e) {
      setLoadError(message(e));
    } finally {
      setLoadingMore(false);
    }
  }
  async function remove() {
    if (!selected || deleting) return;
    setDeleting(true);
    setActionError('');
    try {
      await api.request(`/workouts/${selected.id}`, z.undefined(), 'DELETE');
      setSelected(null);
      setRefresh((n) => n + 1);
      setNotice('Set deleted.');
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        setSelected(null);
        setRefresh((n) => n + 1);
        setNotice('Set is already deleted.');
      } else setActionError(message(e));
    } finally {
      setDeleting(false);
    }
  }
  async function logout() {
    if (draft || exerciseDraft) {
      setNotice('Finish or discard your draft before logging out.');
      setMenu(false);
      return;
    }
    try {
      await api.request('/auth/logout', z.undefined(), 'POST');
      api.csrf = '';
      setUser(null);
      setExpected('');
      setRows([]);
      setPlans([]);
      setExercises([]);
      setDate('');
      setView('today');
      setMenu(false);
      setLoginNote('You’re logged out.');
    } catch (e) {
      setNotice(message(e));
    }
  }
  if (starting)
    return (
      <main className="splash">
        <Brand />
        <p role="status">Opening your log…</p>
      </main>
    );
  if (startupError)
    return (
      <main className="splash">
        <Brand />
        <Notice error>{startupError}</Notice>
        <button className="primary" onClick={() => window.location.reload()}>
          Try again
        </button>
      </main>
    );
  if (needsSetup)
    return (
      <Setup
        onDone={() => {
          setNeedsSetup(false);
          setExpected('');
          setLoginNote(
            'Admin account created. Log in with your chosen username and password.',
          );
        }}
      />
    );
  if (!user)
    return (
      <Login
        key={expected}
        expected={draft || exerciseDraft ? expected : ''}
        note={loginNote}
        onLogin={acceptUser}
      />
    );
  if (user.mustChangePassword || view === 'password')
    return (
      <PasswordChange
        required={user.mustChangePassword}
        onDone={() => {
          setUser(null);
          setView('today');
          setLoginNote(
            'Password changed. Log in with your new password. Your unsaved set, if any, is retained.',
          );
        }}
        {...(!user.mustChangePassword
          ? { onBack: () => setView('today') }
          : {})}
      />
    );
  const grouped = new Map<string, Workout[]>();
  for (const row of rows) {
    const group = grouped.get(row.exerciseId) ?? [];
    group.push(row);
    grouped.set(row.exerciseId, group);
  }
  const options = [
    ...new Map(
      [
        ...exercises.map((e) => [e.id, e.name] as const),
        ...rows.map((r) => [r.exerciseId, r.exercise.name] as const),
      ].map(([id, name]) => [id, { id, name }]),
    ).values(),
  ];
  return (
    <div className="app-shell">
      <header className="app-header">
        <a
          className="brand-link"
          href="#today"
          onClick={(e) => {
            e.preventDefault();
            setView('today');
            setFilter('');
          }}
          aria-label="Gym Log, Today"
        >
          <Brand />
        </a>
        <button
          className="icon-button accent"
          aria-label="Open menu"
          aria-expanded={menu}
          onClick={() => setMenu(!menu)}
        >
          <Icon name="menu" />
        </button>
      </header>
      {menu && (
        <nav className="menu" aria-label="Account">
          <span className="fine muted">
            @{user.username} · {user.role}
          </span>
          <span className="fine muted">{user.timeZone}</span>
          <button
            onClick={() => {
              setView('password');
              setMenu(false);
            }}
          >
            Change password
          </button>
          <button onClick={logout}>Log out</button>
          <p className="fine muted">
            Your sets and history stay private to your account.
          </p>
        </nav>
      )}
      <main className="log-main">
        <div className="welcome">
          <p className="eyebrow">
            {view === 'today'
              ? `WELCOME, ${user.username.toUpperCase()}`
              : 'YOUR WORK, RECORDED'}
          </p>
          <h1>
            {view === 'today' ? 'Let’s put in the work.' : 'Every set counts.'}
          </h1>
        </div>
        <nav className="tabs" aria-label="Log views">
          <button
            aria-current={view === 'today' ? 'page' : undefined}
            onClick={() => {
              setView('today');
              setFilter('');
            }}
          >
            Today
          </button>
          <button
            aria-current={view === 'history' ? 'page' : undefined}
            onClick={() => {
              setDate(today);
              setView('history');
              setFilter('');
            }}
          >
            History
          </button>
        </nav>
        <div className="date-bar">
          <button
            className="icon-button accent"
            aria-label="Previous day"
            disabled={loadingMore || activeDate === '0001-01-01'}
            onClick={() => {
              setDate(shiftDate(activeDate, -1));
              setView('history');
            }}
          >
            <Icon name="back" />
          </button>
          <button
            className="date-heading"
            onClick={() => setCalendar(true)}
            disabled={loadingMore}
          >
            {dateLabel(activeDate)}
            <Icon name="calendar" />
          </button>
          <button
            className="icon-button accent"
            aria-label="Next day"
            disabled={loadingMore || activeDate === '9999-12-31'}
            onClick={() => {
              setDate(shiftDate(activeDate, 1));
              setView('history');
            }}
          >
            <Icon name="next" />
          </button>
        </div>
        <div className="log-meta">
          <span className="fine muted">{user.timeZone}</span>
          <button
            className="text-button"
            disabled={loading || loadingMore}
            onClick={() => setRefresh((n) => n + 1)}
          >
            Refresh
          </button>
        </div>
        {notice && <Notice>{notice}</Notice>}
        {draft && (
          <div className="draft-banner">
            <div>
              <strong>
                {draft.phase === 'editing'
                  ? 'Unsaved set'
                  : 'Save needs attention'}
              </strong>
              <p className="fine muted">
                {draft.phase === 'editing'
                  ? 'Your values are kept while you browse.'
                  : 'Resolve this save before starting another set.'}
              </p>
            </div>
            <button onClick={() => setComposer(true)}>Resume</button>
            {draft.phase === 'editing' && (
              <button
                className="text-button"
                onClick={() => {
                  if (window.confirm('Discard this unsaved set?')) {
                    setDraft(null);
                    setComposer(false);
                  }
                }}
              >
                Discard
              </button>
            )}
          </div>
        )}
        {exerciseDraft && !exerciseOpen && (
          <div className="draft-banner">
            <div>
              <strong>Unsaved exercise</strong>
              <p className="fine muted">
                Your exercise name is kept while you log in.
              </p>
            </div>
            <button
              onClick={() => {
                setComposer(false);
                setExerciseOpen(true);
              }}
            >
              Resume exercise
            </button>
          </div>
        )}
        {catalogError && (
          <Notice error>
            Exercise list unavailable. {catalogError}{' '}
            <button
              className="text-button"
              onClick={() => setRefresh((n) => n + 1)}
            >
              Retry
            </button>
          </Notice>
        )}
        {view === 'history' && (
          <label className="filter field">
            <span>Exercise filter</span>
            <select
              value={filter}
              disabled={loadingMore}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="">All exercises</option>
              {filter && !options.some((o) => o.id === filter) && (
                <option value={filter}>Selected historical exercise</option>
              )}
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {loading ? (
          <div className="loading" role="status">
            <span className="loading-dot" />
            Loading your sets…
          </div>
        ) : (
          <>
            {loadError && (
              <Notice error>
                {loadError}{' '}
                <button
                  className="text-button"
                  onClick={() => setRefresh((n) => n + 1)}
                >
                  Retry
                </button>
              </Notice>
            )}
            {plans.length > 0 && (
              <section className="planned">
                <p className="eyebrow">
                  <span className="dot" />
                  ON YOUR PLAN
                </p>
                {plans.map((p) => (
                  <div key={p.id}>
                    <div>
                      <strong>{p.exercise.name}</strong>
                      {p.notes && <p className="fine muted">{p.notes}</p>}
                    </div>
                    <button
                      className="text-button"
                      disabled={!exercises.some((e) => e.id === p.exerciseId)}
                      onClick={() => newDraft(undefined, false, p.exerciseId)}
                    >
                      Log set <span aria-hidden="true">↗</span>
                    </button>
                  </div>
                ))}
              </section>
            )}
            <div className="section-label">
              <h2>{view === 'today' ? 'Your sets' : 'Logged sets'}</h2>
              <div className="section-actions">
                <span className="count">
                  {rows.length}
                  {hasMore ? '+' : ''}
                </span>
                <button
                  className="text-button"
                  onClick={() => openAddExercise()}
                  disabled={!!draft && draft.phase !== 'editing'}
                >
                  <Icon name="plus" /> Add new exercise
                </button>
              </div>
            </div>
            {!rows.length && !loadError ? (
              <section className="empty">
                <div className="empty-mark" aria-hidden="true">
                  <Icon name="plus" />
                </div>
                <h2>
                  {view === 'today' ? 'Start with one set.' : 'A clean page.'}
                </h2>
                <p>
                  {view === 'today'
                    ? 'Pick an exercise. Log your effort. Build from there.'
                    : 'No sets recorded for this date and filter. You can add a backdated set here.'}
                </p>
                <button className="primary" onClick={() => newDraft()}>
                  Log a set <Icon name="plus" />
                </button>
                {!exercises.length && !catalogError && (
                  <p className="fine muted">
                    Add a new exercise to start logging. You can use it
                    privately while it awaits approval.
                  </p>
                )}
              </section>
            ) : null}
            {[...grouped].map(([id, group]) => {
              const exercise = group[0]!.exercise;
              return (
                <details className="exercise-group" key={id} open>
                  <summary>
                    <span>
                      {exercise.name}
                      {(exercise.status !== 'approved' ||
                        exercise.archivedAt) && (
                        <small className="exercise-status">
                          {exercise.archivedAt
                            ? 'Archived'
                            : exercise.status === 'pending'
                              ? 'Pending · private'
                              : 'Rejected'}
                        </small>
                      )}
                    </span>
                    <span className="group-count">
                      {group.length} {group.length === 1 ? 'set' : 'sets'}
                    </span>
                    <span className="chevron" aria-hidden="true" />
                  </summary>
                  <div role="group" aria-label={`${exercise.name} sets`}>
                    <div
                      className="set-columns column-labels"
                      aria-hidden="true"
                    >
                      <span>lbs</span>
                      <span>reps</span>
                      <span className="accent">set</span>
                      <span>RPE</span>
                      <span />
                    </div>
                    {group.map((row) => (
                      <button
                        className="set-columns set-row"
                        key={row.id}
                        aria-label={`Set ${row.setNumber}, ${row.weight} pounds, ${row.reps} reps, RPE ${row.rpe}`}
                        onClick={() => {
                          setSelected(row);
                          setConfirmDelete(false);
                          setActionError('');
                        }}
                      >
                        <strong>{row.weight}</strong>
                        <span>{row.reps}</span>
                        <span className="accent">{row.setNumber}</span>
                        <span>{row.rpe}</span>
                        <span className="row-more" aria-hidden="true">
                          ···
                        </span>
                      </button>
                    ))}
                  </div>
                  <div className="group-footer">
                    <span className="fine muted">
                      Latest · {timeLabel(group[0]!.performedAt, user.timeZone)}
                    </span>
                    <button
                      className="text-button"
                      disabled={!exercises.some((e) => e.id === id)}
                      onClick={() => newDraft(undefined, false, id)}
                    >
                      <Icon name="plus" /> Add set
                    </button>
                  </div>
                </details>
              );
            })}
            {hasMore && (
              <button
                className="secondary wide"
                disabled={loadingMore}
                onClick={more}
              >
                {loadingMore ? 'Loading…' : 'Load more sets'}
              </button>
            )}
          </>
        )}
        <p className="end-note">One set at a time.</p>
      </main>
      <div className="floating-add">
        <button
          className="fab"
          aria-label={draft ? 'Resume unsaved set' : 'Log a set'}
          onClick={() => (draft ? setComposer(true) : newDraft())}
        >
          <Icon name="plus" />
        </button>
      </div>
      {calendar && (
        <Calendar
          value={activeDate}
          today={today}
          onClose={() => setCalendar(false)}
          onChoose={(day) => {
            setDate(day);
            setView(day === today ? 'today' : 'history');
            setCalendar(false);
          }}
        />
      )}
      {composer && draft && draft.ownerId === user.id && (
        <Composer
          draft={draft}
          setDraft={setDraft}
          exercises={exercises}
          onSaved={saved}
          onAddExercise={() => openAddExercise(true)}
          onClose={() => setComposer(false)}
        />
      )}
      {exerciseOpen && exerciseDraft && exerciseDraft.ownerId === user.id && (
        <AddExercise
          draft={exerciseDraft}
          onChange={setExerciseDraft}
          onAdded={exerciseAdded}
          onClose={closeAddExercise}
        />
      )}
      {selected && (
        <Modal
          title={`Set ${selected.setNumber}`}
          onClose={() => setSelected(null)}
          busy={deleting}
        >
          <div className="set-actions">
            <p className="eyebrow">{selected.exercise.name}</p>
            <h3>
              {selected.weight} <small>lbs</small> × {selected.reps}{' '}
              <small>reps</small>
            </h3>
            <p className="muted">
              RPE {selected.rpe} ·{' '}
              {today === activeDate ? 'Today' : dateLabel(activeDate)} ·{' '}
              {timeLabel(selected.performedAt, user.timeZone)}
            </p>
            <button
              className="secondary wide"
              onClick={() => newDraft(selected, true)}
              disabled={!!draft}
            >
              <Icon name="edit" /> Edit set
            </button>
            <button
              className="primary wide"
              disabled={
                !!draft ||
                !exercises.some((e) => e.id === selected.exerciseId) ||
                selected.setNumber >= 2147483647
              }
              onClick={() => newDraft(selected)}
            >
              <Icon name="copy" /> Copy as next set
            </button>
            <p className="fine muted">
              Copy keeps exercise, weight, reps and RPE. It uses a new time and
              the next set number, ready for your review.
            </p>
            {actionError && <Notice error>{actionError}</Notice>}
            {confirmDelete ? (
              <div className="delete-confirm">
                <p>Delete this set permanently?</p>
                <button
                  className="danger wide"
                  disabled={deleting}
                  onClick={remove}
                >
                  {deleting ? 'Deleting…' : 'Yes, delete set'}
                </button>
                <button
                  className="text-button wide"
                  disabled={deleting}
                  onClick={() => setConfirmDelete(false)}
                >
                  Keep set
                </button>
              </div>
            ) : (
              <button
                className="text-button danger-text wide"
                onClick={() => setConfirmDelete(true)}
                disabled={!!draft}
              >
                Delete set
              </button>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
