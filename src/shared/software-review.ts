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

/** A comment pinned to an element of a page, as it's sent. */
export interface SoftwareNote {
  text: string;
  /** The page it's on (its path and query on the worker's server, or a full address). */
  page: string;
  what: string;
  selector: string;
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
    if (!page || !what || !selector) return 'Pin each comment to an element of the page';
    out.push({ text, page, what, selector });
  }
  return out;
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * The request a review sends the worker: the app (`app`, its address), the size it was seen at, and
 * each comment with the page, the element and the selector that finds it. Never an em dash.
 */
export function softwareReviewText(app: string, size: { w: number; h: number; label?: string }, notes: SoftwareNote[], text?: string): string {
  const seen = `${size.label ? `${size.label}, ` : ''}${size.w}x${size.h}`;
  const lines = notes.map((n, i) => `${i + 1}. On ${oneLine(n.page)}, ${oneLine(n.what)} (\`${n.selector}\`): ${oneLine(n.text)}`);
  return [
    `Review comments on the running app at ${app} (seen at ${seen}):`,
    lines.join('\n'),
    ...(text?.trim() ? [text.trim()] : []),
    'Fix these in the code and keep the server running: I review the changes in the same app as they reload. Find each element by its selector, and when you are done, say what you changed for each comment.',
  ].join('\n\n');
}
