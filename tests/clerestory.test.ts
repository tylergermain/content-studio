// The upper windows (shared/clerestory.ts): twelve of them in WINDOWS, each clear of what hangs on its
// wall or stands against it, and on a wall either straight over another window or beside it, never
// half across one, so the walls and the tower can be built round them a column at a time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CLERESTORY, columnsOf } from '../src/shared/clerestory.js';
import { MAX_FLOORS } from '../src/shared/floors.js';
import { BALCONY_DOOR, BOARDS, ELEVATOR, EXIT_DOOR, FLOOR, LADDER, LOFT, STOREY, TV, WALL_HEIGHT, WINDOWS, WING, type Opening, type Side } from '../src/shared/layout.js';
import { TOWER } from '../src/client/world/facade.js';

/** A rectangle of wall: `u` along it, `y` up from the floor. */
interface Rect {
  u0: number;
  u1: number;
  y0: number;
  y1: number;
}
const hole = (o: Opening): Rect => ({ u0: o.u - o.width / 2, u1: o.u + o.width / 2, y0: o.y0, y1: o.y1 });
const apart = (a0: number, a1: number, b0: number, b1: number) => a1 <= b0 + 1e-9 || b1 <= a0 + 1e-9;
const meets = (a: Rect, b: Rect) => !apart(a.u0, a.u1, b.u0, b.u1) && !apart(a.y0, a.y1, b.y0, b.y1);
const SIDES: Side[] = ['north', 'south', 'east', 'west'];

/** A board's label hangs half a metre over it, a textPlane 64 px high (1.6 lines) at 0.0055 m a pixel, made 1.3 times bigger (room.ts). */
const LABEL = Math.ceil(64 * 1.6) * 0.0055 * 1.3;

/** What hangs on a wall or stands against it that an upper window mustn't meet, as a rectangle on its wall. */
const TAKEN: { what: string; wall: Side; at: Rect }[] = [
  { what: 'the exit door', wall: EXIT_DOOR.wall, at: hole(EXIT_DOOR) },
  { what: 'the balcony doors', wall: BALCONY_DOOR.wall, at: hole(BALCONY_DOOR) },
  ...Object.entries(BOARDS).map(([key, b]) => {
    const wall: Side = b.rotY === 0 ? 'north' : 'east';
    const u = wall === 'north' ? b.x : b.z;
    return { what: `the ${key} board and its label`, wall, at: { u0: u - b.width / 2 - 0.15, u1: u + b.width / 2 + 0.15, y0: b.y - b.height / 2 - 0.15, y1: b.y + b.height / 2 + 0.5 + LABEL / 2 } };
  }),
  { what: 'the TV', wall: 'east', at: { u0: TV.z - TV.width / 2 - 0.15, u1: TV.z + TV.width / 2 + 0.15, y0: TV.y - TV.height / 2 - 0.15, y1: TV.y + TV.height / 2 + 0.15 } },
  // The loft, and the boss's office on it, against the south and east walls, all the way up.
  { what: 'the loft', wall: 'south', at: { u0: LOFT.minX, u1: LOFT.maxX, y0: 0, y1: WALL_HEIGHT } },
  { what: 'the loft', wall: 'east', at: { u0: LOFT.minZ, u1: LOFT.maxZ, y0: 0, y1: WALL_HEIGHT } },
  // Friday Labs' four portraits along the south wall over the loft, centred 13.2 to 16.95 along it and
  // 4.5 m up, 0.9 by 1.2 in their frames.
  { what: "Friday Labs' portraits", wall: 'south', at: { u0: 13.2 - 0.55, u1: 16.95 + 0.55, y0: 4.5 - 0.7, y1: 4.5 + 0.7 } },
  // The ladder up the west wall, and the lift's shaft in the north one, floor to ceiling.
  { what: 'the ladder', wall: 'west', at: { u0: LADDER.z - LADDER.width / 2, u1: LADDER.z + LADDER.width / 2, y0: 0, y1: WALL_HEIGHT } },
  { what: 'the lift', wall: 'north', at: { u0: ELEVATOR.x - ELEVATOR.width / 2, u1: ELEVATOR.x + ELEVATOR.width / 2, y0: 0, y1: WALL_HEIGHT } },
];

test('twelve upper windows, three to a wall, all of them in WINDOWS', () => {
  assert.equal(CLERESTORY.length, 12);
  for (const side of SIDES) assert.equal(CLERESTORY.filter((o) => o.wall === side).length, 3, side);
  for (const o of CLERESTORY) assert.ok(WINDOWS.includes(o), `the ${o.wall} window at ${o.u} is in WINDOWS`);
});

test('the upper windows are in their walls, under the ceiling, and the north ones short of the back office', () => {
  for (const o of CLERESTORY) {
    const h = hole(o);
    const [min, max] = o.wall === 'north' ? [FLOOR.minX, WING.minX] : o.wall === 'south' ? [FLOOR.minX, FLOOR.maxX] : [FLOOR.minZ, FLOOR.maxZ];
    assert.ok(h.u0 >= min && h.u1 <= max, `the ${o.wall} window at ${o.u} is along its wall`);
    assert.ok(o.y0 >= 4 && o.y1 <= WALL_HEIGHT - 0.5, `the ${o.wall} window at ${o.u} is high, with wall over it`);
  }
});

test('on every wall, two windows share a span exactly or are clear of each other, and stacked ones are clear in height', () => {
  for (const side of SIDES) {
    const mine = WINDOWS.filter((o) => o.wall === side);
    mine.forEach((a, i) =>
      mine.slice(i + 1).forEach((b) => {
        const same = Math.abs(a.u - b.u) < 1e-9 && Math.abs(a.width - b.width) < 1e-9;
        if (!same) assert.ok(apart(hole(a).u0, hole(a).u1, hole(b).u0, hole(b).u1), `${side}: the windows at ${a.u} and ${b.u} half overlap`);
        else assert.ok(apart(a.y0, a.y1, b.y0, b.y1), `${side}: the windows at ${a.u} overlap one over the other`);
      }),
    );
  }
});

test('the south and west walls have a column of two at each low window, from the bottom up', () => {
  for (const side of ['south', 'west'] as const) {
    const twos = columnsOf(WINDOWS.filter((o) => o.wall === side)).filter((c) => c.holes.length === 2);
    assert.equal(twos.length, 3, side);
    for (const c of twos) {
      assert.ok(c.holes[0].y1 < c.holes[1].y0, `${side}: the low one first, at ${c.u0}`);
      assert.equal(c.holes[1].y0, 4, `${side}: the upper one's sill`);
    }
  }
  // North and east, each window is a column of its own.
  for (const side of ['north', 'east'] as const) assert.ok(columnsOf(WINDOWS.filter((o) => o.wall === side)).every((c) => c.holes.length === 1), side);
});

test('no upper window meets a door, a board or its label, the TV, the loft, the portraits, the ladder or the lift', () => {
  for (const o of CLERESTORY) {
    for (const t of TAKEN) if (t.wall === o.wall) assert.ok(!meets(hole(o), t.at), `the ${o.wall} window at ${o.u} meets ${t.what}`);
  }
});

test('the tower stays within the floors the server lets anyone arrive on', () => {
  assert.ok(TOWER.storeys <= MAX_FLOORS - 1, `${TOWER.storeys} storeys`);
  // Its bars go up it in order, the last one to the top, and each storey of them is a whole storey.
  TOWER.bars.forEach((bar, i) => assert.equal(bar.from, i ? TOWER.bars[i - 1].to : bar.from));
  assert.equal(TOWER.bars[TOWER.bars.length - 1].to, TOWER.storeys);
  assert.ok(Math.abs(2 * (TOWER.glass + TOWER.spandrel) - STOREY) < 1e-9, 'two glass bands and two spandrels make a storey');
});
