import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { EMPTY_REVIEW, type ReviewRound, type SentComment, type SoftwareNote, type SoftwareReviewState } from '../../shared/software-review.js';

// A worker's software review as the office keeps it (shared/software-review.ts): every round of
// comments sent, each comment with whether it's done, and whether the app is approved. One file per
// worker in the floor's .agent-office/software-review/, written whole each time.

/** The comments kept: the newest, when a long review has had more. */
const KEEP = 500;

const fileOf = (floorDir: string, id: string) => path.join(floorDir, '.agent-office', 'software-review', `${id}.json`);
const str = (v: unknown, max = 2000) => (typeof v === 'string' && v.length <= max ? v : undefined);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const who = (v: unknown) => {
  const r = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const by = str(r.by, 200), at = num(r.at);
  return by !== undefined && at !== undefined ? { by, at } : undefined;
};

/** A review read back from its file, keeping only what's well formed. */
export function cleanReview(raw: unknown): SoftwareReviewState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const rounds: ReviewRound[] = (Array.isArray(r.rounds) ? r.rounds : []).flatMap((x) => {
    const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    const s = (o.size && typeof o.size === 'object' ? o.size : {}) as Record<string, unknown>;
    const n = num(o.n), at = num(o.at), by = str(o.by, 200), app = str(o.app, 300), w = num(s.w), h = num(s.h);
    return n && at && by !== undefined && app && w && h ? [{ n, at, by, app, size: { w, h, ...(str(s.label, 20) ? { label: str(s.label, 20) } : {}) } }] : [];
  });
  const comments: SentComment[] = (Array.isArray(r.comments) ? r.comments : []).flatMap((x) => {
    const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    const id = str(o.id, 40), n = num(o.n), round = num(o.round), at = num(o.at), by = str(o.by, 200), app = str(o.app, 300);
    const text = str(o.text, 1000), page = str(o.page, 600), what = str(o.what, 600), selector = str(o.selector, 600);
    if (!id || !n || !round || !at || by === undefined || !app || !text || !page || !what || selector === undefined) return [];
    const done = who(o.done);
    return [{ id, n, round, at, by, app, text, page, what, selector, ...(done ? { done } : {}) }];
  });
  const approved = who(r.approved);
  const approvedApp = str((r.approved as Record<string, unknown> | undefined)?.app, 300);
  return { rounds, comments, ...(approved && approvedApp ? { approved: { ...approved, app: approvedApp } } : {}) };
}

/** A worker's review: nothing yet when it has none. */
export function reviewState(floorDir: string, id: string): SoftwareReviewState {
  try {
    return cleanReview(JSON.parse(readFileSync(fileOf(floorDir, id), 'utf8')));
  } catch {
    return { ...EMPTY_REVIEW, rounds: [], comments: [] };
  }
}

function save(floorDir: string, id: string, s: SoftwareReviewState): SoftwareReviewState {
  const file = fileOf(floorDir, id);
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const kept = { ...s, comments: s.comments.slice(-KEEP) };
  writeFileSync(`${file}.tmp`, JSON.stringify(kept), { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
  return kept;
}

/** The numbers the next round's comments get, for the request to name them by. */
export function nextNumbers(s: SoftwareReviewState, count: number): number[] {
  const from = s.comments.reduce((m, c) => Math.max(m, c.n), 0) + 1;
  return Array.from({ length: count }, (_, i) => from + i);
}

/** Keeps a round just sent: its comments numbered on from the last, and the approval gone, since there's more to do. */
export function addRound(floorDir: string, id: string, round: Omit<ReviewRound, 'n'>, notes: SoftwareNote[]): SoftwareReviewState {
  const s = reviewState(floorDir, id);
  const n = s.rounds.reduce((m, r) => Math.max(m, r.n), 0) + 1;
  const numbers = nextNumbers(s, notes.length);
  const comments = notes.map((note, i): SentComment => ({ ...note, id: `c${numbers[i]}`, n: numbers[i], round: n, app: round.app, by: round.by, at: round.at }));
  return save(floorDir, id, { rounds: [...s.rounds, { ...round, n }], comments: [...s.comments, ...comments] });
}

/** Marks a comment done, or not done again. Undefined when there's no such comment. */
export function markDone(floorDir: string, id: string, commentId: string, done: boolean, by: string): SoftwareReviewState | undefined {
  const s = reviewState(floorDir, id);
  if (!s.comments.some((c) => c.id === commentId)) return undefined;
  const comments = s.comments.map((c) => {
    if (c.id !== commentId) return c;
    const { done: _, ...rest } = c;
    return done ? { ...rest, done: { by, at: Date.now() } } : rest;
  });
  return save(floorDir, id, { ...s, comments });
}

/** Approves the app as it is (`app`), or takes the approval back. */
export function setApproved(floorDir: string, id: string, on: boolean, by: string, app: string): SoftwareReviewState {
  const { approved: _, ...s } = reviewState(floorDir, id);
  return save(floorDir, id, on ? { ...s, approved: { by, at: Date.now(), app } } : s);
}
