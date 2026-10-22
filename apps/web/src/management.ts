import { useEffect, useState } from 'react';
import type { ZodType } from 'zod';
import { z } from 'zod';
import type { Exercise, Plan, User } from '@gym-log/contracts';
import { allPages, ApiError, message } from './api';
interface Base {
  ownerId: string;
  busy: boolean;
  error: string;
  uncertain: boolean;
}
export type ManagementDraft = Base &
  (
    | {
        kind: 'plan';
        id: string | null;
        exerciseId: string;
        plannedDate: string;
        notes: string;
        original: Plan['exercise'] | null;
      }
    | { kind: 'timezone'; timeZone: string }
    | {
        kind: 'account';
        username: string;
        password: string;
        role: User['role'];
        timeZone: string;
      }
    | { kind: 'reset'; target: User; password: string }
    | { kind: 'rename'; exercise: Exercise; name: string }
  );
export const baseDraft = (user: User): Base => ({
  ownerId: user.id,
  busy: false,
  error: '',
  uncertain: false,
});
export const draftView = (draft: ManagementDraft) =>
  draft.kind === 'plan'
    ? 'plan'
    : draft.kind === 'timezone'
      ? 'settings'
      : draft.kind === 'rename'
        ? 'catalog'
        : 'accounts';
export const failure = (
  draft: ManagementDraft,
  error: unknown,
): ManagementDraft => ({
  ...draft,
  busy: false,
  uncertain: draft.uncertain || (error instanceof ApiError && error.uncertain),
  error:
    error instanceof z.ZodError
      ? error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('. ')
      : message(error),
});
export function useRemoteList<T>(
  path: string,
  schema: ZodType<{ items: T[]; pagination: { hasMore: boolean } }>,
  revision: string | number,
) {
  const [items, setItems] = useState<T[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setItems([]);
    setError('');
    allPages(path, schema)
      .then((rows) => {
        if (live) setItems(rows);
      })
      .catch((e) => {
        if (live) setError(message(e));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [path, schema, revision, reloadKey]);
  return { items, loading, error, reload: () => setReloadKey((n) => n + 1) };
}
export interface ManagementProps {
  user: User;
  draft: ManagementDraft | null;
  onDraft: (draft: ManagementDraft | null) => void;
  revision: number;
  onChanged: () => void;
}
export const exerciseStatus = (exercise: {
  status: Exercise['status'];
  archivedAt: string | null;
}) =>
  exercise.archivedAt
    ? 'Archived'
    : exercise.status === 'approved'
      ? 'Approved · shared'
      : exercise.status === 'pending'
        ? 'Pending · private'
        : 'Rejected · unavailable';
