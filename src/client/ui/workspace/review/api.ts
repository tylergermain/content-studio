import { store } from '../../../state';
import type { SoftwareNote, SoftwareReviewState } from '../../../../shared/software-review';

// Software review's requests (server/http/routes/review.ts), and the comments not sent yet, which
// this browser keeps per floor and worker so closing the review doesn't lose them. A project table's review
// (a subject of TABLE and its project room's id) goes to server/http/routes/table-review.ts instead.

/** A table's review is of `${TABLE}<project room id>` where a worker's is of its id. */
export const TABLE = 'table:';
export const isTable = (subject: string) => subject.startsWith(TABLE);

async function call(action: string, workerId: string, body?: unknown): Promise<{ state: SoftwareReviewState; hired?: { id: string; name: string } }> {
  const params = new URLSearchParams(isTable(workerId) ? { floor: store.floor ?? '', room: workerId.slice(TABLE.length) } : { floor: store.floor ?? '', worker: workerId });
  const res = await fetch(`/api/${isTable(workerId) ? 'table-review' : 'review'}/${action}?${params}`, body === undefined
    ? { credentials: 'same-origin' }
    : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...(body as object), by: myName() }) });
  const out = await res.json().catch(() => undefined);
  if (!res.ok || !out?.state) throw new Error(out?.error ?? 'The office didn’t answer');
  return out;
}

/** Who's reviewing: their account, or the name they came in with on the shared password. */
export const myName = () => store.me.account?.name ?? store.profile.name ?? 'You';

const messageId = () => `review-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const loadReview = (workerId: string) => call('state', workerId).then((r) => r.state);
export const sendRound = (workerId: string, app: string, size: { w: number; h: number; label?: string }, notes: SoftwareNote[]) =>
  call('notes', workerId, { requestId: messageId(), app, size, notes }).then((r) => r.state);
export const markDone = (workerId: string, id: string, done: boolean) => call('done', workerId, { id, done }).then((r) => r.state);
export const approve = (workerId: string, app: string, on: boolean) => call('approve', workerId, { requestId: messageId(), app, on }).then((r) => r.state);
/** Hires a new agent at a table to get its app running: who. */
export const startTableApp = (subject: string) => call('start', subject, { requestId: messageId() }).then((r) => r.hired);

/** A comment written but not sent yet. */
export interface Draft extends SoftwareNote {
  id: string;
  /** The app it's on, as appAddress() says. */
  app: string;
  at: number;
}

const draftKey = (workerId: string) => `agent-office:review-drafts:${store.floor ?? ''}:${workerId}`;

export function loadDrafts(workerId: string): Draft[] {
  try {
    const v = JSON.parse(localStorage.getItem(draftKey(workerId)) ?? '[]');
    return Array.isArray(v) ? v.filter((d) => d && typeof d.id === 'string' && typeof d.text === 'string' && typeof d.page === 'string' && typeof d.app === 'string') : [];
  } catch {
    return [];
  }
}

export function saveDrafts(workerId: string, drafts: Draft[]): void {
  try {
    if (drafts.length) localStorage.setItem(draftKey(workerId), JSON.stringify(drafts));
    else localStorage.removeItem(draftKey(workerId));
  } catch {
    /* a private window: they last as long as the page */
  }
}
