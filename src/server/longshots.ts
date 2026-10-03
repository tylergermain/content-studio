import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { FARTHEST, SHOTS_KEPT, WINS_KEPT, rankShot, tallyWin, type HoopBoard, type LongShot, type Owned, type PigTally } from '../shared/longshots.js';

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * How often the building hears about one person's makes, at most (ms): a better one sooner than that
 * goes on the table at once, and is told about when the time's up.
 */
export const RECORD_EVERY = 3000;

/** Who made it, as the office knows them: their account (or their name, on the shared password), and how they show. */
export interface Shooter {
  owner: string;
  name: string;
  color: string;
}

/** What a make did to the table: where it went (1 is the top; 0 if it didn't change the table). */
export interface Recorded {
  rank: number;
  /** It's the longest anyone's sunk now: a new record. */
  first: boolean;
}

/**
 * The longest shots sunk at the hoop, one a person, and the games of PIG each person has won: one
 * table for the whole building, saved in the office's .agent-office/hoop.json beside arcade.json, so
 * it's still there after a restart. What goes on it is the office's own word (see shot-judge.ts):
 * this only keeps it, and keeps anyone's makes from being announced too often.
 */
export class LongShots {
  private shots: Owned<LongShot>[] = [];
  private wins: Owned<PigTally>[] = [];
  /** When each person's make was last announced, and the one waiting for its turn (see announce). */
  private last = new Map<string, number>();
  private waiting = new Map<string, { tell: () => void }>();
  private file: string;

  constructor(
    dataDir: string,
    private now = () => Date.now(),
    private later = (ms: number, fn: () => void) => void setTimeout(fn, ms).unref(),
  ) {
    this.file = path.join(dataDir, 'hoop.json');
    this.load();
  }

  /** The table as the pages show it: no one's account. */
  board(): HoopBoard {
    return { shots: this.shots.map(({ owner: _, ...s }) => s), wins: this.wins.map(({ owner: _, ...w }) => w) };
  }

  /** `who` sank one from `dist` meters out. Goes on the table at once if it's their longest yet and long enough for it. */
  record(who: Shooter, dist: number): Recorded {
    if (!Number.isFinite(dist) || dist <= 0 || dist > FARTHEST) return { rank: 0, first: false };
    const shot: Owned<LongShot> = { owner: who.owner, name: who.name.slice(0, 24), color: COLOR_RE.test(who.color) ? who.color : '#09ca59', dist: Math.round(dist * 10) / 10, at: this.now() };
    const { table, rank } = rankShot(this.shots, shot);
    if (!rank) return { rank: 0, first: false };
    this.shots = table;
    this.save();
    return { rank, first: rank === 1 };
  }

  /** Where `owner`'s row is on the table now (1 is the top), and how far out it was; undefined when they're not on it. */
  rowOf(owner: string): { rank: number; dist: number } | undefined {
    const i = this.shots.findIndex((s) => s.owner === owner);
    return i < 0 ? undefined : { rank: i + 1, dist: this.shots[i].dist };
  }

  /**
   * Tells the building about a make of `owner`'s (`tell`), at most once every RECORD_EVERY a person:
   * one sooner than that waits until the time's up, and a better one of theirs meanwhile goes instead.
   */
  announce(owner: string, tell: () => void) {
    const waiting = this.waiting.get(owner);
    if (waiting) return void (waiting.tell = tell);
    const wait = (this.last.get(owner) ?? -Infinity) + RECORD_EVERY - this.now();
    if (wait <= 0) {
      this.last.set(owner, this.now());
      return tell();
    }
    const next = { tell };
    this.waiting.set(owner, next);
    this.later(wait, () => {
      this.waiting.delete(owner);
      this.last.set(owner, this.now());
      next.tell();
    });
  }

  /** `who` won a game of PIG. */
  win(who: Shooter) {
    this.wins = tallyWin(this.wins, { owner: who.owner, name: who.name.slice(0, 24), color: COLOR_RE.test(who.color) ? who.color : '#09ca59' });
    this.save();
  }

  private load() {
    if (!existsSync(this.file)) return;
    try {
      const saved = JSON.parse(readFileSync(this.file, 'utf8')) as { shots?: unknown; wins?: unknown };
      const rows = (list: unknown) => (Array.isArray(list) ? (list as Record<string, unknown>[]).filter((e) => e && typeof e === 'object' && typeof e.owner === 'string' && typeof e.name === 'string' && e.name) : []);
      const color = (c: unknown) => (typeof c === 'string' && COLOR_RE.test(c) ? c : '#09ca59');
      for (const e of rows(saved.shots)) {
        if (typeof e.dist !== 'number' || !(e.dist > 0 && e.dist <= FARTHEST) || typeof e.at !== 'number' || !Number.isFinite(e.at)) continue;
        this.shots = rankShot(this.shots, { owner: e.owner as string, name: (e.name as string).slice(0, 24), color: color(e.color), dist: Math.round(e.dist * 10) / 10, at: e.at }).table;
      }
      this.shots = this.shots.slice(0, SHOTS_KEPT);
      for (const e of rows(saved.wins)) {
        const wins = typeof e.wins === 'number' && Number.isInteger(e.wins) && e.wins > 0 ? e.wins : 0;
        if (wins && !this.wins.some((w) => w.owner === e.owner)) this.wins.push({ owner: e.owner as string, name: (e.name as string).slice(0, 24), color: color(e.color), wins });
      }
      this.wins = this.wins.sort((a, b) => b.wins - a.wins).slice(0, WINS_KEPT);
    } catch {
      // a broken file just means a fresh table
    }
  }

  private save() {
    try {
      writeFileSync(this.file, JSON.stringify({ shots: this.shots, wins: this.wins }, null, 2), { mode: 0o600 });
    } catch {
      // disk issues shouldn't take the office down
    }
  }
}
