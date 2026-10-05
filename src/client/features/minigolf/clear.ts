// Where the putting camera (controller.ts) goes by the windmill on hole 2, with no three.js in it so
// the tests can run it. The camera follows a putt from behind the ball the way it's going, and stands
// behind the ball along the line to aim, and by the mill either can land in its house or among its
// sails: through the tunnel the ball comes out on the house's far side, and knocked back by a sail it
// heads for the camera, so "behind it" is on the far side. So there the camera keeps out of them.
// Following, it stays put on its own side of the mill while the ball's on that side too, and goes up
// over the mill after the ball once it's through; aiming, it looks down on the ball from over it.

import type { Hole, Mill, XZ } from '../../../shared/minigolf/types';
import type { Point3 } from './play';

/**
 * What the camera keeps out of, in the mill's own frame from its middle: half across its front (the
 * sails reach 2.2 m from their hub), half along its tunnel (the house, the sails turning in front of
 * it, and a margin), and how far over its roof (the sails' tips are a little over it).
 */
export const MILL_KEEP = { across: 2.6, along: 1.7, over: 0.9 } as const;
/** How far over the mill's roof the camera crosses it: high enough that the way up to it and down from it clears the sails too. */
export const MILL_OVER = 3.8;
/** Aiming beside the mill: how far over the ball the camera looks down on it, and how far back along the line. */
export const AIM_OVER = { up: 3.6, back: 0.25 } as const;

/** How far (x, z) is along the mill's tunnel from its middle, the way its yaw points. */
const along = (m: Mill, x: number, z: number) => (x - m.x) * Math.sin(m.yaw) + (z - m.z) * Math.cos(m.yaw);
/** How far (x, z) is across the mill's front from its middle. */
const across = (m: Mill, x: number, z: number) => (x - m.x) * Math.cos(m.yaw) - (z - m.z) * Math.sin(m.yaw);

/** Whether a camera at (x, z), `h` over the street, would be in `hole`'s windmill's house or among its sails. */
export function inMill(hole: Hole, x: number, z: number, h: number): boolean {
  const m = hole.mill;
  return !!m && h < m.height + MILL_KEEP.over && Math.abs(along(m, x, z)) < MILL_KEEP.along && Math.abs(across(m, x, z)) < MILL_KEEP.across;
}

/**
 * Where the camera following a putt on `hole` goes, by the windmill: `want` is where it would go and
 * `cam` where it is (heights over the street), `ball` the ball. Left alone wherever that's clear of the
 * mill. While the ball's on the camera's side of the mill (knocked back by a sail, say) the camera
 * stays where it is, rather than go round behind the ball through the mill; once the ball's through
 * to the far side, or the camera's already up over the mill, it goes up over the mill after it.
 */
export function followClear(hole: Hole, ball: XZ, cam: Point3, want: Point3): void {
  const m = hole.mill;
  if (!m || !inMill(hole, want.x, want.z, want.y)) return;
  const through = Math.sign(along(m, ball.x, ball.z)) !== Math.sign(along(m, cam.x, cam.z));
  if (through || cam.y >= m.height + MILL_KEEP.over) {
    want.y = Math.max(want.y, m.height + MILL_OVER);
    return;
  }
  want.x = cam.x;
  want.y = cam.y;
  want.z = cam.z;
}

/**
 * Where the camera stands to aim a putt on `hole` from `ball` toward `aim`, by the windmill: looking
 * down on the ball from over it, rather than from in the mill's house behind it. Left alone wherever
 * `want` (heights over the street) is clear of the mill.
 */
export function aimClear(hole: Hole, ball: Point3, aim: number, want: Point3): void {
  if (!inMill(hole, want.x, want.z, want.y)) return;
  want.x = ball.x - Math.sin(aim) * AIM_OVER.back;
  want.y = ball.y + AIM_OVER.up;
  want.z = ball.z - Math.cos(aim) * AIM_OVER.back;
}
