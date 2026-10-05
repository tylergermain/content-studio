// A hole made ready to roll on (physics.ts): its walls cut into straight pieces with the felt's
// height at their feet, the windmill's house and the sail across its mouth as pieces too, and grids
// saying which pieces and which patches of felt might be near each square of it. Made once a hole,
// the first time it's rolled on or asked about.

import { FELT_H } from './shapes.js';
import { addToGrid, emptyGrid, feltGrid, holeBox, lieAt, newLie, type FeltGrid, type Lie } from './surface.js';
import { BALL_R, type Bumper, type Cone, type Hill, type Hole, type Mill, type Tunnel, type Water } from './types.js';

/** A straight piece of wall, from a to b, `height` over the felt at its foot (`footA` at a, `footB` at b). */
export interface Piece {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /** b - a, and its length squared. */
  ex: number;
  ez: number;
  len2: number;
  footA: number;
  footB: number;
  height: number;
  bounce: number;
  /** A wall or kerb, the windmill's house, or the sail across the house's mouth (there only while millOpen says shut). */
  kind: 'wall' | 'house' | 'sail';
}

/** The windmill as the roll sees it: forward along its tunnel (f), its right (r), half its base and half its tunnel's width. */
export interface MillFrame {
  m: Mill;
  fx: number;
  fz: number;
  rx: number;
  rz: number;
  half: number;
  gap: number;
}

export interface Ready {
  hole: Hole;
  felt: FeltGrid;
  pieces: Piece[];
  /** Which pieces might be within reach of a ball in each square. */
  near: FeltGrid;
  /** The felt's height at the cup. */
  cupY: number;
  mill: MillFrame | null;
  /** The hole's own lists, empty where it has none (so a step never makes one). */
  cones: readonly Cone[];
  hills: readonly Hill[];
  bumpers: readonly Bumper[];
  tunnels: readonly Tunnel[];
  water: readonly Water[];
}

/** Walls give back this much of the speed into them when they don't say; the windmill's house and its sails less. */
export const BOUNCE = { wall: 0.75, house: 0.6, sail: 0.6 } as const;

const READY = new WeakMap<Hole, Ready>();

/** `hole`, ready to roll on. */
export function ready(hole: Hole): Ready {
  let r = READY.get(hole);
  if (!r) READY.set(hole, (r = make(hole)));
  return r;
}

/** The felt's height at (x, z), or just beside it (a wall's end can stand off the felt's edge); the felt's usual height if there's none near. */
function footAt(hole: Hole, grid: FeltGrid, x: number, z: number, lie: Lie): number {
  if (lieAt(hole, grid, x, z, lie)) return lie.h;
  let best = -Infinity;
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    if (lieAt(hole, grid, x + 0.12 * Math.cos(a), z + 0.12 * Math.sin(a), lie)) best = Math.max(best, lie.h);
  }
  return best > -Infinity ? best : FELT_H;
}

function make(hole: Hole): Ready {
  const felt = feltGrid(hole);
  const lie = newLie();
  const pieces: Piece[] = [];
  const add = (ax: number, az: number, bx: number, bz: number, height: number, bounce: number, kind: Piece['kind']) => {
    const ex = bx - ax;
    const ez = bz - az;
    const len2 = ex * ex + ez * ez;
    if (len2 < 1e-12) return;
    pieces.push({ ax, az, bx, bz, ex, ez, len2, footA: footAt(hole, felt, ax, az, lie), footB: footAt(hole, felt, bx, bz, lie), height, bounce, kind });
  };
  for (const w of hole.walls) for (let i = 0; i + 1 < w.pts.length; i++) add(w.pts[i].x, w.pts[i].z, w.pts[i + 1].x, w.pts[i + 1].z, w.height, w.bounce ?? BOUNCE.wall, 'wall');
  let mill: MillFrame | null = null;
  if (hole.mill) {
    const m = hole.mill;
    mill = { m, fx: Math.sin(m.yaw), fz: Math.cos(m.yaw), rx: -Math.cos(m.yaw), rz: Math.sin(m.yaw), half: m.base / 2, gap: m.tunnel / 2 };
    const { fx, fz, rx, rz, half: b, gap: t } = mill;
    // A point of the house, `u` along its tunnel and `w` to the right of it.
    const at = (u: number, w: number) => [m.x + fx * u + rx * w, m.z + fz * u + rz * w] as const;
    const house = (u0: number, w0: number, u1: number, w1: number, kind: Piece['kind'] = 'house') => add(...at(u0, w0), ...at(u1, w1), m.height, kind === 'sail' ? BOUNCE.sail : BOUNCE.house, kind);
    house(-b, -b, -b, -t); // the face the ball goes in at, either side of the mouth
    house(-b, t, -b, b);
    house(b, -b, b, -t); // the face it comes out at
    house(b, t, b, b);
    house(-b, -b, b, -b); // its sides
    house(-b, b, b, b);
    house(-b, -t, b, -t); // the tunnel's sides
    house(-b, t, b, t);
    house(-b, -t, -b, t, 'sail'); // a sail across the mouth
  }
  // Near enough to touch a ball in one step.
  const near = emptyGrid(holeBox(hole));
  pieces.forEach((q, i) => addToGrid(near, i, Math.min(q.ax, q.bx), Math.min(q.az, q.bz), Math.max(q.ax, q.bx), Math.max(q.az, q.bz), BALL_R + 0.06));
  const cupY = lieAt(hole, felt, hole.cup.x, hole.cup.z, lie) ? lie.h : FELT_H;
  return { hole, felt, pieces, near, cupY, mill, cones: hole.cones ?? [], hills: hole.hills ?? [], bumpers: hole.bumpers ?? [], tunnels: hole.tunnels ?? [], water: hole.water ?? [] };
}
