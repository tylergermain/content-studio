// A floor's meeting place: where its AI workers sit when a meeting's called (server/meetings.ts). It's
// the floor's own choice (RoomOptions.meeting in shared/floorplan.ts), one of three: the glass room in
// the south-east corner the office comes with, a panel table on a stage in front of the lounge's TV,
// or an anchor desk out in the newsroom with a prompter in front of it. Each is five seats with the
// same ids (MEETING_SEATS in layout.ts, which a meeting fills in order), a board the meeting's output
// is written on and a sign that says how it's going. Everything that depends on where they are asks
// here: what's built into the floor (office-fixed.ts), whoever finds a seated worker (server/dog.ts),
// and whoever builds it in 3D (client/world/office).

import type { RoomOptions } from './floorplan.js';
import { FLOOR, MEETING_BOARD, MEETING_ROOM, MEETING_SEATS, MEETING_TABLE, type DeskDef } from './layout.js';
import type { FixedRect, Rect } from './office-fixed.js';

export type MeetingKind = 'room' | 'forum' | 'desk';
/** Every kind, the office's own first. */
export const MEETING_KINDS: readonly MeetingKind[] = ['room', 'forum', 'desk'];

/** A spot on the floor something's used from, and how near it is near enough. */
interface UseSpot {
  x: number;
  z: number;
  radius: number;
}

/** One meeting place: where everything of it is, for the rules, the paths and the 3D office alike. */
export interface MeetingPlace {
  kind: MeetingKind;
  /** What the hint calls it ("🤝 Meeting room"). */
  title: string;
  /** Where someone standing in `area` is said to be ("🤝 in the meeting room"). */
  where: string;
  /** The floor that counts as being there. */
  area: Rect;
  /** Its table: `width` across x and `depth` along z, whichever way it runs. */
  table: { x: number; z: number; width: number; depth: number; height: number };
  /** The five places at the table, in the order a meeting fills them (see MEETING_SEATS): the chair is out from each the way a desk's is. */
  seats: readonly { x: number; z: number; rotY: number }[];
  /** The board the meeting's output is written on. `rotY` is the way it faces (0 = +z); `twoSided` is read from behind too. */
  board: { x: number; y: number; z: number; rotY: number; width: number; height: number; twoSided?: boolean };
  /** The panel that says how the meeting's going, `scale` its size next to the glass room's. */
  sign: { x: number; y: number; z: number; rotY: number; scale: number };
  /** Where each is used from: the table (to call a meeting), the board and the sign. */
  use: { talk: UseSpot; read: UseSpot; sign: UseSpot };
  /** The glass room round it, where it has one. */
  glass?: typeof MEETING_ROOM;
  /** What of it is in the way: its table, and whatever else stands with it. (The chairs go by `seats`.) */
  fixed: FixedRect[];
  /** The floor it needs kept clear. */
  clear: FixedRect[];
}

/** The table's rectangle on the floor. */
const tableRect = (t: MeetingPlace['table']): Rect => [t.x - t.width / 2, t.x + t.width / 2, t.z - t.depth / 2, t.z + t.depth / 2];

/** The glass room's seats as the office comes, taken before any browser stands them somewhere else (see client/world/office/meeting-place.ts). */
const ROOM_SEATS: readonly DeskDef[] = MEETING_SEATS.map((d) => ({ ...d }));

/** How thick the glass is to whoever walks round it, and where the sign is on it: inside the pane by the door, facing out. */
const GLASS = 0.06;
const ROOM_SIGN = { x: (MEETING_ROOM.minX + MEETING_ROOM.door.x0) / 2 + 0.01, z: MEETING_ROOM.minZ + 0.08 } as const;

/** The office's own: the glass room under the loft, a long table in the middle, the board on the back wall. */
const ROOM: MeetingPlace = {
  kind: 'room',
  title: '🤝 Meeting room',
  where: '🤝 in the meeting room',
  area: [MEETING_ROOM.minX, MEETING_ROOM.maxX, MEETING_ROOM.minZ, MEETING_ROOM.maxZ],
  table: MEETING_TABLE,
  seats: ROOM_SEATS.map(({ x, z, rotY }) => ({ x, z, rotY })),
  board: { x: MEETING_BOARD.x, y: MEETING_BOARD.y, z: MEETING_BOARD.z, rotY: Math.PI, width: MEETING_BOARD.width, height: MEETING_BOARD.height },
  sign: { x: ROOM_SIGN.x, y: 1.45, z: ROOM_SIGN.z, rotY: Math.PI, scale: 1 },
  use: {
    talk: { x: MEETING_TABLE.x, z: MEETING_TABLE.z, radius: 2.9 },
    read: { x: MEETING_BOARD.x, z: MEETING_BOARD.z - 1.4, radius: 2.4 },
    sign: { x: ROOM_SIGN.x, z: MEETING_ROOM.minZ - 1.2, radius: 1.8 },
  },
  glass: MEETING_ROOM,
  // Its glass walls, with the doorway in the north one, and the table.
  fixed: [
    { rect: [MEETING_ROOM.minX - GLASS, MEETING_ROOM.minX + GLASS, MEETING_ROOM.minZ - GLASS, MEETING_ROOM.maxZ], what: "the meeting room's glass" },
    { rect: [MEETING_ROOM.minX - GLASS, MEETING_ROOM.door.x0, MEETING_ROOM.minZ - GLASS, MEETING_ROOM.minZ + GLASS], what: "the meeting room's glass" },
    { rect: [MEETING_ROOM.door.x1, MEETING_ROOM.maxX, MEETING_ROOM.minZ - GLASS, MEETING_ROOM.minZ + GLASS], what: "the meeting room's glass" },
    { rect: tableRect(MEETING_TABLE), what: 'the meeting table' },
  ],
  clear: [{ rect: [MEETING_ROOM.door.x0, MEETING_ROOM.door.x1, MEETING_ROOM.minZ - 1, MEETING_ROOM.minZ + 1], what: "the meeting room's door" }],
};

/**
 * The stage: a panel table across the front of the lounge, its five seats along the east side facing
 * west, with the TV behind them and whoever's watching in front (on the Steps, where the floor has
 * them). The output board and the sign hang on the east wall, either side of the TV.
 */
const FORUM_TABLE = { x: 15.5, z: 0, width: 0.8, depth: 5.5, height: 0.76 } as const;
/**
 * Where the places are across the table, which is only 0.8 deep. There's 5 cm of it to choose from,
 * x 15.40 to 15.44: any nearer the chairs and a worker walking in to one chair finds the next one's in
 * its way (the cell it comes in by, see wayTo in nav.ts); any further from them and the lid of its
 * open laptop hangs over the audience's edge. tests/meeting-place.test.ts holds it to both.
 */
const FORUM_PLACE_X = 15.42;
const FORUM_BOARD = { x: FLOOR.maxX - 0.08, y: 1.95, z: 5.4, rotY: -Math.PI / 2, width: 3.6, height: 1.2 } as const;
const FORUM_SIGN = { x: FLOOR.maxX - 0.1, y: 1.45, z: -4.2, rotY: -Math.PI / 2, scale: 1 } as const;
const FORUM: MeetingPlace = {
  kind: 'forum',
  title: '🎤 Stage',
  where: '🎤 on the stage',
  area: [13.5, FLOOR.maxX, -3.1, 3.1],
  table: FORUM_TABLE,
  // Whoever leads it in the middle, then out to either side by turns.
  seats: [0, -1.1, 1.1, -2.2, 2.2].map((z) => ({ x: FORUM_PLACE_X, z, rotY: Math.PI / 2 })),
  board: FORUM_BOARD,
  sign: FORUM_SIGN,
  use: {
    talk: { x: FORUM_TABLE.x, z: FORUM_TABLE.z, radius: 2.9 },
    read: { x: FORUM_BOARD.x - 1.4, z: FORUM_BOARD.z, radius: 2.4 },
    sign: { x: FORUM_SIGN.x - 1.2, z: FORUM_SIGN.z, radius: 1.8 },
  },
  fixed: [{ rect: tableRect(FORUM_TABLE), what: 'the panel table' }],
  // In front of the board, so it can be read (the jukebox and the arcade stand there, in the office as it comes).
  clear: [{ rect: [17, FLOOR.maxX, 3.45, 7.35], what: "the stage's board" }],
};

/**
 * The anchor desk: a long desk out in the newsroom, its five seats along the north side facing south
 * like a news team on camera, the boards on the north wall behind them. The meeting's output is on a
 * prompter out in front, read from both sides, and the sign is on the desk's own front. Each place is
 * in the middle of the desk, which is 0.8 deep too: an open laptop any nearer its chair hangs over the edge.
 */
const DESK_TABLE = { x: -3.9, z: -6.2, width: 7, depth: 0.8, height: 0.76 } as const;
const PROMPTER = { x: -3.9, y: 1.25, z: -3.2, rotY: Math.PI, width: 1.8, height: 0.6, twoSided: true } as const;
const DESK_SIGN = { x: -6.9, y: 0.38, z: -5.78, rotY: 0, scale: 0.72 } as const;
const DESK: MeetingPlace = {
  kind: 'desk',
  title: '🎥 Anchor desk',
  where: '🎥 at the anchor desk',
  area: [-8, 0.2, -8.2, -4.9],
  table: DESK_TABLE,
  seats: [-3.9, -5.3, -2.5, -6.7, -1.1].map((x) => ({ x, z: DESK_TABLE.z, rotY: Math.PI })),
  board: PROMPTER,
  sign: DESK_SIGN,
  use: {
    // The desk is seven meters long: from either end of it too.
    talk: { x: DESK_TABLE.x, z: DESK_TABLE.z, radius: 3.6 },
    // Round the prompter, whichever side of it you're on.
    read: { x: PROMPTER.x, z: PROMPTER.z, radius: 2.4 },
    sign: { x: DESK_SIGN.x, z: DESK_SIGN.z + 1.2, radius: 1.8 },
  },
  fixed: [
    { rect: tableRect(DESK_TABLE), what: 'the anchor desk' },
    { rect: [-4.8, -3, -3.35, -3.05], what: 'the prompter' },
  ],
  clear: [],
};

const PLACES: Record<MeetingKind, MeetingPlace> = { room: ROOM, forum: FORUM, desk: DESK };

/** Which meeting place a room has. One that doesn't say has the glass room, as the office comes. */
export function meetingOf(room: RoomOptions = {}): MeetingKind {
  return room.meeting === 'forum' || room.meeting === 'desk' ? room.meeting : 'room';
}

/** The room's meeting place. The same object every time for the same kind. */
export function meetingPlace(room: RoomOptions = {}): MeetingPlace {
  return PLACES[meetingOf(room)];
}

/**
 * The five meeting seats where a floor with this room has them: MEETING_SEATS' ids and labels, at the
 * room's own places. Fresh copies, for whoever keeps several floors at once (the server); a browser,
 * which shows one, stands the shared MEETING_SEATS there instead.
 */
export function meetingSeats(room: RoomOptions = {}): DeskDef[] {
  const { seats } = meetingPlace(room);
  return ROOM_SEATS.map((d, i) => ({ ...d, ...seats[i] }));
}
