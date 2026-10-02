// What's built into the office floor and stays where it is: the rooms, the kitchen, the elevator and
// the rest. (The whiteboard, the jukebox and their like are furniture: see shared/furniture.ts.) Getting round the floor goes round them (shared/nav.ts), and the office
// builder keeps the furniture off them and out of the doorways (shared/office-builder.ts).

import type { RoomOptions } from './floorplan.js';
import { BALCONY_DOOR, ELEVATOR, ELEVATOR_FRONT, EXIT_DOOR, FLOOR, KIOSK, LADDER, LOFT, MEETING_ROOM, MEETING_SEATS, MEETING_TABLE, POLE, POLES, SEATING, STAIRS, STATIONS, type DeskDef } from './layout.js';

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
 * Whether a floor with this room has the mezzanine: the boss's loft on its posts, and the stairs up to
 * it. A room that doesn't say has it, as the office comes (ROOM_DEFAULTS in floorplan.ts).
 */
export const hasLoft = (room: RoomOptions = {}): boolean => room.loft !== false;

/** The seats up in the loft, which go with it: nobody sits there on a floor that's all one level. */
export const LOFT_SEATS: ReadonlySet<string> = new Set(SEATING.filter((s) => s.y === LOFT.y && !s.roof).map((s) => s.id));

function build(loft: boolean): Fixed {
  const rects: FixedRect[] = [];
  const circles: FixedCircle[] = [];
  rects.push({ rect: [-17, -10.75, 11.7, 12.7], what: 'the kitchen' }); // its counter and fridge
  // The loft's posts and the stairs up to it, on a floor that has them, and the elevator shaft.
  if (loft) {
    for (const x of [LOFT.minX + 0.15, (LOFT.minX + LOFT.maxX) / 2]) circles.push({ circle: [x, LOFT.minZ + 0.15, 0.14], what: "one of the loft's posts" });
    rects.push({ rect: [STAIRS.fromX, STAIRS.toX, STAIRS.minZ - 0.1, STAIRS.maxZ], what: 'the stairs' });
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
  // The meeting room (under the loft, where there is one): its glass walls, with the doorway in the
  // north one, and the table with its chairs, as world/office/meeting-room.ts puts them.
  const room = MEETING_ROOM;
  const G = 0.06;
  rects.push({ rect: [room.minX - G, room.minX + G, room.minZ - G, room.maxZ], what: "the meeting room's glass" });
  rects.push({ rect: [room.minX - G, room.door.x0, room.minZ - G, room.minZ + G], what: "the meeting room's glass" });
  rects.push({ rect: [room.door.x1, room.maxX, room.minZ - G, room.minZ + G], what: "the meeting room's glass" });
  const t = MEETING_TABLE;
  rects.push({ rect: [t.x - t.width / 2, t.x + t.width / 2, t.z - t.depth / 2, t.z + t.depth / 2], what: 'the meeting table' });
  // Chairs tucked in at the table: just the middle of each, so there's a way round behind them, between
  // their backs and the glass (or the back wall), which is one cell wide.
  for (const d of MEETING_SEATS) {
    const [cx, cz] = point(d, 0, 0.85);
    circles.push({ circle: [cx, cz, 0.18], what: 'a meeting chair' });
  }
  return { rects, circles };
}

const BUILT = new Map<boolean, Fixed>();

/** Everything built into an office floor with this room that's in the way. */
export function fixedIn(room: RoomOptions = {}): Fixed {
  const loft = hasLoft(room);
  let fixed = BUILT.get(loft);
  if (!fixed) BUILT.set(loft, (fixed = build(loft)));
  return fixed;
}

/** Everything built into the office floor as it comes that's in the way. */
export const FIXED = fixedIn();

function clear(loft: boolean): FixedRect[] {
  return [
    { rect: [ELEVATOR.x - ELEVATOR.doorWidth / 2 - 0.3, ELEVATOR.x + ELEVATOR.doorWidth / 2 + 0.3, ELEVATOR_FRONT, ELEVATOR_FRONT + 1.3], what: "the elevator's doors" },
    { rect: [FLOOR.minX, FLOOR.minX + 1.3, EXIT_DOOR.u - EXIT_DOOR.width / 2 - 0.2, EXIT_DOOR.u + EXIT_DOOR.width / 2 + 0.2], what: 'the exit door' },
    { rect: [BALCONY_DOOR.u - BALCONY_DOOR.width / 2, BALCONY_DOOR.u + BALCONY_DOOR.width / 2, FLOOR.maxZ - 1.3, FLOOR.maxZ], what: 'the balcony doors' },
    ...(loft ? [{ rect: [STAIRS.fromX - 1.2, STAIRS.fromX, STAIRS.minZ, STAIRS.maxZ] as Rect, what: 'the foot of the stairs' }] : []),
    { rect: [MEETING_ROOM.door.x0, MEETING_ROOM.door.x1, MEETING_ROOM.minZ - 1, MEETING_ROOM.minZ + 1], what: "the meeting room's door" },
    { rect: [-17, -10.75, 10.7, 11.7], what: 'the kitchen counter' },
    { rect: [FLOOR.minX + 0.3, FLOOR.minX + 1.2, LADDER.z - 0.6, LADDER.z + 0.6], what: 'the ladder' },
    ...STATIONS.map((k) => {
      const [x, z] = point(k, 0, -1);
      return { rect: [x - 0.6, x + 0.6, z - 0.5, z + 0.5] as Rect, what: `the ${k.label.toLowerCase()}'s kiosk` };
    }),
  ];
}

const CLEAR = new Map<boolean, readonly FixedRect[]>();

/**
 * Doorways and the floor in front of them on a floor with this room, which the builder keeps clear so
 * nobody's shut in (or out): nothing's there to walk round, so getting round the floor doesn't know them.
 */
export function keepClearIn(room: RoomOptions = {}): readonly FixedRect[] {
  const loft = hasLoft(room);
  let rects = CLEAR.get(loft);
  if (!rects) CLEAR.set(loft, (rects = clear(loft)));
  return rects;
}

/** What's kept clear on the office floor as it comes. */
export const KEEP_CLEAR: readonly FixedRect[] = keepClearIn();
