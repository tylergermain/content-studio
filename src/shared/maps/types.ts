import type { DeskDef, SeatDef } from '../layout.js';
import type { Bounds } from '../nav.js';

/*
 * The office's plan: where everything on a floor is, by id (see OFFICE_PLAN in ./index.ts). The
 * desks, the overflow seats, the board agents' kiosks and the meeting chairs are the same on every
 * floor, so workers, the queue and meetings find a seat by its id.
 */

/** The boards on the walls. */
export type BoardKey = 'issues' | 'queue' | 'pulls' | 'services';
export const BOARD_KEYS: readonly BoardKey[] = ['issues', 'queue', 'pulls', 'services'];

/** A board on a wall: its middle, the way it faces (0 is +z), its size, and what the sign over it says. */
export interface BoardDef {
  x: number;
  y: number;
  z: number;
  rotY: number;
  width: number;
  height: number;
  label: string;
}

/** Where everything is, by id. */
export interface MapPlan {
  id: string;
  name: string;
  icon: string;
  description: string;
  bounds: Bounds;
  /** How high the walls are. */
  height: number;
  /** Where you stand when you arrive. */
  spawn: { x: number; y: number; z: number; rotY: number };
  /** The regular seats, then the overflow ones that only come out once they're all taken (the bean bags). */
  desks: DeskDef[];
  overflow: DeskDef[];
  stations: DeskDef[];
  meeting: DeskDef[];
  /** The chairs at conference tables, where a floor's own tables put them (see shared/table-seats.ts). */
  tables: DeskDef[];
  /** Everywhere a worker can be, by id. */
  byId: Map<string, DeskDef>;
  /** Where people can sit (the couches, the chairs, the stools). */
  seating: SeatDef[];
  seatingById: Map<string, SeatDef>;
  /** Just inside the way out, where workers go home. */
  door: { x: number; z: number };
  boards: Record<BoardKey, BoardDef>;
}
