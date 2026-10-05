// Putt Street's sums on the page, with no three.js and nothing of the DOM's, so the tests can run
// them: the putting meter, where a ball is along the path the office sent, whose ball is out on the
// hole and where, where you stand to putt it, and the scorecard's numbers and words.

import { ready } from '../../../shared/minigolf/compile';
import { lieAt, newLie } from '../../../shared/minigolf/surface';
import { PUTT_METER, STANCE, type Hole, type XZ } from '../../../shared/minigolf/types';
import { PUTT_RULES, type PuttBall, type PuttPlayer, type PuttRound } from '../../../shared/protocol';

/** Something with x, y and z to write a point into (a THREE.Vector3 is one). */
export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/**
 * How full the putting meter is `held` seconds after Space went down. It has golf's shape (see METER
 * in features/golf/controller.ts): from nothing to full in PUTT_METER.up seconds, then back down in
 * as long again, and round again for as long as you hold on.
 */
export function meterAt(held: number, up: number = PUTT_METER.up): number {
  if (!(held > 0) || !(up > 0)) return 0;
  const p = (held / up) % 2;
  return p > 1 ? 2 - p : p;
}

/** How long, in seconds, a path of `PUTT_RULES.samples` points a second lasts from the strike. */
export function rollSeconds(path: ArrayLike<number>): number {
  return Math.max(0, Math.floor(path.length / 3) - 1) / PUTT_RULES.samples;
}

/**
 * Two points in a row further apart than this aren't eased between: the ball didn't roll there, it
 * was handed on (out of a tunnel) or put down somewhere else. A ball at the fastest it goes covers
 * a quarter of it between two points.
 */
export const JUMP = 0.45;

/** Where the ball is `t` seconds after it was struck along `path` (x, y, z, PUTT_RULES.samples a second), into `out`. */
export function pathAt<P extends Point3>(path: ArrayLike<number>, t: number, out: P): P {
  const n = Math.floor(path.length / 3);
  if (!n) return out;
  const f = Math.max(0, t) * PUTT_RULES.samples;
  const i0 = Math.min(Math.floor(f), n - 1);
  const i1 = Math.min(i0 + 1, n - 1);
  const a = i0 * 3;
  const b = i1 * 3;
  const dx = path[b] - path[a];
  const dy = path[b + 1] - path[a + 1];
  const dz = path[b + 2] - path[a + 2];
  const k = dx * dx + dy * dy + dz * dz > JUMP * JUMP ? 0 : Math.min(1, f - i0);
  out.x = path[a] + dx * k;
  out.y = path[a + 1] + dy * k;
  out.z = path[a + 2] + dz * k;
  return out;
}

/**
 * Which way the ball is heading (a heading: 0 is down +z) `t` seconds along `path`, judged over the
 * last few tenths of a second so a wall's bounce doesn't flick it about; null while it hasn't moved.
 */
export function headingAt(path: ArrayLike<number>, t: number): number | null {
  const n = Math.floor(path.length / 3);
  if (n < 2) return null;
  const i = Math.min(n - 1, Math.max(1, Math.round(t * PUTT_RULES.samples)));
  for (let back = 6; back >= 1; back--) {
    const j = Math.max(0, i - back);
    const dx = path[i * 3] - path[j * 3];
    const dz = path[i * 3 + 2] - path[j * 3 + 2];
    if (dx * dx + dz * dz > 0.0004 && dx * dx + dz * dz < (JUMP * back) ** 2) return Math.atan2(dx, dz);
  }
  return null;
}

const lie = newLie();

/** How high the felt is at (x, z) on `hole`, or null off it: heightAt (shared/minigolf/lies.ts), making nothing new, for every frame. */
export function feltAt(hole: Hole, x: number, z: number): number | null {
  return lieAt(hole, ready(hole).felt, x, z, lie) ? lie.h : null;
}

/** The heading from `from` to `to` (0 down +z, turning toward +x). */
export const yawTo = (from: XZ, to: XZ): number => Math.atan2(to.x - from.x, to.z - from.z);

/** Wraps an angle into -π..π. */
export const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Where you stand to putt a ball at `ball` toward `yaw`, and which way you face: side on to the line,
 * STANCE from the ball, with the hole on your left, as at golf's tee (features/golf/tee.ts stance).
 * Into `out` when given, for every frame.
 */
export function stanceAt(ball: XZ, yaw: number, out = { x: 0, z: 0, facing: 0 }): { x: number; z: number; facing: number } {
  out.x = ball.x + Math.cos(yaw) * STANCE;
  out.z = ball.z - Math.sin(yaw) * STANCE;
  out.facing = yaw - Math.PI / 2;
  return out;
}

/** Whether `p` has holed out on hole `hole` (0..8), or been picked up there. */
export const doneWith = (p: PuttPlayer, hole: number): boolean => p.strokes[hole] !== null && p.strokes[hole] !== undefined;

/** The player whose turn it is in `r`, if it's being played. */
export function turnOf(r: PuttRound): PuttPlayer | undefined {
  return r.stage === 'playing' ? r.players[r.turn] : undefined;
}

/**
 * Where `p`'s ball is out on the hole `r` is playing, or null when it isn't out: not yet teed off
 * (the one whose turn it is has theirs on the tee, `tee`: see teeBall in shared/minigolf/physics.ts),
 * holed or picked up, or the round isn't on.
 */
export function ballOf(r: PuttRound, p: PuttPlayer, tee: PuttBall | null): PuttBall | null {
  if (r.stage !== 'playing' || doneWith(p, r.hole)) return null;
  const up = r.players[r.turn] === p;
  if (p.ball && (up || p.taken > 0)) return p.ball;
  return up ? tee : null;
}

/** A player's strokes so far, holes not finished left out. */
export function totalOf(p: PuttPlayer): number {
  let sum = 0;
  for (const s of p.strokes) if (typeof s === 'number') sum += s;
  return sum;
}

/** How a player stands against par over the holes they've finished: 0 is level. */
export function toPar(p: PuttPlayer, pars: readonly number[]): number {
  let diff = 0;
  p.strokes.forEach((s, i) => {
    if (typeof s === 'number') diff += s - (pars[i] ?? 0);
  });
  return diff;
}

/** Against par as golfers say it: E for level, +2, −1. */
export const parText = (diff: number): string => (diff === 0 ? 'E' : diff > 0 ? `+${diff}` : `−${-diff}`);

/** What a score on a hole is called: Hole in one, Eagle, Birdie, Par, Bogey, Double bogey, or +3 and up. */
export function scoreName(strokes: number, par: number): string {
  if (strokes === 1) return 'Hole in one';
  const d = strokes - par;
  if (d <= -2) return 'Eagle';
  if (d === -1) return 'Birdie';
  if (d === 0) return 'Par';
  if (d === 1) return 'Bogey';
  if (d === 2) return 'Double bogey';
  return `+${d}`;
}

/** A while left, as a clock: 0:42, 1:30. */
export function clockText(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** A distance on the course as it's read out: 40 cm, 3.4 m. */
export function distText(m: number): string {
  return m < 1 ? `${Math.max(1, Math.round(m * 100))} cm` : `${m.toFixed(1)} m`;
}

/** "1st", "2nd", "3rd", "4th" (a stroke, a place). */
export function nth(n: number): string {
  const tens = n % 100;
  const s = tens >= 11 && tens <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${s}`;
}

/**
 * The round's highlights for `p`, best first, for the Round-over window: holes in one, eagles and
 * birdies, with the holes they came on (1..9).
 */
export function highlights(p: PuttPlayer, pars: readonly number[]): { name: string; holes: number[] }[] {
  const out = new Map<string, number[]>();
  p.strokes.forEach((s, i) => {
    if (typeof s !== 'number') return;
    const name = scoreName(s, pars[i] ?? 0);
    if (name === 'Hole in one' || name === 'Eagle' || name === 'Birdie') out.set(name, [...(out.get(name) ?? []), i + 1]);
  });
  return ['Hole in one', 'Eagle', 'Birdie'].filter((n) => out.has(n)).map((name) => ({ name, holes: out.get(name)! }));
}
