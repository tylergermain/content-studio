import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// Which of the notes sent to a worker are done (the screening room's checks, see
// client/ui/workspace/screening/): one file per worker in the floor's .agent-office/review-marks/,
// each note by its key, the message that carried it and its place there (`<message id>#<n>`).

export interface Mark { by: string; at: number }
export type Marks = Record<string, Mark>;

/** A note's key: the id of the message that sent it, and its number there. */
export const MARK_KEY = /^[A-Za-z0-9_-]{1,100}#\d{1,3}$/;
/** The marks kept: the newest, when a long review has had more. */
const KEEP = 2000;

const fileOf = (floorDir: string, id: string) => path.join(floorDir, '.agent-office', 'review-marks', `${id}.json`);

/** A worker's marks, keeping only what's well formed. */
export function reviewMarks(floorDir: string, id: string): Marks {
  try {
    const raw = JSON.parse(readFileSync(fileOf(floorDir, id), 'utf8')) as Record<string, unknown>;
    const out: Marks = {};
    for (const [k, v] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
      const m = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
      if (MARK_KEY.test(k) && typeof m.by === 'string' && m.by.length <= 200 && typeof m.at === 'number' && Number.isFinite(m.at)) out[k] = { by: m.by, at: m.at };
    }
    return out;
  } catch {
    return {};
  }
}

/** Marks one note done, or not done again. */
export function setMark(floorDir: string, id: string, key: string, done: boolean, by: string): Marks {
  const marks = reviewMarks(floorDir, id);
  if (done) marks[key] = { by, at: Date.now() };
  else delete marks[key];
  const kept = Object.fromEntries(Object.entries(marks).sort((a, b) => a[1].at - b[1].at).slice(-KEEP));
  const file = fileOf(floorDir, id);
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(`${file}.tmp`, JSON.stringify(kept), { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
  return kept;
}
