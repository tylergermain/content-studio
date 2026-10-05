import { artifactKey, type ReviewNote, type ReviewRequest } from '../../shared/worker-chat.js';
import { artifactPath } from './artifacts.js';
import { isReviewKind } from './history.js';
import { defaultRoot, shareFile } from './links.js';
import type { ShareGuard } from './shares.js';
import type { Floor } from '../floor.js';

// A review from a specialist's workspace (timestamped notes on a cut, an approval, a request for
// variations, a question) as the browser sends it. The prompt itself is written on the server by
// shared/workspace.ts's `reviewText`, from the files' real paths.

const MAX_FILES = 4, MAX_NOTES = 50, MAX_NOTE = 1000, MAX_TEXT = 4000, MAX_WHERE = 600;
/** The same rule as a typed message: no control characters but tab and newline. */
const CONTROL = /[\x00-\x08\x0b-\x1f\x7f]/;
const absent = (v: unknown) => v === undefined || v === null;

/** The review in a request body, checked and tidied (files de-duplicated, notes trimmed and in time order), or what's wrong with it. */
export function parseReview(body: unknown): ReviewRequest | { error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Invalid review' };
  const b = body as Record<string, unknown>, kind = b.kind;
  if (!isReviewKind(kind)) return { error: 'Choose notes, an approval, variations or a question' };
  if (typeof b.requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(b.requestId)) return { error: 'Invalid message id' };
  if (!Array.isArray(b.files) || !b.files.length || b.files.length > MAX_FILES) return { error: `Choose 1 to ${MAX_FILES} files` };
  const files: ReviewRequest['files'] = [], keys = new Set<string>();
  for (const f of b.files as unknown[]) {
    const { root, path: rel } = (f && typeof f === 'object' ? f : {}) as Record<string, unknown>;
    // No root (or an empty one) is the worker's own folder; otherwise a share's id.
    if (typeof rel !== 'string' || !rel || rel.length > 4096 || CONTROL.test(rel)) return { error: 'Choose files this chat shows' };
    if (!absent(root) && (typeof root !== 'string' || !/^[a-zA-Z0-9_-]{0,64}$/.test(root))) return { error: 'Choose files this chat shows' };
    const file = root ? { root: root as string, path: rel } : { path: rel };
    if (!keys.has(artifactKey(file))) { keys.add(artifactKey(file)); files.push(file); }
  }
  let notes: ReviewNote[] = [];
  if (!absent(b.notes)) {
    if (!Array.isArray(b.notes) || b.notes.length > MAX_NOTES) return { error: `Send up to ${MAX_NOTES} notes at a time` };
    for (const n of b.notes as unknown[]) {
      const { at, text, where } = (n && typeof n === 'object' ? n : {}) as Record<string, unknown>;
      if (typeof at !== 'number' || !Number.isFinite(at) || at < 0) return { error: 'Each note needs its time in the video' };
      if (typeof text !== 'string' || !text.trim() || text.length > MAX_NOTE || CONTROL.test(text)) return { error: `Write each note in up to ${MAX_NOTE.toLocaleString('en-US')} characters` };
      // A note on a design says which element it's pinned to (see shared/design-canvas.ts).
      if (!absent(where) && (typeof where !== 'string' || !where.trim() || where.length > MAX_WHERE || CONTROL.test(where))) return { error: 'Pin each note to an element of the design' };
      notes.push({ at: Math.round(at * 1000) / 1000, text: text.trim(), ...(typeof where === 'string' ? { where: where.trim() } : {}) });
    }
    notes = notes.sort((x, y) => x.at - y.at);
  }
  if (kind === 'notes' && !notes.length) return { error: 'Add a note first' };
  if (kind === 'notes' && files.length > 1) return { error: 'Notes go on one file at a time' };
  if (kind !== 'notes' && notes.length) return { error: 'Only notes on a cut carry timestamps' };
  if (!absent(b.text) && (typeof b.text !== 'string' || b.text.length > MAX_TEXT || CONTROL.test(b.text))) return { error: `Write up to ${MAX_TEXT.toLocaleString('en-US')} characters` };
  const text = typeof b.text === 'string' ? b.text.trim() : '';
  if (kind === 'question' && !text) return { error: 'Write your question first' };
  if (kind === 'variations' && !text) return { error: 'Say what the variations should try' };
  return { kind, requestId: b.requestId, files, ...(notes.length ? { notes } : {}), ...(text ? { text } : {}) };
}

/**
 * The real paths of `files`, each found through the same gate as GET /file: the worker's own folder,
 * or what it linked in a share. Undefined when any of them can't be opened there. The caller has
 * already passed the POST gate (`employeeWorkerError`), which is stricter than the view one.
 */
export async function reviewFiles(floor: Floor, id: string, guard: ShareGuard, files: { root?: string; path: string }[]): Promise<string[] | undefined> {
  const found: string[] = [];
  for (const f of files) {
    const real = f.root ? await shareFile(floor, id, guard, f.root, f.path) : await artifactPath(defaultRoot(floor, id), f.path);
    if (!real) return;
    found.push(real);
  }
  return found;
}
