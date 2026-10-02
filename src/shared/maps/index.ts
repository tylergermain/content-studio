import { BEANBAGS, BOARDS, DESKS, ELEVATOR, ELEVATOR_CAR, EXIT_DOOR, FLOOR, MEETING_SEATS, SEATING, SEATING_BY_ID, STATIONS, WALL_HEIGHT, WING_DESKS, seatPlace, type DeskDef, type SeatPlace } from '../layout.js';
import { BOARD_KEYS, type BoardDef, type BoardKey, type MapPlan } from './types.js';

export * from './types.js';

/**
 * The office's desks, by id: its room, then its back office (see WING), which is only there to sit at
 * on a floor built out that far (deskBuilt).
 */
const OFFICE_DESKS: DeskDef[] = [...DESKS, ...WING_DESKS];

function officePlan(): MapPlan {
  const byId = new Map([...OFFICE_DESKS, ...BEANBAGS, ...STATIONS, ...MEETING_SEATS].map((d) => [d.id, d]));
  const boards = {} as Record<BoardKey, BoardDef>;
  for (const k of BOARD_KEYS) boards[k] = { ...BOARDS[k] };
  return {
    id: 'office',
    name: 'Office',
    icon: '🏢',
    description: 'The office: desks, a lounge, the boss’s loft upstairs, a floor for every project, and a bar on the roof.',
    bounds: { ...FLOOR },
    height: WALL_HEIGHT,
    spawn: { x: ELEVATOR.x, y: 0, z: (ELEVATOR_CAR.minZ + ELEVATOR_CAR.maxZ) / 2, rotY: 0 },
    desks: OFFICE_DESKS,
    overflow: BEANBAGS,
    stations: STATIONS,
    meeting: MEETING_SEATS,
    byId,
    seating: SEATING,
    // The office's own map of them, which follows the floor's furniture (see setFloorSeats in shared/furniture.ts).
    seatingById: SEATING_BY_ID,
    door: { x: FLOOR.minX + 0.45, z: EXIT_DOOR.u },
    boards,
  };
}

/** Where everything is in the office: every floor's plan. */
export const OFFICE_PLAN: MapPlan = officePlan();

/** The place a peer's `seat` names on `plan` (see seatAt), or undefined if there's no such place. */
export function seatOn(plan: MapPlan, key: string): SeatPlace | undefined {
  const m = /^([\w-]+):(\d+)$/.exec(key);
  const seat = m ? plan.seatingById.get(m[1]) : undefined;
  const i = Number(m?.[2]);
  return seat && i < seat.places.length ? seatPlace(seat, i) : undefined;
}
