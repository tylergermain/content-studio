import { artifactKey, type ChatMessage, type ReviewNote } from '../../../shared/worker-chat';

// The screening room's notes (screening.ts): the ones you're writing on a cut, kept in this browser per worker and
// file until you send them, and what was already sent, read back from the reviews kept on the chat's messages. Pure,
// apart from the storage it's handed, so tests/screening-notes.test.ts runs it in node.

type FileRef = { root?: string; path: string };
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** The most notes one review may send, and the longest note (POST /api/worker-chat/review's limits). */
export const MAX_NOTES = 50;
export const MAX_NOTE = 1000;

const PREFIX = 'agent-office.screening-notes:';

/** Where the notes you're writing on one file are kept: one draft per worker and file (a share's file is its own). */
export function draftKey(workerId: string, file: FileRef): string {
  return `${PREFIX}${workerId}:${artifactKey(file)}`;
}

/** A note as a review takes it: one line, no control characters, at most MAX_NOTE characters. */
export function cleanNote(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim().slice(0, MAX_NOTE).trim();
}

const validAt = (at: unknown): at is number => typeof at === 'number' && Number.isFinite(at) && at >= 0;

/** Notes in the order they come in the cut. Two at the same time stay in the order they were written. */
export function sortNotes(notes: readonly ReviewNote[]): ReviewNote[] {
  return [...notes].sort((a, b) => a.at - b.at);
}

/** The notes with one more at `at` seconds, in order; the same notes when it says nothing or there's no room. */
export function addNote(notes: readonly ReviewNote[], at: number, text: string): ReviewNote[] {
  const clean = cleanNote(text);
  if (!clean || !validAt(at) || notes.length >= MAX_NOTES) return [...notes];
  return sortNotes([...notes, { at: Math.round(at * 100) / 100, text: clean }]);
}

/** Where clicking a note takes the player: two seconds before it, so you see what leads into it. */
export const seekBefore = (at: number) => Math.max(0, at - 2);

/** This page's localStorage, or none when the browser blocks it (reading the property can throw too). */
function local(): Store | undefined {
  try {
    return globalThis.localStorage ?? undefined;
  } catch {
    return undefined;
  }
}

/** The notes kept for a file, in order. Anything unreadable is left out, and a store that throws keeps nothing. */
export function loadDraft(key: string, store: Store | undefined = local()): ReviewNote[] {
  try {
    const list: unknown = JSON.parse(store?.getItem(key) ?? '[]');
    if (!Array.isArray(list)) return [];
    const notes = list.flatMap((n: Partial<ReviewNote> | null) => (n && validAt(n.at) && typeof n.text === 'string' && cleanNote(n.text) ? [{ at: n.at, text: cleanNote(n.text) }] : []));
    return sortNotes(notes).slice(0, MAX_NOTES);
  } catch {
    return [];
  }
}

/** Keeps the notes for a file (none forgets the draft). False when the browser wouldn't keep them. */
export function saveDraft(key: string, notes: readonly ReviewNote[], store: Store | undefined = local()): boolean {
  if (!store) return false;
  try {
    if (notes.length) store.setItem(key, JSON.stringify(notes));
    else store.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/**
 * A file's place among its versions: its key with every version number in its path (v01, V2) written as v#, so
 * jev-v01/renders/Jev-v01-4K60.mp4 and jev-v02/renders/Jev-v02-4K60.mp4 are one series.
 */
export function seriesKey(file: FileRef): string {
  return artifactKey({ root: file.root, path: file.path.replace(/(^|[^a-z0-9])v\d{1,3}(?![0-9])/gi, '$1v#') });
}

/** Notes that were sent on one file, with when. */
export interface SentNotes { file: FileRef; at?: number; notes: ReviewNote[] }

/** The notes left once `sent` went: the ones written while they were on their way stay. */
export function withoutNotes(notes: readonly ReviewNote[], sent: readonly ReviewNote[]): ReviewNote[] {
  const gone = new Set(sent.map((n) => `${n.at} ${n.text}`));
  return notes.filter((n) => !gone.has(`${n.at} ${n.text}`));
}

/**
 * The notes sent on `file` and on the other versions in its series, newest first, so watching v02 shows what was
 * asked of v01 and where.
 */
export function sentNotes(messages: readonly ChatMessage[], file: FileRef): SentNotes[] {
  const series = seriesKey(file), self = artifactKey(file);
  const out: SentNotes[] = [];
  for (const m of messages) {
    const r = m.review;
    if (r?.kind !== 'notes' || !Array.isArray(r.files) || !r.notes?.length) continue;
    const on = r.files.find((f) => artifactKey(f) === self) ?? r.files.find((f) => seriesKey(f) === series);
    const notes = sortNotes(r.notes.filter((n) => validAt(n.at) && typeof n.text === 'string'));
    if (on && notes.length) out.push({ file: { ...(on.root ? { root: on.root } : {}), path: on.path }, at: m.at, notes });
  }
  return out.reverse();
}
