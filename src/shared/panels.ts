// Wood panelling on the room's outside walls (RoomOptions.panels in shared/floorplan.ts): which
// rectangles of each wall it covers. Pure, so the tests can hold it to the walls' openings; the 3D
// office lays its slats over them (client/world/office/panelling.ts).

import { BALCONY_DOOR, ELEVATOR, EXIT_DOOR, FLOOR, WALL_HEIGHT, WINDOWS, WING, type Opening, type Side } from './layout.js';

/** A rectangle of wall: `u` along it (x on the north and south walls, z on the east and west ones), `y` up from the office floor. */
export interface PanelRegion {
  u0: number;
  u1: number;
  y0: number;
  y1: number;
}

/** Where the panelling starts: on top of the baseboard. */
export const PANEL_BASE = 0.25;

/** Thinner than this isn't worth a rectangle. */
const SLIVER = 0.001;

/** `from` less `hole`: the whole of it when they don't meet, else the strips either side of the hole and what's under and over it between them. */
function less(from: PanelRegion, hole: PanelRegion): PanelRegion[] {
  const u0 = Math.max(from.u0, hole.u0);
  const u1 = Math.min(from.u1, hole.u1);
  const y0 = Math.max(from.y0, hole.y0);
  const y1 = Math.min(from.y1, hole.y1);
  if (u1 - u0 < SLIVER || y1 - y0 < SLIVER) return [from];
  return [
    { u0: from.u0, u1: u0, y0: from.y0, y1: from.y1 },
    { u0: u1, u1: from.u1, y0: from.y0, y1: from.y1 },
    { u0, u1, y0: from.y0, y1: y0 },
    { u0, u1, y0: y1, y1: from.y1 },
  ].filter((r) => r.u1 - r.u0 >= SLIVER && r.y1 - r.y0 >= SLIVER);
}

/**
 * `wall` less every one of `holes`, as rectangles that don't overlap. Each hole is taken out of
 * whatever's left, so holes may sit side by side, one over another in the same column, or across
 * each other, in any order.
 */
export function cutOut(wall: PanelRegion, holes: readonly PanelRegion[]): PanelRegion[] {
  let left = [wall];
  for (const hole of holes) left = left.flatMap((r) => less(r, hole));
  return left;
}

/** The hole an opening makes in its wall. */
const holeOf = (o: Opening): PanelRegion => ({ u0: o.u - o.width / 2, u1: o.u + o.width / 2, y0: o.y0, y1: o.y1 });

/** Every hole in the outside walls: the windows, and the doors out. */
const openings = (): Opening[] => [...WINDOWS, BALCONY_DOOR, EXIT_DOOR];

/**
 * What of the `side` wall wood panelling covers: the wall's inside face from the top of the baseboard
 * to the ceiling, less its windows and doors. `plugged` is a floor above the bottom one, where the exit
 * doorway is wall like the rest (see exitPlug) and is panelled over.
 *
 * The north wall stops where the back office begins (its own bit of wall comes down when it's built
 * out, and stays painted), and leaves out the elevator's shaft: the car has no back wall of its own,
 * so the wood would show inside it. `holes` is for a test to try walls the office hasn't got.
 */
export function panelRegions(side: Side, plugged: boolean, holes: readonly Opening[] = openings()): PanelRegion[] {
  const alongX = side === 'north' || side === 'south';
  const wall: PanelRegion = {
    u0: alongX ? FLOOR.minX : FLOOR.minZ,
    u1: side === 'north' ? WING.minX : alongX ? FLOOR.maxX : FLOOR.maxZ,
    y0: PANEL_BASE,
    y1: WALL_HEIGHT,
  };
  const out = holes.filter((o) => o.wall === side && !(plugged && o === EXIT_DOOR)).map(holeOf);
  if (side === 'north') out.push({ u0: ELEVATOR.x - ELEVATOR.width / 2, u1: ELEVATOR.x + ELEVATOR.width / 2, y0: 0, y1: WALL_HEIGHT });
  return cutOut(wall, out);
}
