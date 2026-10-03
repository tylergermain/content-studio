import { BALL, backboard, launch, nearSolids, step, type BallHit, type BallShot, type Solid } from '../shared/hoop.js';
import { pieceAway, pieceCollider, type Piece } from '../shared/furniture.js';
import { deckSolids } from '../shared/mezzanine.js';
import { stepsSolids } from '../shared/steps.js';
import { FLOOR, WALL_T } from '../shared/layout.js';
import { FARTHEST, rimDistance } from '../shared/longshots.js';
import type { FloorRoom } from '../shared/floorplan.js';

/**
 * The office's own flight of a throw at the hoop: whether it went in, worked out from the throw the
 * same way every page flies it (shared/hoop.ts), so a page never says it scored, or from how far.
 *
 * The office flies it past what it knows of the floor: the backboard and the ring, the floor and the
 * outside walls, the furniture as the floor's layout has it, the big mezzanine and the Steps. What only
 * a page has (the kitchen, the corner loft's walls, the desks) it doesn't: a ball that only goes in off
 * one of those (or is kept out by one) counts the office's way. Anything aimed at the hoop meets none.
 */

/** What a throw meets on a floor arranged as `layout`. */
export function floorSolids(layout: { furniture: readonly Piece[]; room: FloorRoom }, wing = 0): Solid[] {
  const solids: Solid[] = [backboard(), { ...FLOOR, bottom: -0.3, top: 0 }];
  // The outside walls, floor to ceiling (a door's opening is only a page's: past it, the shot missed anyway).
  solids.push(
    { minX: FLOOR.minX - WALL_T, maxX: FLOOR.minX, minZ: FLOOR.minZ, maxZ: FLOOR.maxZ, top: 99 },
    { minX: FLOOR.maxX, maxX: FLOOR.maxX + WALL_T, minZ: FLOOR.minZ, maxZ: FLOOR.maxZ, top: 99 },
    { minX: FLOOR.minX - WALL_T, maxX: FLOOR.maxX + WALL_T, minZ: FLOOR.minZ - WALL_T, maxZ: FLOOR.minZ, top: 99 },
    { minX: FLOOR.minX - WALL_T, maxX: FLOOR.maxX + WALL_T, minZ: FLOOR.maxZ, maxZ: FLOOR.maxZ + WALL_T, top: 99 },
  );
  for (const p of layout.furniture) {
    if (pieceAway(p, wing)) continue;
    const c = pieceCollider(p);
    if (c) solids.push(c);
  }
  if (layout.room.mezzanine === 'big') solids.push(...deckSolids(layout.room));
  if (layout.room.steps) solids.push(...stepsSolids());
  return nearSolids(solids);
}

/** Whether a floor laid out as `furniture` has the hoop up (the office builder can take it down). */
export function hasHoop(furniture: readonly Piece[]): boolean {
  return furniture.some((p) => p.kind === 'hoop');
}

/** How a throw went, the office's way. */
export interface Flight {
  made: boolean;
  /** Seconds after it left the hand that it dropped through the ring (made), or that it was over (missed). */
  at: number;
}

/** The longest a throw is followed: one still going this long after it left the hand missed. */
const LONGEST = 5;

/**
 * Flies a throw out (until it's lying still, gone, or LONGEST seconds on): in, and when; or a miss,
 * plain at its first bounce on the floor (or once it's over, if it never bounces there).
 */
export function flyShot(s: Omit<BallShot, 'by' | 'elapsed'>, solids: readonly Solid[]): Flight {
  const sim = launch(s);
  const hits: BallHit[] = [];
  let bounced: number | null = null;
  while (sim.t < LONGEST && !sim.still && !sim.lost) {
    hits.length = 0;
    step(sim, solids, hits);
    if (sim.scored) return { made: true, at: sim.t };
    if (bounced === null && sim.y < BALL.r + 0.3 && hits.some((h) => h.kind === 'bounce')) bounced = sim.t;
  }
  return { made: false, at: bounced ?? Math.min(sim.t, LONGEST) };
}

/** How far from where the office last saw them (m, along the floor) a shot may leave someone's hands: a step's lag, and their reach. */
export const STAND_SLACK = 1.2;
/** How high above their feet (m) it may: from about the chest, first person, to over their head at the top of a jump. */
export const HANDS_UP = { min: 0.8, max: 2.9 } as const;

/**
 * How far out to credit a make thrown from `s` by someone the office last saw standing at `stand`: the
 * throw's own distance, but never more than a little past where they stood (what a step of lag
 * explains). Null when the throw didn't leave their hands where they stood, or is further out than
 * anyone can stand.
 */
export function creditedDistance(stand: { x: number; y: number; z: number }, s: { x: number; y: number; z: number }): number | null {
  const n = [stand.x, stand.y, stand.z, s.x, s.y, s.z];
  if (!n.every(Number.isFinite)) return null;
  if (Math.hypot(s.x - stand.x, s.z - stand.z) > STAND_SLACK) return null;
  const up = s.y - stand.y;
  if (up < HANDS_UP.min || up > HANDS_UP.max) return null;
  const dist = Math.min(rimDistance(s), rimDistance(stand) + 0.5);
  if (dist > FARTHEST) return null;
  return Math.round(dist * 10) / 10;
}

/** A throw quick enough to be a shot (or a pass): slower is the ball dropped out of someone's hands (Q). */
export const DROP_SPEED = 1.5;

/** Whether a throw is the ball dropped rather than shot. */
export function isDrop(s: { vx: number; vy: number; vz: number }): boolean {
  return Math.hypot(s.vx, s.vy, s.vz) < DROP_SPEED;
}
