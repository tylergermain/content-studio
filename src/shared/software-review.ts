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

/** A comment pinned to an element of a page, as it's sent. With no `selector` it's about the page as a whole. */
export interface SoftwareNote {
  text: string;
  /** The page it's on (its path and query on the worker's server, or a full address). */
  page: string;
  what: string;
  selector: string;
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
    if (!text) return `Write each comment in up to ${MAX_TEXT.toLocaleString('en-US')} characters`;
    if (!page) return 'Say which page each comment is on';
    // No selector: a comment on the page as a whole.
    if (selector && !what) return 'Say what each comment is pinned to';
    out.push({ text, page, what: selector ? what! : WHOLE_PAGE, selector: selector ?? '' });
  }
  return out;
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * The request a review sends the worker: the app (`app`, its address), the size it was seen at, and
 * each comment with the page, the element and the selector that finds it, by its number in the review (`n`) when it has
 * one, so the worker's answer matches the pins. Never an em dash.
 */
export function softwareReviewText(app: string, size: { w: number; h: number; label?: string }, notes: (SoftwareNote & { n?: number })[], text?: string): string {
  const seen = `${size.label ? `${size.label}, ` : ''}${size.w}x${size.h}`;
  const lines = notes.map((n, i) => `${n.n ?? i + 1}. On ${oneLine(n.page)}, ${n.selector ? `${oneLine(n.what)} (\`${n.selector}\`)` : WHOLE_PAGE}: ${oneLine(n.text)}`);
  return [
    `Review comments on the running app at ${app} (seen at ${seen}):`,
    lines.join('\n'),
    ...(text?.trim() ? [text.trim()] : []),
    'Fix these in the code and keep the server running: I review the changes in the same app as they reload. Find each element by its selector, and when you are done, say what you changed for each comment by its number.',
  ].join('\n\n');
}
