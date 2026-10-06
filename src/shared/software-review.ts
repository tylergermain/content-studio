// Software review (the Review app, client/ui/workspace/review.ts): a worker's running app or site,
// used in the office, with comments pinned to its elements and sent back as one request. The page
// itself comes through the office's relay to the worker's server (server/relay.ts), which adds a
// small script to it in review mode (server/review/), so clicking an element says which one it is.
// No Node and no DOM here: both sides read it.

/** Where the relay answers for review mode on a worker's server, and the script it adds to its pages. */
export const REVIEW_START = '/__agent-office/review';
export const REVIEW_SCRIPT = '/__agent-office/review.js';
/** What every message between the office and the script inside the page carries, so neither mistakes another page's. */
export const REVIEW_TAG = 'agent-office-review';

/** Sizes to see the app at: as wide and tall as each is, in CSS pixels. */
export const DEVICES = [
  { id: 'desktop', label: 'Desktop', w: 1440, h: 900 },
  { id: 'laptop', label: 'Laptop', w: 1280, h: 800 },
  { id: 'tablet', label: 'Tablet', w: 820, h: 1180 },
  { id: 'phone', label: 'Phone', w: 390, h: 844 },
] as const;
export type DeviceId = (typeof DEVICES)[number]['id'];

/** What the script inside the page says about an element someone clicked in comment mode. */
export interface ReviewPick {
  /** A CSS selector that finds it again, from the page's body. */
  selector: string;
  /** What it is in a few words: a button and what it says, a heading, a picture. */
  what: string;
  /** Where on the page it was, in the page's CSS pixels as it was scrolled. */
  rect: { x: number; y: number; w: number; h: number };
}

/**
 * An area of a page a comment is about, drawn round what's in it: a box dragged out, or a ring drawn by hand. Its
 * bounds are in the page's CSS pixels from the top of the document (so it stays put as the page scrolls), a ring's
 * points are relative to them (x, y, x, y\u2026 each 0 to 1), and `items` is what it takes in, so the worker finds it.
 */
export interface ReviewArea {
  shape: 'rect' | 'lasso';
  x: number;
  y: number;
  w: number;
  h: number;
  points?: number[];
  items: { what: string; selector: string }[];
}

/** A comment pinned to an element of a page, or to an area of it, as it's sent. With neither it's about the page as a whole. */
export interface SoftwareNote {
  text: string;
  /** The page it's on (its path and query on the worker's server, or a full address). */
  page: string;
  what: string;
  selector: string;
  area?: ReviewArea;
}

export const MAX_AREA_ITEMS = 12;
const MAX_POINTS = 64;

/** An area from somewhere it can't be trusted: well formed, or nothing. */
export function cleanArea(raw: unknown): ReviewArea | undefined {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const n = (v: unknown, max = 200_000) => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= max ? Math.round(v) : undefined);
  const x = n(r.x), y = n(r.y), w = n(r.w), h = n(r.h);
  if ((r.shape !== 'rect' && r.shape !== 'lasso') || x === undefined || y === undefined || !w || !h || w < 0 || h < 0) return undefined;
  const items = (Array.isArray(r.items) ? r.items : []).slice(0, MAX_AREA_ITEMS).flatMap((i) => {
    const o = (i && typeof i === 'object' ? i : {}) as Record<string, unknown>;
    const what = typeof o.what === 'string' && o.what.length <= 300 && !/[\x00-\x1f]/.test(o.what) ? o.what.trim() : '';
    const selector = typeof o.selector === 'string' && o.selector.length <= 600 && !/[\x00-\x1f]/.test(o.selector) ? o.selector.trim() : '';
    return what && selector ? [{ what, selector }] : [];
  });
  const points = r.shape === 'lasso' && Array.isArray(r.points)
    ? r.points.slice(0, MAX_POINTS * 2).filter((p): p is number => typeof p === 'number' && Number.isFinite(p)).map((p) => Math.round(Math.max(0, Math.min(1, p)) * 1000) / 1000)
    : undefined;
  return { shape: r.shape, x, y, w, h, ...(points && points.length >= 6 && points.length % 2 === 0 ? { points } : {}), items };
}

/** An area in a few words: what it takes in. */
export function areaWhat(a: Pick<ReviewArea, 'shape' | 'items'>): string {
  const shape = a.shape === 'rect' ? 'the box drawn' : 'the area circled';
  if (!a.items.length) return shape;
  const first = a.items.slice(0, 3).map((i) => i.what).join(', ');
  return `${shape} round ${first}${a.items.length > 3 ? ` and ${a.items.length - 3} more` : ''}`;
}

/** What a comment about a whole page says it's on. */
export const WHOLE_PAGE = 'the page as a whole';

/** A comment once it's sent, as the office keeps it: numbered across the review, with who wrote it and whether it's done. */
export interface SentComment extends SoftwareNote {
  id: string;
  /** Its number across the whole review, the one its pin shows. */
  n: number;
  /** The round it was sent in (1, 2, …). */
  round: number;
  /** The app it's on (its address as the worker knows it). */
  app: string;
  by: string;
  at: number;
  done?: { by: string; at: number };
}

/** One Send: the comments that went to the worker together, the app and the size they were seen at. */
export interface ReviewRound {
  n: number;
  at: number;
  by: string;
  app: string;
  size: { w: number; h: number; label?: string };
  /** Who it went to, for a table's review: the new agent hired at the table to do it. */
  to?: string;
}

/** A worker's software review as the office keeps it: every round sent, every comment, and whether it's approved. */
export interface SoftwareReviewState {
  rounds: ReviewRound[];
  comments: SentComment[];
  approved?: { by: string; at: number; app: string };
}

export const EMPTY_REVIEW: SoftwareReviewState = { rounds: [], comments: [] };

export type ReviewStatus = 'new' | 'changes' | 'approved';
export const STATUS_LABEL: Record<ReviewStatus, string> = { new: 'Needs review', changes: 'Changes requested', approved: 'Approved' };

/** Where a review stands: approved, waiting on comments that aren't done yet, or waiting for someone to look. */
export function reviewStatus(s: SoftwareReviewState): ReviewStatus {
  if (s.approved) return 'approved';
  return s.comments.some((c) => !c.done) ? 'changes' : 'new';
}

const MAX_NOTES = 50;
const MAX_TEXT = 1000;
const MAX_FIELD = 600;
const CONTROL = /[\x00-\x08\x0b-\x1f\x7f]/;

/** Comments from somewhere they can't be trusted (a browser): each one fit to send, or why not. */
export function cleanSoftwareNotes(raw: unknown): SoftwareNote[] | string {
  if (!Array.isArray(raw) || !raw.length) return 'Add a comment first';
  if (raw.length > MAX_NOTES) return `Send up to ${MAX_NOTES} comments at a time`;
  const out: SoftwareNote[] = [];
  for (const n of raw) {
    const r = (n && typeof n === 'object' ? n : {}) as Record<string, unknown>;
    const field = (v: unknown, max: number) => (typeof v === 'string' && v.trim() && v.length <= max && !CONTROL.test(v) ? v.trim() : undefined);
    const text = field(r.text, MAX_TEXT);
    const page = field(r.page, MAX_FIELD);
    const what = field(r.what, MAX_FIELD);
    const selector = field(r.selector, MAX_FIELD);
    const area = cleanArea(r.area);
    if (!text) return `Write each comment in up to ${MAX_TEXT.toLocaleString('en-US')} characters`;
    if (!page) return 'Say which page each comment is on';
    // An area drawn on the page: what it takes in says what it is.
    if (area) {
      out.push({ text, page, what: what ?? areaWhat(area), selector: '', area });
      continue;
    }
    // No selector: a comment on the page as a whole.
    if (selector && !what) return 'Say what each comment is pinned to';
    out.push({ text, page, what: selector ? what! : WHOLE_PAGE, selector: selector ?? '' });
  }
  return out;
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

/** An area as the worker reads it: where it is on the page, and what it takes in, each by its selector. */
function areaLine(a: ReviewArea): string {
  const where = `${a.shape === 'rect' ? 'the box' : 'the area circled'} ${a.w}x${a.h} at (${a.x}, ${a.y}) from the top left of the page`;
  if (!a.items.length) return where;
  return `${where}, taking in ${a.items.map((i) => `${oneLine(i.what)} (\`${i.selector}\`)`).join(', ')}`;
}

/**
 * The request a review sends the worker: the app (`app`, its address), the size it was seen at, and
 * each comment with the page, the element and the selector that finds it, by its number in the review (`n`) when it has
 * one, so the worker's answer matches the pins. Never an em dash.
 */
export function softwareReviewText(app: string, size: { w: number; h: number; label?: string }, notes: (SoftwareNote & { n?: number })[], text?: string, fresh = false): string {
  const seen = `${size.label ? `${size.label}, ` : ''}${size.w}x${size.h}`;
  const lines = notes.map((n, i) => `${n.n ?? i + 1}. On ${oneLine(n.page)}, ${n.area ? areaLine(n.area) : n.selector ? `${oneLine(n.what)} (\`${n.selector}\`)` : WHOLE_PAGE}: ${oneLine(n.text)}`);
  return [
    `Review comments on the running app at ${app} (seen at ${seen}):`,
    lines.join('\n'),
    ...(text?.trim() ? [text.trim()] : []),
    // A new agent at a table (fresh) has its own worktree: the app above is someone else's copy, so it runs its own.
    fresh
      ? 'You are new at this table, in your own worktree of the project: the app above runs from another copy of it. Make these changes in your worktree, then run its dev server from there on a free port and leave it running, so they can be reviewed at the table. Find each element by its selector, and when you are done, say what you changed for each comment by its number, then commit, push your branch and open a pull request.'
      : 'Fix these in the code and keep the server running: I review the changes in the same app as they reload. Find each element by its selector, and when you are done, say what you changed for each comment by its number.',
  ].join('\n\n');
}
