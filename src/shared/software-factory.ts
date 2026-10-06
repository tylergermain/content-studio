import { ROOM_MEDIA, kindDef, type FurnitureKind, type Piece } from './furniture.js';
import type { RoomOptions } from './floorplan.js';

// The Software Factory's layout (the office builder's Factory layout), laid out the way a software company's floor
// is: you come out of the elevator into the lobby, where the boards and their agents are, and walk straight down
// the spine to the main hallway. Project rooms open off both sides of it, walled to the ceiling, glass to the
// hallway with an automatic door under the room's lit name, a TV on the wall and a conference table whose chairs
// are where its workers sit (shared/table-seats.ts); the floor is seated only at those. The rest is the company's:
// the commons round the big TV with two focus booths, the plaza round the fire pole, the caf\u00e9 and kitchen along the
// south windows, the balcony walk, and the meeting room in the south-east corner. A room is set up for a GitHub
// repository from the Rooms panel, which names it on its door and the floor; whoever's hired at its table works in
// a worktree of it. Walls running east-west run the room's length; those running north-south stop just short of
// them, so no two overlap.

const QUARTER = Math.PI / 2;
/** How far a north-south wall stops short of an east-west one's middle: past half the thickest wall's depth. */
const INSET = 0.08;
const DOOR_W = 1.4;
/** Where a room's door starts, in from the room's west end. */
const DOOR_AT = 1.0;
/** A conference table's length with its chairs (its kind's `w`), and how far its end stands off the TV's wall: the rest of the room is the way round it. */
const TABLE_LONG = 4;
const TV_GAP = 0.5;
/** A tall wall's half depth: where its face is. */
const FACE = 0.07;

/** The bands across the floor, north to south: the lobby, the north rooms, the hallway, the south rooms, then the caf\u00e9 band. */
const LOBBY = -7;
const HALL = { north: -1, south: 1.4 } as const;
const SOUTH_BACK = 7.4;

/** The project rooms, west to east: their x extents. North of the hallway, then south (the balcony walk is between S2 and S3). */
const NORTH_ROOMS: readonly (readonly [number, number])[] = [[-18, -12], [-12, -6], [-6, 0], [0, 6]];
const SOUTH_ROOMS: readonly (readonly [number, number])[] = [[-16.4, -11.2], [-11.2, -6], [-2.4, 4.4]];
/** Each room's own colour, on the wall its TV hangs on. */
const ACCENTS = ['#2f5d62', '#2b3a67', '#b5562f', '#3a5a40', '#5e3c58', '#c08a2b', '#46607a'];
const PLAIN = '#f1ede6';
/** The glass's frames and the doors': brushed aluminium. */
const FRAME = '#aab3bd';

/** The room options it goes with: one level, the kitchen, a plain ceiling over the tall walls, everyone at the tables. */
export const FACTORY_ROOM: RoomOptions = { mezzanine: 'none', kitchen: true, seating: 'tables' };

/** The factory's pieces, its rooms called `names` (Room 1\u2026 for any it doesn't name), north side first, west to east. */
export function softwareFactory(names: readonly string[] = []): Piece[] {
  const pieces: Piece[] = [];
  let n = 0;
  const round = (v: number) => Math.round(v * 100) / 100;
  const add = (kind: FurnitureKind, x: number, z: number, rotY: number, extra: Partial<Piece> = {}) => {
    const k = kindDef(kind);
    pieces.push({ id: `fx-${kind.replace(/[^a-z]/g, '').slice(0, 10)}-${++n}`, kind, x: round(x), z: round(z), rotY, ...(k.color ? { color: k.color } : {}), ...extra });
  };
  /** A wall to the ceiling along x at `z`, from `x0` to `x1`. */
  const ew = (kind: 'tall-wall' | 'tall-glass', x0: number, x1: number, z: number, color = kind === 'tall-glass' ? FRAME : undefined) => {
    if (x1 - x0 > 0.25) add(kind, (x0 + x1) / 2, z, 0, { w: round(x1 - x0), ...(color ? { color } : {}) });
  };
  /** A wall to the ceiling along z at `x`, from `z0` to `z1`, stopping short of the walls across its ends. */
  const ns = (kind: 'tall-wall' | 'tall-glass', z0: number, z1: number, x: number, color = kind === 'tall-glass' ? FRAME : undefined) => {
    add(kind, x, (z0 + z1) / 2, QUARTER, { w: round(z1 - z0 - 2 * INSET), ...(color ? { color } : {}) });
  };
  /**
   * Glass along x at `z` from `x0` to `x1`, with an automatic door `DOOR_AT` in from `x0` under `name`, its front
   * (where its blade sign sticks out) toward +z when `south`, else toward -z: the hallway's side.
   */
  const front = (x0: number, x1: number, z: number, name: string, south: boolean, doorAt = DOOR_AT) => {
    const d0 = x0 + doorAt, d1 = d0 + DOOR_W;
    ew('tall-glass', x0, d0, z);
    add('glass-door', (d0 + d1) / 2, z, south ? 0 : Math.PI, { text: name, color: FRAME });
    ew('tall-glass', d1, x1, z);
  };
  /**
   * A project room: the floor marked out for it, its TV on the wall facing `tvRot`, and its conference table end
   * on to the TV, standing off it by TV_GAP so there's a way round the table from the door.
   */
  const projectRoom = (x0: number, x1: number, z0: number, z1: number, name: string, tv: { x: number; z: number; rotY: number }) => {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    add('project-room', cx, cz, 0, { text: name, w: Math.floor((x1 - x0 - 0.2) * 4) / 4, d: Math.floor((z1 - z0 - 0.2) * 4) / 4 });
    // The TV's on an east wall (the table along x) or a south one (the table along z).
    const off = FACE + TV_GAP + TABLE_LONG / 2;
    if (tv.rotY === -QUARTER) add('conference-table', x1 - off, cz, 0);
    else add('conference-table', cx, z1 - off, QUARTER);
    add('wall-screen', tv.x, tv.z, tv.rotY, { media: ROOM_MEDIA });
  };
  const label = (i: number) => names[i] || `Room ${i + 1}`;

  // ---- North rooms: glass to the lobby, glass and the door to the hallway, the TV on the east wall ----
  NORTH_ROOMS.forEach(([x0, x1], i) => {
    ew('tall-glass', x0, x1, LOBBY);
    front(x0, x1, HALL.north, label(i), true);
    ns('tall-wall', LOBBY, HALL.north, x1, ACCENTS[i]);
    projectRoom(x0, x1, LOBBY, HALL.north, label(i), { x: x1 - 0.13, z: (LOBBY + HALL.north) / 2, rotY: -QUARTER });
    // In the corner by the TV, which the way round the table doesn't need.
    add('fiddle-leaf', x1 - 0.45, LOBBY + 0.45, 0);
  });

  // ---- South rooms: the door to the hallway, the TV on the south wall; the last one glass to the plaza ----
  SOUTH_ROOMS.forEach(([x0, x1], j) => {
    const i = NORTH_ROOMS.length + j;
    front(x0, x1, HALL.south, label(i), false);
    ew('tall-wall', x0, x1, SOUTH_BACK, ACCENTS[i]);
    projectRoom(x0, x1, HALL.south, SOUTH_BACK, label(i), { x: (x0 + x1) / 2, z: SOUTH_BACK - 0.13, rotY: Math.PI });
    add('snake-plant', x1 - 0.45, SOUTH_BACK - 0.45, 0);
  });
  // Their side walls: the west walk's, between S1 and S2, the balcony walk's two, and glass onto the plaza.
  for (const x of [-16.4, -11.2, -6, -2.4]) ns('tall-wall', HALL.south, SOUTH_BACK, x, PLAIN);
  ns('tall-glass', HALL.south, SOUTH_BACK, 4.4);

  // ---- The lobby: a reception counter by the elevator, seats to wait in, plants along the boards ----
  add('credenza', 12.6, -9.6, -QUARTER, { color: '#8a6f55' });
  add('lounge-chair', 2.9, -8.4, 0);
  add('lounge-chair', 4.9, -8.4, 0);
  add('side-table', 3.9, -8.5, 0);
  for (const x of [-17.3, -11.7, -3.9, 5.6]) add('monstera', x, -9.6, 0, { scale: 1.2 });
  add('palm', 17.3, -12.3, 0, { scale: 1.3 });

  // ---- The commons round the big TV on the east wall, and two focus booths ----
  add('rug-round', 15.4, 0, 0, { color: '#d9c7a8' });
  add('sofa', 13.4, 0, QUARTER, { color: '#3d5a80' });
  add('armchair', 15.4, -2.3, 0, { color: '#e07a5f' });
  add('armchair', 15.4, 2.3, Math.PI, { color: '#e07a5f' });
  add('coffee-table', 15.4, 0, 0);
  add('bird-of-paradise', 11.4, -4.6, 0, { scale: 1.2 });
  add('ficus', 11.4, 4.2, 0, { scale: 1.2 });
  for (const [x0, x1, name] of [[12, 14.4, 'Focus booth'], [14.4, 16.8, 'Focus booth']] as const) {
    front(x0, x1, 5, name, false, 0.5);
    ew('tall-glass', x0, x1, SOUTH_BACK);
    add('armchair', (x0 + x1) / 2, 6.6, Math.PI, { color: '#81b29a' });
    add('floor-lamp', x1 - 0.4, 6.95, 0);
  }
  for (const x of [12, 14.4, 16.8]) ns('tall-glass', 5, SOUTH_BACK, x);

  // ---- The plaza round the fire pole ----
  for (const [x, z] of [[5.4, 4.4], [8.6, 4.4], [9.4, 6]] as const) add('pouf', x, z, 0, { color: '#f2cc8f' });
  add('planter', 7.6, 6.9, 0);

  // ---- The caf\u00e9 along the south windows (the kitchen's in the corner), and a lounge east of the balcony walk ----
  for (const x of [-15.2, -10.4]) {
    add('table', x, 9.2, 0, { color: '#c98b5a' });
    for (const dx of [-0.8, 0, 0.8]) {
      add('stool', x + dx, 8.4, 0);
      add('stool', x + dx, 10, 0);
    }
  }
  add('standing-table', -7.4, 9.4, 0);
  add('rug-small', 2, 10.4, 0, { color: '#e9d8a6' });
  add('lounge-chair', 0.9, 10.6, Math.PI);
  add('lounge-chair', 3.1, 10.6, Math.PI);
  add('side-table', 2, 10.8, 0);
  for (const x of [-1.6, 5.2]) add('pothos', x, 12.4, 0);
  add('monstera', 8.4, 8, 0, { scale: 1.2 });
  return pieces;
}
