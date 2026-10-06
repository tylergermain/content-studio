import { store } from '../../state';

// Which notes sent to a worker are done (server/review/marks.ts): the checks in the screening room and the other
// rooms, by each note's key (`<message id>#<n>`), shared by everyone on the floor.

export type Marks = Record<string, { by: string; at: number }>;

/** Who's checking: their account, or the name they came in with on the shared password. */
export const myName = () => store.me.account?.name ?? store.profile.name ?? 'You';

/** The worker's marks, or with `set`, after marking one done (or not done again). */
export async function marks(workerId: string, set?: { key: string; done: boolean }): Promise<Marks> {
  const params = new URLSearchParams({ floor: store.floor ?? '', worker: workerId });
  const res = await fetch(`/api/review/marks?${params}`, set
    ? { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...set, by: myName() }) }
    : { credentials: 'same-origin' });
  const out = await res.json().catch(() => undefined);
  if (!res.ok || !out?.marks) throw new Error(out?.error ?? 'That didn’t save');
  return out.marks;
}
