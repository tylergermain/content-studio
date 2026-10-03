// The longest shots sunk at the hoop: the building's table, as the scoreboard beside the hoop shows it,
// and the maths behind it. The office keeps the table (see server/longshots.ts) and works out every
// make itself from the throw (see server/shot-judge.ts), so a page never says how far it was.

import { BALCONY, FLOOR } from './layout.js';
import { HOOP } from './hoop.js';

/** One person's longest make: who (as the office knows them), how far out (m, to a tenth), and when. */
export interface LongShot {
  name: string;
  color: string;
  dist: number;
  /** When it went in (ms since 1970). */
  at: number;
}

/** Games of PIG won, one row a person. */
export interface PigTally {
  name: string;
  color: string;
  wins: number;
}

/** The building's table: the longest makes, longest first, and the PIG winners, most wins first. */
export interface HoopBoard {
  shots: LongShot[];
  wins: PigTally[];
}

/** The longest makes kept, one a person. */
export const SHOTS_KEPT = 10;
/** How many of them the board on the wall has room for (the window shows them all). */
export const SHOTS_SHOWN = 6;
/** PIG winners kept on the table. */
export const WINS_KEPT = 20;

/** How far from the hoop a shot was, along the floor: from where it left the hand to the middle of the ring (m, unrounded). */
export function rimDistance(from: { x: number; z: number }): number {
  return Math.hypot(from.x - HOOP.rim.x, from.z - HOOP.rim.z);
}

/** The same to a tenth of a meter, as the board shows it. */
export function shotDistance(from: { x: number; z: number }): number {
  return Math.round(rimDistance(from) * 10) / 10;
}

/** `m` meters in whole feet, for the small print. */
export function inFeet(m: number): number {
  return Math.round(m * 3.28084);
}

/**
 * As far from the hoop as anyone can stand: the farthest corner of the floor or the balcony. No make
 * on the table is longer (the ball's top speed and the ceiling keep real ones well inside it).
 */
export const FARTHEST: number = Math.max(
  ...[FLOOR, BALCONY].flatMap((r) =>
    [
      [r.minX, r.minZ],
      [r.minX, r.maxZ],
      [r.maxX, r.minZ],
      [r.maxX, r.maxZ],
    ].map(([x, z]) => rimDistance({ x, z })),
  ),
);

/** A row of the table with whose it is (an account, or a name on the shared password): the office's, never sent out. */
export type Owned<T> = T & { owner: string };

/**
 * The table with `shot` made by `shot.owner`: it counts if it's their longest yet (once a person) and
 * long enough for the top SHOTS_KEPT. Longest first; of two the same length, the one sunk first.
 * Says where it went (1 is the top), or 0 if the table didn't change.
 */
export function rankShot<T extends Owned<LongShot>>(table: readonly T[], shot: T): { table: T[]; rank: number } {
  const theirs = table.find((s) => s.owner === shot.owner);
  if (theirs && theirs.dist >= shot.dist) return { table: [...table], rank: 0 };
  const next = [...table.filter((s) => s !== theirs), shot].sort(byLength).slice(0, SHOTS_KEPT);
  const rank = next.indexOf(shot) + 1;
  return rank ? { table: next, rank } : { table: [...table], rank: 0 };
}

function byLength(a: LongShot, b: LongShot): number {
  return b.dist - a.dist || a.at - b.at;
}

/** The tally with a win for `who`: most wins first, then whoever got there first; at most WINS_KEPT. */
export function tallyWin<T extends Owned<PigTally>>(table: readonly T[], who: Omit<T, 'wins'>): T[] {
  const was = table.find((t) => t.owner === who.owner);
  const row = { ...who, wins: (was?.wins ?? 0) + 1 } as T;
  // A stable sort: of two with as many wins, the one who had them first stays ahead.
  return [...table.filter((t) => t !== was), row].sort((a, b) => b.wins - a.wins).slice(0, WINS_KEPT);
}

/** "9.4 m", as the board and the toasts say it. */
export function metres(m: number): string {
  return `${m.toFixed(1)} m`;
}

/** "1st", "2nd", "3rd", "4th"… */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}
