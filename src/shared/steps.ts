// The Steps: a six-tier amphitheatre across the lounge, rising west from the floor in front of the TV,
// to walk up and sit on. It's the floor's own choice (RoomOptions.steps in shared/floorplan.ts), and
// the office as it comes hasn't one. Where it stands is here, for the rules (office-fixed.ts: nothing
// else stands there, and whoever walks the floor by a grid goes round it), for where there is to sit
// (furniture.ts), and for whoever builds it in 3D (client/world/office/steps.ts), which takes what you
// bump into of it from stepsSolids(), the same list the tests walk.

import type { RoomOptions } from './floorplan.js';
import type { SeatDef } from './layout.js';
import type { Solid } from './mezzanine.js';
import type { Rect } from './office-fixed.js';

/**
 * Its numbers: the bottom riser at `east`, the back wall at `west`, `tiers` tiers each `run` deep and
 * `rise` higher than the last (under what a walker steps up without jumping: STEP in
 * client/player/collide.ts), between `minZ` and `maxZ`. A wall `wall` thick stands along its back and
 * down each side, `rail` over the tier beside it, so nobody walks in from the floor or off the top.
 */
export const STEPS = { east: 13.5, west: 9.0, minZ: -4.4, maxZ: 4.4, tiers: 6, run: 0.75, rise: 0.28, rail: 1.05, wall: 0.1 } as const;

/** The floor it takes, walls and all: nothing else stands there. */
export const STEPS_RECT: Rect = [STEPS.west - STEPS.wall, STEPS.east, STEPS.minZ - STEPS.wall, STEPS.maxZ + STEPS.wall];

/** How high its top tier is. */
export const STEPS_TOP = STEPS.tiers * STEPS.rise;

/** Whether the floor has the Steps. One that doesn't say hasn't. */
export function hasSteps(room: RoomOptions = {}): boolean {
  return room.steps === true;
}

/** Whether (x, z) is on the Steps, or in their walls. */
export function onSteps(x: number, z: number): boolean {
  return x > STEPS_RECT[0] && x < STEPS_RECT[1] && z > STEPS_RECT[2] && z < STEPS_RECT[3];
}

/** Where tier `i` (from 1, the bottom one) starts: its riser, on its east side. */
const riser = (i: number) => STEPS.east - (i - 1) * STEPS.run;

/**
 * Everything you bump into of the Steps, for the office that builds them and the tests that walk them:
 * each tier, solid from the floor up; the back wall, a rail's height over the top tier; and a stepped
 * wall down each side, a box per tier, a rail's height over it.
 */
export function stepsSolids(): Solid[] {
  const { west, minZ, maxZ, tiers, rise, rail, wall } = STEPS;
  const solids: Solid[] = [];
  for (let i = 1; i <= tiers; i++) solids.push({ minX: riser(i + 1), maxX: riser(i), minZ, maxZ, top: i * rise });
  solids.push({ minX: west - wall, maxX: west, minZ: minZ - wall, maxZ: maxZ + wall, top: STEPS_TOP + rail });
  for (const z of [minZ - wall, maxZ]) for (let i = 1; i <= tiers; i++) solids.push({ minX: riser(i + 1), maxX: riser(i), minZ: z, maxZ: z + wall, top: i * rise + rail });
  return solids;
}

/**
 * Where there is to sit on them: a bench per tier, three places along it, each facing east to the TV
 * (so it counts as a seat in front of it: see SeatDef.tv). You sit on a tier's front edge with your
 * feet on the one below (the floor, for the bottom tier), and get up onto that: `out` is far enough
 * from the riser behind you to stand clear of it (a body is 0.32 across, see RADIUS in
 * client/player/collide.ts), and still on that tier.
 */
export function stepsSeats(): SeatDef[] {
  return Array.from({ length: STEPS.tiers }, (_, n) => {
    const i = n + 1;
    return { id: `steps-${i}`, label: '🏟️ Steps', x: riser(i) - 0.2, y: (i - 1) * STEPS.rise, z: 0, rotY: Math.PI / 2, places: [-2.9, 0, 2.9], hips: STEPS.rise + 0.1, depth: 0, out: 0.55, tv: true };
  });
}
