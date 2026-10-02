// What's built into the office floor and stays where it is: the rooms, the kitchen, the elevator and
// the rest. (The whiteboard, the jukebox and their like are furniture: see shared/furniture.ts.) Getting round the floor goes round them (shared/nav.ts), and the office
// builder keeps the furniture off them and out of the doorways (shared/office-builder.ts).

import type { RoomOptions } from './floorplan.js';
import { BALCONY_DOOR, ELEVATOR, ELEVATOR_FRONT, EXIT_DOOR, FLOOR, KIOSK, LADDER, LOFT, POLE, POLES, SEATING, STATIONS, type DeskDef } from './layout.js';
import { meetingPlace, meetingSeats } from './meeting-place.js';
import { POST_R, deckOf, hasKitchen, mezzanineOf, structureKey, type Area } from './mezzanine.js';
import { STEPS_RECT, hasSteps } from './steps.js';

export type Rect = [minX: number, maxX: number, minZ: number, maxZ: number];
export type Circle = [x: number, z: number, radius: number];

/** A stretch of floor that's taken, and what the builder calls it ("the elevator"). */
export interface FixedRect {
  rect: Rect;
  what: string;
}
export interface FixedCircle {
  circle: Circle;
  what: string;
}

/** The seat's own frame: `t` along its width, `s` out toward the side the worker's on. */
function point(d: DeskDef, t: number, s: number): [number, number] {
  return [d.x + Math.cos(d.rotY) * t + Math.sin(d.rotY) * s, d.z - Math.sin(d.rotY) * t + Math.cos(d.rotY) * s];
}

function around(corners: [number, number][]): Rect {
  const xs = corners.map(([x]) => x);
  const zs = corners.map(([, z]) => z);
  return [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
}

/** What's built in and in the way: the stretches of floor it takes, and what stands on a spot. */
export interface Fixed {
  rects: FixedRect[];
  circles: FixedCircle[];
}

/**
 * Whether a floor with this room has the loft: the glass room on its posts in the south-east corner,
 * and the stairs up to it. A room that doesn't say has it, as the office comes (ROOM_DEFAULTS in
 * floorplan.ts); one with the big mezzanine, or all one level, hasn't.
 */
export const hasLoft = (room: RoomOptions = {}): boolean => mezzanineOf(room) === 'corner';

/** The seats up in the loft, the boss's office's own, which go with it: nobody sits there on a floor that hasn't one (see hasBoss). */
export const LOFT_SEATS: ReadonlySet<string> = new Set(SEATING.filter((s) => s.y === LOFT.y && !s.roof).map((s) => s.id));

const rectOf = (a: Area): Rect => [a.minX, a.maxX, a.minZ, a.maxZ];

function build(room: RoomOptions): Fixed {
  const rects: FixedRect[] = [];
  const circles: FixedCircle[] = [];
  if (hasKitchen(room)) rects.push({ rect: [-17, -10.75, 11.7, 12.7], what: 'the kitchen' }); // its counter and fridge
  // The posts under the floor's upstairs and the stairs up to it, on a floor that has one, and the elevator shaft.
  const deck = deckOf(room);
  if (deck) {
    const post = deck.kind === 'corner' ? "one of the loft's posts" : "one of the mezzanine's posts";
    for (const [x, z] of deck.posts) circles.push({ circle: [x, z, POST_R], what: post });
    for (const f of deck.flights) rects.push({ rect: rectOf(f.rect), what: 'the stairs' });
  }
  rects.push({ rect: [ELEVATOR.x - ELEVATOR.width / 2, ELEVATOR.x + ELEVATOR.width / 2, FLOOR.minZ, ELEVATOR_FRONT], what: 'the elevator' });
  // The ladder up the west wall, and the fire poles: a hole with a railing round it, or a landing mat.
  // Which spot has which changes floor by floor, so everything keeps off both.
  rects.push({ rect: [FLOOR.minX, FLOOR.minX + 0.3, LADDER.z - LADDER.width / 2 - 0.05, LADDER.z + LADDER.width / 2 + 0.05], what: 'the ladder' });
  for (const p of POLES) rects.push({ rect: [p.x - POLE.rail - 0.05, p.x + POLE.rail + 0.05, p.z - POLE.rail - 0.05, p.z + POLE.rail + 0.05], what: 'the fire pole' });
  // The board agents' kiosks, and the agent standing behind each one.
  for (const k of STATIONS) {
    rects.push({
      rect: around([point(k, -KIOSK.width / 2, -KIOSK.depth / 2), point(k, KIOSK.width / 2, -KIOSK.depth / 2), point(k, -KIOSK.width / 2, KIOSK.stand + 0.35), point(k, KIOSK.width / 2, KIOSK.stand + 0.35)]),
      what: `the ${k.label.toLowerCase()}'s kiosk`,
    });
  }
  // Where the floor's workers meet (see shared/meeting-place.ts). As the office comes that's the meeting
  // room (under the loft, where there is one): its glass walls, with the doorway in the north one, and
  // the table with its chairs, as world/office/meeting-room.ts puts them. Elsewhere it's the stage's
  // table or the anchor desk, with whatever stands with it.
  rects.push(...meetingPlace(room).fixed);
  // Chairs tucked in at the table: just the middle of each, so there's a way round behind them, between
  // their backs and the glass (or the back wall), which is one cell wide.
  for (const d of meetingSeats(room)) {
    const [cx, cz] = point(d, 0, 0.85);
    circles.push({ circle: [cx, cz, 0.18], what: 'a meeting chair' });
  }
  // The Steps, on a floor that has them: the whole block, tiers and walls, for whoever walks the floor
  // by its grid (the workers, the dog and the goat stay down on it).
  if (hasSteps(room)) rects.push({ rect: STEPS_RECT, what: 'the Steps' });
  return { rects, circles };
}

/** One of each per structure (see structureKey): asking twice for the same room gets the same lists. */
const BUILT = new Map<string, Fixed>();

/** Everything built into an office floor with this room that's in the way. */
export function fixedIn(room: RoomOptions = {}): Fixed {
  const key = structureKey(room);
  let fixed = BUILT.get(key);
  if (!fixed) BUILT.set(key, (fixed = build(room)));
  return fixed;
}

/** Everything built into the office floor as it comes that's in the way. */
export const FIXED = fixedIn();

function clear(room: RoomOptions): FixedRect[] {
  return [
    { rect: [ELEVATOR.x - ELEVATOR.doorWidth / 2 - 0.3, ELEVATOR.x + ELEVATOR.doorWidth / 2 + 0.3, ELEVATOR_FRONT, ELEVATOR_FRONT + 1.3], what: "the elevator's doors" },
    { rect: [FLOOR.minX, FLOOR.minX + 1.3, EXIT_DOOR.u - EXIT_DOOR.width / 2 - 0.2, EXIT_DOOR.u + EXIT_DOOR.width / 2 + 0.2], what: 'the exit door' },
    { rect: [BALCONY_DOOR.u - BALCONY_DOOR.width / 2, BALCONY_DOOR.u + BALCONY_DOOR.width / 2, FLOOR.maxZ - 1.3, FLOOR.maxZ], what: 'the balcony doors' },
    ...(deckOf(room)?.flights ?? []).map((f) => ({ rect: rectOf(f.foot), what: 'the foot of the stairs' })),
    // What the meeting place needs clear: the glass room's door, the floor in front of the stage's board.
    ...meetingPlace(room).clear,
    ...(hasKitchen(room) ? [{ rect: [-17, -10.75, 10.7, 11.7] as Rect, what: 'the kitchen counter' }] : []),
    { rect: [FLOOR.minX + 0.3, FLOOR.minX + 1.2, LADDER.z - 0.6, LADDER.z + 0.6], what: 'the ladder' },
    ...STATIONS.map((k) => {
      const [x, z] = point(k, 0, -1);
      return { rect: [x - 0.6, x + 0.6, z - 0.5, z + 0.5] as Rect, what: `the ${k.label.toLowerCase()}'s kiosk` };
    }),
  ];
}

const CLEAR = new Map<string, readonly FixedRect[]>();

/**
 * Doorways and the floor in front of them on a floor with this room, which the builder keeps clear so
 * nobody's shut in (or out): nothing's there to walk round, so getting round the floor doesn't know them.
 */
export function keepClearIn(room: RoomOptions = {}): readonly FixedRect[] {
  const key = structureKey(room);
  let rects = CLEAR.get(key);
  if (!rects) CLEAR.set(key, (rects = clear(room)));
  return rects;
}

/** What's kept clear on the office floor as it comes. */
export const KEEP_CLEAR: readonly FixedRect[] = keepClearIn();

const CLEAR_UP = new Map<string, readonly FixedRect[]>();

/** The same upstairs, for what the builder stands on a deck (pieces with `level: 1`): where each flight of stairs arrives. */
export function keepClearUp(room: RoomOptions = {}): readonly FixedRect[] {
  const key = structureKey(room);
  let rects = CLEAR_UP.get(key);
  if (!rects) CLEAR_UP.set(key, (rects = (deckOf(room)?.flights ?? []).map((f) => ({ rect: rectOf(f.top), what: 'the top of the stairs' }))));
  return rects;
}
