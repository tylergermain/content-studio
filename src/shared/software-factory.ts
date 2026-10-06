import { ROOM_MEDIA, kindDef, type FurnitureKind, type Piece } from './furniture.js';
import type { RoomOptions } from './floorplan.js';

// The Software Factory's layout (the office builder's Factory layout), laid out the way a software company's floor
// is, open plan: you come out of the elevator into the lobby, where the boards and their agents are, and walk
// straight down the spine to the main aisle. Along it, on both sides, are the project tables: each one a patch of
// floor in its project's colour (a project room) with a conference table on it whose chairs are where its workers
// sit (shared/table-seats.ts), a screen up out of the middle of the table showing the project's app live to both
// sides of it, and a sign hung over it saying what it's for. Nothing's walled in: you walk from one table to the
// next. The floor is seated only at the tables. The rest is the company's: the commons round the big TV with two
// glass focus booths, the plaza round the fire pole, the caf\u00e9 and kitchen along the south windows, the walk to
// the balcony and the meeting room in the south-east corner. A table is set up for a GitHub repository from the
// Rooms panel, which names it on its sign and the floor; whoever's hired at it works in a worktree of it.

const QUARTER = Math.PI / 2;
/** How far a north-south wall stops short of an east-west one's middle: past half the thickest wall's depth. */
const INSET = 0.08;
const DOOR_W = 1.4;

/** The bands across the floor, north to south: the lobby, the north tables, the main aisle, the south tables, then the caf\u00e9 band. */
const LOBBY = -7;
const AISLE = { north: -1, south: 1.4 } as const;
const SOUTH_BACK = 7.4;

/** The project tables' patches of floor, west to east: their x extents. North of the aisle, then south (the walk to the balcony is between the second and third). */
const NORTH_TABLES: readonly (readonly [number, number])[] = [[-18, -12], [-12, -6], [-6, 0], [0, 6]];
const SOUTH_TABLES: readonly (readonly [number, number])[] = [[-16.4, -11.2], [-11.2, -6], [-2.4, 4.4]];
/** Each table's colour on the floor, and its sign's, a brighter one of the same. */
const ACCENTS = ['#2f8f83', '#4a63b8', '#d0703f', '#4f8a3c', '#8a4f87', '#c99a2e', '#4f7fa8'];
const SIGNS = ['#7fd1c7', '#9fb3ff', '#ffab85', '#a6dd8f', '#e0a8db', '#ffd166', '#9cc9ec'];
/** The glass's frames and the doors': brushed aluminium. */
const FRAME = '#aab3bd';

/** The room options it goes with: one level, the kitchen, a plain ceiling, everyone at the tables. */
export const FACTORY_ROOM: RoomOptions = { mezzanine: 'none', kitchen: true, seating: 'tables' };

/** The factory's pieces, its tables called `names` (Table 1\u2026 for any it doesn't name), north side first, west to east. */
export function softwareFactory(names: readonly string[] = []): Piece[] {
  const pieces: Piece[] = [];
  let n = 0;
  const round = (v: number) => Math.round(v * 100) / 100;
  const add = (kind: FurnitureKind, x: number, z: number, rotY: number, extra: Partial<Piece> = {}) => {
    const k = kindDef(kind);
    pieces.push({ id: `fx-${kind.replace(/[^a-z]/g, '').slice(0, 10)}-${++n}`, kind, x: round(x), z: round(z), rotY, ...(k.color ? { color: k.color } : {}), ...extra });
  };
  /** Glass to the ceiling along x at `z`, from `x0` to `x1`. */
  const ew = (x0: number, x1: number, z: number) => {
    if (x1 - x0 > 0.25) add('tall-glass', (x0 + x1) / 2, z, 0, { w: round(x1 - x0), color: FRAME });
  };
  /** Glass to the ceiling along z at `x`, from `z0` to `z1`, stopping short of the glass across its ends. */
  const ns = (z0: number, z1: number, x: number) => add('tall-glass', x, (z0 + z1) / 2, QUARTER, { w: round(z1 - z0 - 2 * INSET), color: FRAME });
  /** Glass along x at `z` from `x0` to `x1`, with an automatic door `at` in from `x0` under `name`, its front (and blade sign) toward -z. */
  const front = (x0: number, x1: number, z: number, name: string, at: number) => {
    const d0 = x0 + at, d1 = d0 + DOOR_W;
    ew(x0, d0, z);
    add('glass-door', (d0 + d1) / 2, z, Math.PI, { text: name, color: FRAME });
    ew(d1, x1, z);
  };
  /**
   * A project table: its patch of floor in its colour, the conference table in the middle of it, the screen up out of
   * the table's middle (a face to each long side) showing its app, and its sign hung over it.
   */
  const projectTable = (x0: number, x1: number, z0: number, z1: number, name: string, i: number) => {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    add('project-room', cx, cz, 0, { text: name, color: ACCENTS[i], w: Math.floor((x1 - x0 - 0.2) * 4) / 4, d: Math.floor((z1 - z0 - 0.2) * 4) / 4 });
    add('conference-table', cx, cz, 0);
    add('table-display', cx, cz, 0, { media: ROOM_MEDIA });
    add('table-sign', cx, cz, 0, { text: name, color: SIGNS[i] });
  };
  const label = (i: number) => names[i] || `Table ${i + 1}`;

  // ---- The tables either side of the main aisle, a planter between neighbours ----
  NORTH_TABLES.forEach(([x0, x1], i) => {
    projectTable(x0, x1, LOBBY, AISLE.north, label(i), i);
    if (i > 0) add('planter', x0, (LOBBY + AISLE.north) / 2, QUARTER);
    add('fiddle-leaf', x1 - 0.45, LOBBY + 0.45, 0);
  });
  SOUTH_TABLES.forEach(([x0, x1], j) => {
    projectTable(x0, x1, AISLE.south, SOUTH_BACK, label(NORTH_TABLES.length + j), NORTH_TABLES.length + j);
    add('snake-plant', x1 - 0.45, SOUTH_BACK - 0.45, 0);
  });
  add('planter', -11.2, (AISLE.south + SOUTH_BACK) / 2, QUARTER);

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
    front(x0, x1, 5, name, 0.5);
    ew(x0, x1, SOUTH_BACK);
    add('armchair', (x0 + x1) / 2, 6.6, Math.PI, { color: '#81b29a' });
    add('floor-lamp', x1 - 0.4, 6.95, 0);
  }
  for (const x of [12, 14.4, 16.8]) ns(5, SOUTH_BACK, x);

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
