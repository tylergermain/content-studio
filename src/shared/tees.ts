// The driving tees out on the balcony. The office comes with one (GOLF_TEE in layout.ts); a floor
// whose room has two (RoomOptions.tees, set in the office builder) has a second bay beside it, so two
// people tee off side by side at the same hole.

import { BALCONY, GOLF_HOLE, GOLF_TEE } from './layout.js';

/**
 * A bay: a square of turf `size` across centered on x, z, with the ball teed up at `ball` and its bag
 * of clubs leaning on the wall behind it at `bag`.
 */
export interface TeeBay {
  x: number;
  z: number;
  size: number;
  ball: { x: number; z: number };
  bag: { x: number; z: number };
}

/**
 * The bays, by number. Bay 0 is the office's own tee, west of the balcony doors. Bay 1 is east of
 * them, as far out from the wall, where the bistro table and its stools stand on a floor with one tee
 * (they're put away on a floor with two): its ball sits the same way off the middle of its mat, and
 * its bag leans on the wall between the doors and the mat, clear of the window behind the bay.
 */
export const TEES: readonly TeeBay[] = [GOLF_TEE, { x: 0.6, z: GOLF_TEE.z, size: GOLF_TEE.size, ball: { x: 0.4, z: GOLF_TEE.z }, bag: { x: -0.95, z: BALCONY.minZ + 0.28 } }];

/** The seats that go away with the bistro table on a floor with two tees (see SEATING in layout.ts). */
export const BISTRO_SEATS: readonly string[] = ['stool-1', 'stool-2'];

/** How many bays are out on a floor whose room has `tees` driving tees (see RoomOptions.tees). */
export function teeBays(tees: number | undefined): number {
  return tees === 2 ? 2 : 1;
}

/** A bay's number from somewhere it can't be trusted, on a floor with `bays` of them out: the first, unless it names another that's there. */
export function cleanBay(raw: unknown, bays: number = TEES.length): number {
  return typeof raw === 'number' && Number.isInteger(raw) && raw > 0 && raw < Math.min(bays, TEES.length) ? raw : 0;
}

/** From bay `bay`'s ball to the pin: which way (a heading: 0 is south, +z, and it turns toward +x), and how far along the ground. */
export function pinFrom(bay: number): { yaw: number; distance: number } {
  const { ball } = TEES[bay] ?? TEES[0];
  const dx = GOLF_HOLE.x - ball.x;
  const dz = GOLF_HOLE.z - ball.z;
  return { yaw: Math.atan2(dx, dz), distance: Math.hypot(dx, dz) };
}
