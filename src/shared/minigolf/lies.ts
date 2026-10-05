// Where a ball lies on a hole (see physics.ts): how high the felt is, the ball teed up, and where a
// ball that stopped somewhere nobody can stand to putt it is played from instead, a club length off.

import type { PuttBall } from '../protocol/minigolf.js';
import { ready, type Piece, type Ready } from './compile.js';
import { ROLL } from './rules.js';
import { gridAt, lieAt, newLie, within, type Lie } from './surface.js';
import { BALL_R, CLUB, CUP, type Hole, type XZ } from './types.js';

const mm = (v: number) => Math.round(v * 1000) / 1000;
/** How far a ball played from beside the windmill's house is kept from it, so there's room to stand and swing. */
const HOUSE_ROOM = 0.35;

/** The felt under a point, for heightAt: one for every call, so the page can ask every frame without making anything. */
const scratch = newLie();

/** How high the felt is at (x, z) above the street (a cone's slope included); null where there's no felt. */
export function heightAt(hole: Hole, x: number, z: number): number | null {
  return lieAt(hole, ready(hole).felt, x, z, scratch) ? scratch.h : null;
}

/** The ball teed up on `hole`. */
export function teeBall(hole: Hole): PuttBall {
  return { x: hole.tee.x, y: heightAt(hole, hole.tee.x, hole.tee.z) ?? 0, z: hole.tee.z };
}

/** Where a piece of wall is nearest (x, z): how far along it (0..1). */
export function along(q: Piece, x: number, z: number): number {
  return Math.min(1, Math.max(0, ((x - q.ax) * q.ex + (z - q.az) * q.ez) / q.len2));
}

/** Whether (x, z) is somewhere a ball can be putted from: on felt it'd stay still on, clear of everything, and nowhere nobody can stand. */
function standable(r: Ready, x: number, z: number, lie: Lie): boolean {
  const hole = r.hole;
  if (!lieAt(hole, r.felt, x, z, lie) || ROLL.g * Math.hypot(lie.gx, lie.gz) > ROLL.hold) return false;
  if (hole.keepOff?.some((k) => within(k, x, z))) return false;
  if (Math.hypot(x - hole.cup.x, z - hole.cup.z) < CUP.take + 0.1) return false;
  // Clear of a kerb by a little.
  const clear = BALL_R + 0.03;
  for (const i of gridAt(r.near, x, z)) {
    const q = r.pieces[i];
    const t = along(q, x, z);
    if (Math.hypot(x - (q.ax + q.ex * t), z - (q.az + q.ez * t)) < clear) return false;
  }
  if (hole.bumpers?.some((b) => Math.hypot(x - b.x, z - b.z) < b.r + clear)) return false;
  if (hole.hills?.some((h) => ((x - h.x) / (h.rx + clear)) ** 2 + ((z - h.z) / (h.rz + clear)) ** 2 < 1)) return false;
  // Not in the windmill's house, nor so close to it there's nowhere to stand.
  const mf = r.mill;
  if (mf) {
    const u = (x - mf.m.x) * mf.fx + (z - mf.m.z) * mf.fz;
    const w = (x - mf.m.x) * mf.rx + (z - mf.m.z) * mf.rz;
    if (Math.abs(u) < mf.half + HOUSE_ROOM && Math.abs(w) < mf.half + HOUSE_ROOM) return false;
  }
  return true;
}

/**
 * Where a ball that came to rest at `at` is played from: where it lies, unless that's somewhere nobody
 * can stand to putt it (the hole's keepOff), when it's moved a club length (CLUB), or as little more
 * as it takes, to the nearest spot that's fine: back toward `from` (where it was putted from) when
 * there's a choice, else no nearer the cup.
 */
export function restSpot(hole: Hole, at: PuttBall, from?: XZ): PuttBall {
  if (!hole.keepOff?.some((k) => within(k, at.x, at.z))) return { ...at };
  const r = ready(hole);
  const lie = newLie();
  for (let ring = 0; ring < 17; ring++) {
    const reach = CLUB + ring * 0.25;
    let best: PuttBall | null = null;
    let score = Infinity;
    for (let k = 0; k < 48; k++) {
      const a = (k * Math.PI * 2) / 48;
      const x = at.x + reach * Math.sin(a);
      const z = at.z + reach * Math.cos(a);
      if (!standable(r, x, z, lie)) continue;
      const s = from ? Math.hypot(x - from.x, z - from.z) : -Math.hypot(x - hole.cup.x, z - hole.cup.z);
      if (s < score) {
        score = s;
        best = { x: mm(x), y: mm(lie.h), z: mm(z) };
      }
    }
    if (best) return best;
  }
  return teeBall(hole);
}
