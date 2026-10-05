// The numbers putting on Putt Street goes by (see physics.ts): how hard a putt leaves the putter, how
// the felt slows it and how walls, bumpers, the loop, the tunnels, the cup and a landing treat it, and
// when the windmill's sails are across its mouth. Pure, for the office's roll and the page alike.

import type { PuttBall, PuttEvent } from '../protocol/minigolf.js';
import { BALL_R, type Bumper, type Mill } from './types.js';

/** A putt: from where the ball lies, which way (radians, 0 down +z) and how hard (0..1), struck at `startAt` (office clock, ms). */
export interface Stroke {
  from: PuttBall;
  yaw: number;
  power: number;
  startAt: number;
}

/** How a putt went (see PuttRoll in protocol/minigolf.ts, which is this and who and when). */
export interface Rolled {
  path: number[];
  events: [number, PuttEvent][];
  rest: PuttBall;
  holed: boolean;
  out: 'water' | 'off' | null;
  moved: boolean;
}

/**
 * Rolling friction (m/s²), the speed it stops under, the fastest it ever goes (m/s), and the longest a
 * roll lasts (s). Then: gravity; the steepest pull (m/s²) a ball can come to rest against; how much of
 * the speed along a wall it keeps; the fastest out of the loop, and what it keeps of the speed it got
 * round at (so a harder putt still goes a little further); what a tunnel keeps of the speed (and
 * the least and most it lets out at); what a lip-out keeps; and a landing's bounce and what it keeps
 * along the ground.
 */
export const ROLL = {
  friction: 0.65,
  stop: 0.04,
  maxSpeed: 7,
  maxS: 20,
  g: 9.81,
  hold: 0.65,
  along: 0.95,
  loopOut: 3,
  loopKeep: 0.45,
  tunnelKeep: 0.7,
  tunnelMin: 0.3,
  tunnelMax: 2,
  lipOut: 0.7,
  land: 0.3,
  landKeep: 0.8,
} as const;

/** What a bumper gives back of the speed into it when it doesn't say, and the hill's grass. */
export const BUMPER_BOUNCE = 0.85;
export const HILL_BOUNCE = 0.5;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * How fast the ball leaves the putter at `power` (0..1), m/s: 0.4 at nothing to 7 at full, rising
 * slowly at first, so the short putts that need a touch have the most of the meter.
 */
export function puttSpeed(power: number): number {
  const p = clamp01(power);
  return 0.4 + 2.9 * p + 3.7 * p * p;
}

/** Which way the windmill's sails are turned (radians) at office time `officeMs`: the same on every page and the office. */
export function millAngle(mill: Mill, officeMs: number): number {
  const period = mill.period * 1000;
  return (((officeMs % period) + period) % period / period) * Math.PI * 2;
}

/**
 * Whether the windmill's tunnel is open at office time `officeMs`: a sail covers its mouth for `shut`
 * of each sail's turn, half either side of the moments one points straight down (millAngle 0, 2π/blades…).
 */
export function millOpen(mill: Mill, officeMs: number): boolean {
  const each = (Math.PI * 2) / mill.blades;
  const into = (millAngle(mill, officeMs) % each) / each;
  return into >= mill.shut / 2 && into <= 1 - mill.shut / 2;
}

/** Something moving on the felt, as a bumper sees it. */
export interface Moving {
  x: number;
  z: number;
  vx: number;
  vz: number;
}

/**
 * Bounces `b` off bumper `p` if it's touching it, moving it out to just touching: it keeps all its
 * speed along the bumper and `bounce` (under 1) of its speed into it, so a bumper never adds any.
 * Returns the speed it hit it at (0 when it didn't).
 */
export function offBumper(b: Moving, p: Bumper): number {
  const dx = b.x - p.x;
  const dz = b.z - p.z;
  const reach = p.r + BALL_R;
  const d2 = dx * dx + dz * dz;
  if (d2 >= reach * reach) return 0;
  const d = Math.sqrt(d2);
  const nx = d > 1e-9 ? dx / d : 1;
  const nz = d > 1e-9 ? dz / d : 0;
  b.x = p.x + nx * (reach + 1e-6);
  b.z = p.z + nz * (reach + 1e-6);
  const vn = b.vx * nx + b.vz * nz;
  if (vn >= 0) return 0;
  const bounce = Math.min(0.95, p.bounce ?? BUMPER_BOUNCE);
  b.vx -= (1 + bounce) * vn * nx;
  b.vz -= (1 + bounce) * vn * nz;
  return -vn;
}
