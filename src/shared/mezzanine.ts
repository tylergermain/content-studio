// A floor's upstairs: none, the boss's loft in the south-east corner, or the big mezzanine along the
// whole south side. It's the floor's own choice (RoomOptions in shared/floorplan.ts), and everything
// that depends on it asks here: what's built into the floor (office-fixed.ts), the builder's rules
// (office-builder.ts), and whoever builds it in 3D (client/world/office). A deck is only a slab, its
// stairs, its posts and a rail: the rooms up on it are furniture with `level: 1` (shared/furniture.ts).

import type { RoomOptions } from './floorplan.js';
import { FLOOR, LOFT, STAIRS, WALL_HEIGHT } from './layout.js';
import { meetingOf } from './meeting-place.js';
import { hasSteps } from './steps.js';

export type MezzanineKind = 'none' | 'corner' | 'big';

/** A stretch of floor. */
export interface Area {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Something you bump into: `top` is how high it goes, and `bottom` where it starts when that isn't the floor (a slab overhead). */
export interface Solid extends Area {
  top: number;
  bottom?: number;
}

/** Every upstairs floor is this high: the loft's. */
export const DECK_Y = LOFT.y;
/** How thick a deck's slab is, down from its floor. */
export const DECK_SLAB = 0.25;
/** The room under a deck, from the office floor up to the slab's underside. */
export const HEADROOM = DECK_Y - DECK_SLAB;
/** How far a post reaches from its middle, for whoever walks round it. */
export const POST_R = 0.14;

/** The big mezzanine: wall to wall along the south side, as deep as the lounge's jukebox. */
export const BIG = { minX: FLOOR.minX, maxX: FLOOR.maxX, minZ: 5.2, maxZ: FLOOR.maxZ } as const;
/**
 * Its stairs, each flight out in the open and climbing south to the deck's north edge: `steps` steps
 * from the office floor at `fromZ` up to the deck at `toZ`. Every floor with the deck has the first,
 * by the fire pole; the second, at the west end, is only for a floor that asks for two (see flightsOf,
 * and bigFlights for the ones a room has), which makes the deck a way through rather than a way up.
 */
export const BIG_FLIGHTS: readonly { minX: number; maxX: number; fromZ: number; toZ: number; steps: number }[] = [
  { minX: 3.9, maxX: 5.7, fromZ: -0.8, toZ: 5.2, steps: 15 },
  { minX: -15.3, maxX: -13.5, fromZ: -0.8, toZ: 5.2, steps: 15 },
];
/** Its posts, in a row under where the rooms' fronts stand: clear of every desk's chair and the way in to it. */
export const BIG_POSTS: readonly (readonly [x: number, z: number])[] = [-15.5, -10.6, -4.9, 0.2, 3.6, 8.6, 14.4].map((x) => [x, 6.9] as const);

/** How much a flight's fences stand out past its steps, either side. */
const FENCE = 0.1;
/** How deep the deck's rail is, along its open edge. */
const RAIL = 0.1;

/** One flight of stairs up to a deck. */
export interface Flight {
  /** The floor it stands on, fences and all: nothing else stands there. */
  rect: Area;
  /** The floor in front of its bottom step, kept clear. */
  foot: Area;
  /** The deck where it arrives, kept clear upstairs. */
  top: Area;
  /** Where you walk to before climbing it, and where it lets you off. */
  footAt: { x: number; z: number };
  topAt: { x: number; z: number };
}

/** A floor's upstairs, as the rules and the 3D office both read it. */
export interface Deck {
  kind: 'corner' | 'big';
  slab: Area;
  /** Where upstairs pieces may stand: none while the boss's office fills the loft. */
  floor?: Area;
  /** Room above its floor: 2.8 in the loft, 3.8 on the big deck. */
  height: number;
  flights: readonly Flight[];
  posts: readonly (readonly [x: number, z: number])[];
}

/** Which upstairs a room has. One that doesn't say has the corner loft; `loft: false` is how a floor said 'none' before there were three. */
export function mezzanineOf(room: RoomOptions = {}): MezzanineKind {
  if (room.mezzanine === 'none' || room.mezzanine === 'corner' || room.mezzanine === 'big') return room.mezzanine;
  return room.loft === false ? 'none' : 'corner';
}

/** Whether the floor has the boss's office: it's the corner loft's, unless the floor keeps that room empty. */
export function hasBoss(room: RoomOptions = {}): boolean {
  return mezzanineOf(room) === 'corner' && room.boss !== false;
}

/** Whether the floor has the kitchen in its south-west corner. */
export function hasKitchen(room: RoomOptions = {}): boolean {
  return room.kitchen !== false;
}

/** How many flights of stairs go up to the room's big mezzanine: one, unless it asks for the second. (One too for any other upstairs: the loft has its own.) */
export function flightsOf(room: RoomOptions = {}): 1 | 2 {
  return mezzanineOf(room) === 'big' && room.flights === 2 ? 2 : 1;
}

/** The big mezzanine's flights a room like `room` has, of BIG_FLIGHTS. */
export function bigFlights(room: RoomOptions = {}): typeof BIG_FLIGHTS {
  return BIG_FLIGHTS.slice(0, flightsOf(room));
}

/**
 * What of a room changes the floor itself (what's built in, and where there is to walk): two rooms
 * with the same key are the same floor to get round. Its upstairs and how many flights go up to it,
 * the boss's office, the kitchen, where its workers meet and the Steps; not its paint, its tees or
 * what hangs under its ceiling.
 */
export function structureKey(room: RoomOptions = {}): string {
  return `${mezzanineOf(room)}|${hasBoss(room) ? 'b' : '-'}|${hasKitchen(room) ? 'k' : '-'}|${meetingOf(room)}|${hasSteps(room) ? 's' : '-'}|${flightsOf(room)}`;
}

/** How high the floor a piece on `level` stands on is: 1 is upstairs. */
export function levelY(level?: number): number {
  return level === 1 ? DECK_Y : 0;
}

const CORNER_POSTS: readonly (readonly [number, number])[] = [
  [LOFT.minX + 0.15, LOFT.minZ + 0.15],
  [(LOFT.minX + LOFT.maxX) / 2, LOFT.minZ + 0.15],
];
/** The loft's stairs, along the south wall up to its west door: the numbers they always had. */
const CORNER_FLIGHT: Flight = {
  rect: { minX: STAIRS.fromX, maxX: STAIRS.toX, minZ: STAIRS.minZ - 0.1, maxZ: STAIRS.maxZ },
  foot: { minX: STAIRS.fromX - 1.2, maxX: STAIRS.fromX, minZ: STAIRS.minZ, maxZ: STAIRS.maxZ },
  top: { minX: LOFT.minX + 0.12, maxX: 10.3, minZ: STAIRS.minZ, maxZ: STAIRS.maxZ },
  footAt: { x: STAIRS.fromX - 0.6, z: (STAIRS.minZ + STAIRS.maxZ) / 2 },
  topAt: { x: LOFT.minX + 0.6, z: (STAIRS.minZ + STAIRS.maxZ) / 2 },
};
const CORNER_SLAB: Area = { minX: LOFT.minX, maxX: LOFT.maxX, minZ: LOFT.minZ, maxZ: LOFT.maxZ };
const CORNER: Deck = { kind: 'corner', slab: CORNER_SLAB, height: LOFT.height, flights: [CORNER_FLIGHT], posts: CORNER_POSTS };
/** Inside the loft's glass, once the boss's office is out of it. */
const CORNER_EMPTY: Deck = { ...CORNER, floor: { minX: LOFT.minX + 0.12, maxX: LOFT.maxX, minZ: LOFT.minZ + 0.12, maxZ: LOFT.maxZ } };

/** The big mezzanine with one flight up to it, and with both. */
const BIG_DECKS = ([1, 2] as const).map(
  (flights): Deck => ({
    kind: 'big',
    slab: BIG,
    // Up to the rail along its open edge.
    floor: { ...BIG, minZ: BIG.minZ + RAIL },
    height: WALL_HEIGHT - DECK_Y,
    flights: BIG_FLIGHTS.slice(0, flights).map((f) => {
      const x = (f.minX + f.maxX) / 2;
      return {
        rect: { minX: f.minX - FENCE, maxX: f.maxX + FENCE, minZ: f.fromZ, maxZ: f.toZ },
        foot: { minX: f.minX, maxX: f.maxX, minZ: f.fromZ - 1.2, maxZ: f.fromZ },
        top: { minX: f.minX, maxX: f.maxX, minZ: f.toZ, maxZ: f.toZ + 1.3 },
        footAt: { x, z: f.fromZ - 0.6 },
        topAt: { x, z: f.toZ + 0.6 },
      };
    }),
    posts: BIG_POSTS,
  }),
);

/** The room's upstairs, or nothing on a floor that's all one level. The same object every time for the same structure. */
export function deckOf(room: RoomOptions = {}): Deck | undefined {
  const kind = mezzanineOf(room);
  if (kind === 'big') return BIG_DECKS[flightsOf(room) - 1];
  if (kind === 'corner') return hasBoss(room) ? CORNER : CORNER_EMPTY;
  return undefined;
}

/** Whether (x, z) is over the room's deck (under it, down on the office floor), `pad` in from its edges. */
export function onDeck(room: RoomOptions, x: number, z: number, pad = 0): boolean {
  const slab = deckOf(room)?.slab;
  return !!slab && x > slab.minX + pad && x < slab.maxX - pad && z > slab.minZ + pad && z < slab.maxZ - pad;
}

/**
 * Everything you bump into of the big mezzanine, for the office that builds it and the tests that walk
 * it: its slab (overhead from the office floor), its posts, each flight's steps and the fences either
 * side of them, and the rail along its open edge, which stops only where a flight arrives. With the
 * flights a room like `room` has: the one, when it doesn't say.
 */
export function deckSolids(room: RoomOptions = {}): Solid[] {
  const flights = bigFlights(room);
  const solids: Solid[] = [{ ...BIG, bottom: HEADROOM, top: DECK_Y }];
  for (const [x, z] of BIG_POSTS) solids.push({ minX: x - POST_R, maxX: x + POST_R, minZ: z - POST_R, maxZ: z + POST_R, top: HEADROOM });
  for (const f of flights) {
    const run = (f.toZ - f.fromZ) / f.steps;
    const rise = DECK_Y / f.steps;
    // Solid from the floor up, like the loft's: nobody walks under a step.
    for (let i = 1; i <= f.steps; i++) solids.push({ minX: f.minX, maxX: f.maxX, minZ: f.fromZ + (i - 1) * run, maxZ: f.fromZ + i * run, top: i * rise });
    for (const x of [f.minX - FENCE, f.maxX]) solids.push({ minX: x, maxX: x + FENCE, minZ: f.fromZ, maxZ: f.toZ, top: 99 });
  }
  // The rail runs in the gaps between the flights, wall to wall.
  let from: number = BIG.minX;
  for (const f of [...flights].sort((a, b) => a.minX - b.minX)) {
    if (f.minX > from) solids.push({ minX: from, maxX: f.minX, minZ: BIG.minZ, maxZ: BIG.minZ + RAIL, bottom: DECK_Y, top: 99 });
    from = f.maxX;
  }
  if (from < BIG.maxX) solids.push({ minX: from, maxX: BIG.maxX, minZ: BIG.minZ, maxZ: BIG.minZ + RAIL, bottom: DECK_Y, top: 99 });
  return solids;
}
