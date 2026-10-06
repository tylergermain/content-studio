import { kindDef, type FurnitureKind, type Piece } from './furniture.js';
import type { RoomOptions } from './floorplan.js';

// The Software Factory's layout (the office builder's Factory layout): plain rooms off one hallway, each a project
// room round a conference table whose chairs are where its workers sit (shared/table-seats.ts), the floor seated only
// at those (no desks, no bean bags). Four rooms on the north side between the lobby and the hallway, three on the
// south; corridors down the west and east walls; the meeting room in the south-east corner. A room is set up for a
// GitHub repository from the Rooms panel, which names it on its doorway and the floor; whoever's hired at its table
// works in a worktree of it. Walls running east-west go straight through; those running north-south stop just short
// of them, so no two overlap.

const QUARTER = Math.PI / 2;
/** A wall's half thickness, and what a north-south wall stops short of an east-west one by. */
const INSET = 0.1;
const ROOM_W = 7.2;
/** The rooms' edges west to east: four on the north side, three on the south (the meeting room's way in is east of them). */
const NORTH_X = [-14.4, -7.2, 0, 7.2];
const SOUTH_X = [-14.4, -7.2, 0];
/** Each row's east-west walls (the lobby's or the meeting room's side, and the hallway's with the doorways) and its depth inside. */
const NORTH = { back: -8.4, front: -8.4 + 7.2 + 2 * INSET, inside: 7.2 } as const;
const SOUTH = { front: 2.8, back: 2.8 + 4.8 + 2 * INSET, inside: 4.8 } as const;

/** The room options it goes with: one level, no kitchen, a lighting grid, everyone at the tables. */
export const FACTORY_ROOM: RoomOptions = { mezzanine: 'none', kitchen: false, ceiling: 'grid', seating: 'tables' };

/** The factory's pieces, its rooms called `names` (Room 1… for any it doesn't name), north side first, west to east. */
export function softwareFactory(names: readonly string[] = []): Piece[] {
  const pieces: Piece[] = [];
  let n = 0;
  const add = (kind: FurnitureKind, x: number, z: number, rotY: number, extra: Partial<Piece> = {}) => {
    const k = kindDef(kind);
    const round = (v: number) => Math.round(v * 100) / 100;
    pieces.push({ id: `fx-${kind.replace(/[^a-z]/g, '').slice(0, 10)}-${++n}`, kind, x: round(x), z: round(z), rotY, ...(k.color ? { color: k.color } : {}), ...extra });
  };
  /** An east-west wall across rooms `xs`, with each room's doorway in it when `doors`, named for the room. */
  const across = (z: number, xs: readonly number[], doors: string[] | undefined) => {
    xs.forEach((x0, i) => {
      if (!doors) for (const dx of [1.2, 3.6, 6]) add('wall', x0 + dx, z, 0);
      else {
        add('wall', x0 + 1.2, z, 0);
        add('wall-short', x0 + 3, z, 0);
        add('doorway', x0 + 4.2, z, 0, { text: doors[i] });
        add('wall', x0 + 6, z, 0);
      }
    });
  };
  /** The north-south walls between and beside rooms `xs`, from the wall at `z0` for `inside` metres. */
  const between = (xs: readonly number[], z0: number, inside: number) => {
    for (const x of [...xs, xs[xs.length - 1] + ROOM_W]) {
      let z = z0 + INSET;
      for (const len of inside >= 7.2 ? [2.4, 2.4, 2.4] : [2.4, 2.4]) {
        add('wall', x, z + len / 2, QUARTER);
        z += len;
      }
    }
  };
  const label = (i: number) => names[i] || `Room ${i + 1}`;
  const north = NORTH_X.map((_, i) => label(i));
  const south = SOUTH_X.map((_, i) => label(NORTH_X.length + i));
  across(NORTH.back, NORTH_X, undefined);
  across(NORTH.front, NORTH_X, north);
  between(NORTH_X, NORTH.back, NORTH.inside);
  across(SOUTH.front, SOUTH_X, south);
  across(SOUTH.back, SOUTH_X, undefined);
  between(SOUTH_X, SOUTH.front, SOUTH.inside);
  const room = (x0: number, z0: number, z1: number, name: string) => {
    const cx = x0 + ROOM_W / 2, cz = (z0 + z1) / 2;
    add('project-room', cx, cz, 0, { text: name, w: ROOM_W - 0.25, d: Math.floor((z1 - z0 - 0.2) * 4) / 4 });
    add('conference-table', cx, cz, 0);
  };
  NORTH_X.forEach((x0, i) => room(x0, NORTH.back, NORTH.front, north[i]));
  SOUTH_X.forEach((x0, i) => room(x0, SOUTH.front, SOUTH.back, south[i]));
  return pieces;
}
