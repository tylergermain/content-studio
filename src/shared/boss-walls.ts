// The boss's office's walls: the corner loft's south and east walls (its other two sides are glass)
// while the boss's office is in it. What the office has against them (its couch, the plants in its two
// corners, its sign and the loft's windows) stays clear of paintings: the office builder's rules hang a
// painting up there only where none of it is (shared/office-builder.ts), and the 3D office builds those
// things where this says and marks the same stretches for the pictures people hang with F
// (client/world/office/boss-office.ts). Heights here are up from the loft's floor.

import { overlaps, wallFacing, type WallId, type WallRect } from './decor.js';
import type { Piece } from './furniture.js';
import { PAINTING, hangSize } from './hangings.js';
import { FLOOR, LOFT, WINDOWS } from './layout.js';
import type { Area } from './mezzanine.js';

const MID_Z = (LOFT.minZ + LOFT.maxZ) / 2;
/** How thick the loft's glass is, on its north and west sides. */
const GLASS = 0.12;

/** The loft inside its glass: what a painting up there stays in (an empty loft's floor too, see mezzanine.ts). */
export const BOSS_ROOM: Area = { minX: LOFT.minX + GLASS, maxX: LOFT.maxX, minZ: LOFT.minZ + GLASS, maxZ: LOFT.maxZ };

/** The couch, its back against the east wall in the middle of it: 2.5 long, its back 1.0 high. */
export const BOSS_COUCH = { x: LOFT.maxX - 0.65, z: MID_Z, length: 2.5, back: 1 } as const;

/**
 * The potted plants in the loft's two east corners: where each stands and its size next to its model,
 * and how far its leaves reach round it and up (the snake plant, then the ficus a size up, as they're
 * modelled: see FLOOR_PLANTS in client/world/office/props.ts).
 */
export const BOSS_PLANTS = [
  { x: LOFT.maxX - 0.6, z: LOFT.minZ + 0.6, scale: 1, reach: 0.32, height: 1.4 },
  { x: LOFT.maxX - 0.6, z: LOFT.maxZ - 0.6, scale: 1.2, reach: 0.47, height: 1.65 },
] as const;

/** The sign inside, up under the roof on the south wall: its middle (`u` along the wall, `y` up) and the wall it takes, with room for its words in any font. */
export const BOSS_SIGN = { u: LOFT.maxX - 3, y: 2.52, w: 1.8, h: 0.4 } as const;

/** A stretch of one of the boss's office's walls that something of it takes, and what it's called. */
export interface BossWallThing extends WallRect {
  what: string;
}

const thing = (wall: WallId, u0: number, u1: number, y0: number, y1: number, what: string): BossWallThing => ({ wall, u0, u1, y0, y1, what });

/** How far along the loft each of its walls runs. */
const ALONG: Partial<Record<WallId, [number, number]>> = { south: [LOFT.minX, LOFT.maxX], east: [LOFT.minZ, LOFT.maxZ] };

/** The windows in the loft's walls (see WINDOWS), clipped to the loft's height. */
const windows: BossWallThing[] = WINDOWS.flatMap((o) => {
  const along = ALONG[o.wall];
  const u0 = o.u - o.width / 2;
  const u1 = o.u + o.width / 2;
  const y0 = Math.max(0, o.y0 - LOFT.y);
  const y1 = Math.min(LOFT.height, o.y1 - LOFT.y);
  return along && u0 < along[1] && u1 > along[0] && y0 < y1 ? [thing(o.wall, u0, u1, y0, y1, 'the window')] : [];
});

/**
 * What the boss's office stands or hangs against its walls: the couch, each plant on the walls of its
 * corner (as wide as its leaves and as high), and the sign. The 3D office marks these for the pictures
 * people hang (the windows it marks already, with the rest of the walls').
 */
export const BOSS_THINGS: readonly BossWallThing[] = [
  thing('east', BOSS_COUCH.z - BOSS_COUCH.length / 2, BOSS_COUCH.z + BOSS_COUCH.length / 2, 0, BOSS_COUCH.back, 'the couch'),
  ...BOSS_PLANTS.flatMap((p) => [
    ...(LOFT.maxX - p.x < 1 ? [thing('east', p.z - p.reach, p.z + p.reach, 0, p.height, 'a plant')] : []),
    ...(LOFT.maxZ - p.z < 1 ? [thing('south', p.x - p.reach, p.x + p.reach, 0, p.height, 'a plant')] : []),
  ]),
  thing('south', BOSS_SIGN.u - BOSS_SIGN.w / 2, BOSS_SIGN.u + BOSS_SIGN.w / 2, BOSS_SIGN.y - BOSS_SIGN.h / 2, BOSS_SIGN.y + BOSS_SIGN.h / 2, 'the sign'),
];

/** Everything a painting on the boss's office's walls keeps clear of: its windows, and its things. */
export const BOSS_WALLS: readonly BossWallThing[] = [...windows, ...BOSS_THINGS];

/**
 * What of the boss's office the painting `p` (upstairs, `level: 1`) would cover, if it's on one of the
 * office's walls: the window, the couch, a plant or the sign. Nothing if it's clear of all of them, or
 * on none of those walls (whether it's on a wall at all is the rules' to say).
 */
export function bossWallClash(p: Piece): string | undefined {
  const wall = wallFacing(p.rotY);
  const face = wall === 'south' ? FLOOR.maxZ : wall === 'east' ? FLOOR.maxX : undefined;
  const at = wall === 'south' ? p.z : p.x;
  if (face === undefined || Math.abs(at - face) > 0.011) return undefined;
  const { w, h } = hangSize(p);
  const u = wall === 'south' ? p.x : p.z;
  const y = p.lift ?? PAINTING.lift;
  const frame: WallRect = { wall, u0: u - w / 2, u1: u + w / 2, y0: y - h / 2, y1: y + h / 2 };
  return BOSS_WALLS.find((t) => overlaps(frame, t))?.what;
}
