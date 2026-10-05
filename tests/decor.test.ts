// Where the pictures people hang with F can go (shared/decor.ts): it follows the floor's room, since an
// upstairs cuts the walls it meets in two. And the server's list of them (server/decor.ts), which hangs
// them again when a floor's structure changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Decor } from '../src/server/decor.js';
import { clampToWall, frameRect, sanitizePlacement, wallFloor, wallTop, zonesFor, type DecorPlacement, type Decoration } from '../src/shared/decor.js';
import { ROOM_DEFAULTS, type RoomOptions } from '../src/shared/floorplan.js';
import { DECK_Y, HEADROOM } from '../src/shared/mezzanine.js';

const NONE = { mezzanine: 'none' } as const;
const BIG = { mezzanine: 'big' } as const;
const CEILING = 6.8;

/** Friday Labs' four portraits, as its decor.json has them: on the loft's south wall. */
const PORTRAITS: DecorPlacement[] = [
  ['napoleon.jpg', 'Napoleon Bonaparte', 15.7],
  ['alexander.jpg', 'Alexander the Great', 16.95],
  ['steve-jobs.jpg', 'Steve Jobs', 13.2],
  ['jfk.jpg', 'John F. Kennedy', 14.45],
].map(([file, title, u]) => ({ url: `media:friday-labs/${file}`, title: title as string, wall: 'south', u: u as number, y: 4.5, w: 0.9, h: 1.2, frame: 3 }));

const portrait = (wall: DecorPlacement['wall'], u: number, y: number, more: Partial<DecorPlacement> = {}): DecorPlacement => ({ url: 'https://example.com/a.png', wall, u, y, w: 0.9, h: 1.2, frame: 0, ...more });
const hung = (p: DecorPlacement, room?: RoomOptions): DecorPlacement => {
  const out = sanitizePlacement(p, room);
  assert.ok(typeof out !== 'string', String(out));
  return out;
};

function withDir(fn: (dir: string) => void) {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-decor-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Runs `fn` with console.warn collected instead of printed. */
function warnings(fn: () => void): string[] {
  const was = console.warn;
  const said: string[] = [];
  console.warn = (...a: unknown[]) => void said.push(a.join(' '));
  try {
    fn();
  } finally {
    console.warn = was;
  }
  return said;
}

test('with the loft in its corner the walls are as they always were', () => {
  const zones = zonesFor();
  assert.deepEqual(zones.north, [{ u0: -18, u1: 18, y0: 0, y1: CEILING }]);
  assert.deepEqual(zones.west, [{ u0: -13, u1: 13, y0: 0, y1: CEILING }]);
  // The south and east walls run on under the loft's floor, stand full height beside it, and go on up inside it to its roof.
  assert.deepEqual(zones.south, [
    { u0: -18, u1: 18, y0: 0, y1: 2.75 },
    { u0: -18, u1: 9, y0: 0, y1: CEILING },
    { u0: 9, u1: 18, y0: 3, y1: 5.8 },
  ]);
  assert.deepEqual(zones.east, [
    { u0: -13, u1: 13, y0: 0, y1: 2.75 },
    { u0: -13, u1: 8, y0: 0, y1: CEILING },
    { u0: 8, u1: 13, y0: 3, y1: 5.8 },
  ]);
  // A room that says nothing of its upstairs, the office's own, and one whose loft is an empty room: the same walls.
  for (const room of [{}, { tees: 2 }, ROOM_DEFAULTS, { mezzanine: 'corner' }, { boss: false }] as RoomOptions[]) assert.equal(zonesFor(room), zones, JSON.stringify(room));
  assert.equal(HEADROOM, 2.75);
  assert.equal(DECK_Y, 3);
});

test('a floor that is all one level has every wall to the ceiling', () => {
  const zones = zonesFor(NONE);
  assert.deepEqual(zones.north, [{ u0: -18, u1: 18, y0: 0, y1: CEILING }]);
  assert.deepEqual(zones.south, [{ u0: -18, u1: 18, y0: 0, y1: CEILING }]);
  assert.deepEqual(zones.east, [{ u0: -13, u1: 13, y0: 0, y1: CEILING }]);
  assert.deepEqual(zones.west, [{ u0: -13, u1: 13, y0: 0, y1: CEILING }]);
  // A floor saved before a room could say 'none' said it had no loft.
  assert.equal(zonesFor({ loft: false }), zones);
  // The high wall over the meeting room, which the loft used to hide.
  assert.deepEqual(hung(portrait('south', 14, 6), NONE), portrait('south', 14, 6));
  // With the loft there it has a roof at 5.8: the same picture comes down under it.
  assert.equal(hung(portrait('south', 14, 6)).y, 5.08);
  assert.equal(hung(portrait('south', 14, 6), ROOM_DEFAULTS).y, 5.08);
  // And where the loft's floor was, a picture hangs across it.
  assert.deepEqual(hung(portrait('east', 10, 2.9), NONE), portrait('east', 10, 2.9));
});

test('the big mezzanine cuts the south wall, and the south end of the east and west ones, in two', () => {
  const zones = zonesFor(BIG);
  assert.deepEqual(zones.north, [{ u0: -18, u1: 18, y0: 0, y1: CEILING }]);
  assert.deepEqual(zones.south, [
    { u0: -18, u1: 18, y0: 0, y1: 2.75 },
    { u0: -18, u1: 18, y0: 3, y1: CEILING },
  ]);
  for (const wall of ['east', 'west'] as const) {
    assert.deepEqual(zones[wall], [
      { u0: -13, u1: 13, y0: 0, y1: 2.75 },
      { u0: -13, u1: 5.2, y0: 0, y1: CEILING },
      { u0: 5.2, u1: 13, y0: 3, y1: CEILING },
    ]);
  }
  // A picture across the slab slides the least it takes: under it, or up onto the mezzanine's wall.
  const clear = (p: DecorPlacement) => {
    const r = frameRect(hung(p, BIG));
    assert.ok(r.y1 <= HEADROOM || r.y0 >= DECK_Y, JSON.stringify(r));
    return hung(p, BIG);
  };
  assert.equal(clear(portrait('south', 0, 2.9)).y, 2.03);
  assert.equal(clear(portrait('south', 0, 3.4)).y, 4.07);
  assert.equal(clear(portrait('west', 9, 2.9)).y, 2.03);
  assert.equal(clear(portrait('east', 9, 3.2)).y, 4.07);
  // It stays where it is along the wall.
  assert.equal(clear(portrait('south', -12.5, 2.9)).u, -12.5);
  // North of the deck the side walls are whole.
  assert.deepEqual(hung(portrait('east', 0, 2.9), BIG), portrait('east', 0, 2.9));
  assert.deepEqual(hung(portrait('west', -6, 2.9), BIG), portrait('west', -6, 2.9));
  // One that straddles the deck's north edge at slab height goes whichever way is nearer: along the wall, clear of the deck.
  const edge = hung(portrait('east', 5, 2.9), BIG);
  assert.ok(Math.abs(edge.u - 4.53) < 1e-9 && edge.y === 2.9, JSON.stringify(edge));
  // Up there the wall goes to the ceiling, where the loft has a roof.
  assert.deepEqual(hung(portrait('south', 14, 6), BIG), portrait('south', 14, 6));
  // A picture taller than the wall above the slab, and than the one below it, has nowhere on the south wall.
  const tall = portrait('south', 0, 3, { w: 1.7, h: 3.4 });
  assert.equal(sanitizePlacement(tall, BIG), 'That picture is too big for the wall');
  assert.equal(clampToWall('south', 0, 3, 1.7, 3.4, BIG), null);
  assert.ok(typeof sanitizePlacement(tall) !== 'string');
  assert.ok(typeof sanitizePlacement({ ...tall, wall: 'north' }, BIG) !== 'string');
});

test("Friday Labs' portraits in the loft stay where they hang, whatever the floor's upstairs", () => {
  for (const room of [undefined, {}, ROOM_DEFAULTS, BIG, NONE] as (RoomOptions | undefined)[]) {
    for (const p of PORTRAITS) assert.deepEqual(hung(p, room), p, `${p.title} on ${JSON.stringify(room)}`);
  }
});

test('how high a wall goes, and which floor a picture is looked at from', () => {
  // Inside the loft the wall stops at its roof; everywhere else at the ceiling.
  assert.equal(wallTop('south', 14), 5.8);
  assert.equal(wallTop('south', 0), CEILING);
  assert.equal(wallTop('east', 10), 5.8);
  assert.equal(wallTop('south', 14, NONE), CEILING);
  assert.equal(wallTop('south', 14, BIG), CEILING);
  assert.equal(wallTop('west', 9, BIG), CEILING);
  // What hangs over an upstairs is looked at from up there; under it, or beside it, from the office floor.
  assert.equal(wallFloor('south', 14, 4.5), 3);
  assert.equal(wallFloor('south', 14, 1.5), 0);
  assert.equal(wallFloor('south', 0, 4.5), 0);
  assert.equal(wallFloor('east', 10, 4.5, { boss: false }), 3);
  assert.equal(wallFloor('south', 14, 4.5, NONE), 0);
  assert.equal(wallFloor('south', -10, 4.5, BIG), 3);
  assert.equal(wallFloor('west', 9, 4.5, BIG), 3);
  assert.equal(wallFloor('west', 9, 1.5, BIG), 0);
  assert.equal(wallFloor('west', 0, 4.5, BIG), 0);
  assert.equal(wallFloor('north', 0, 4.5, BIG), 0);
});

test("the floor's pictures are hung again when its structure changes", () => {
  withDir((dir) => {
    let room: RoomOptions = {};
    const decor = new Decor(dir, () => room);
    const loft = decor.add(PORTRAITS[0], 'Ada');
    const low = decor.add(portrait('south', 0, 2.9, { title: 'Low' }), 'Ada');
    const north = decor.add(portrait('north', 0, 2.9), 'Bo');
    const high = decor.add(portrait('east', 0, 5), 'Bo');
    assert.ok(typeof loft !== 'string' && typeof low !== 'string' && typeof north !== 'string' && typeof high !== 'string');
    // Beside the loft the south wall is whole, so a picture hangs across where a mezzanine's slab would be.
    assert.equal(low.y, 2.9);
    // Nothing has changed: nothing moves, and nobody needs telling.
    assert.equal(decor.refit(), false);

    // The big mezzanine comes: the one across its slab slides under it, the rest stay.
    room = BIG;
    assert.equal(decor.refit(), true);
    const after = (id: string) => decor.list().find((d) => d.id === id)!;
    assert.equal(after(low.id).y, 2.03);
    assert.deepEqual({ ...after(low.id), y: 2.9 }, low, 'only its height changed: it keeps its id, who hung it and when');
    assert.deepEqual(after(loft.id), loft);
    assert.deepEqual(after(north.id), north);
    assert.deepEqual(after(high.id), high);
    assert.deepEqual(
      decor.list().map((d) => d.id),
      [loft.id, low.id, north.id, high.id],
    );
    // It's saved, and a second go has nothing left to move.
    assert.equal((JSON.parse(readFileSync(path.join(dir, 'decor.json'), 'utf8')) as Decoration[]).find((d) => d.id === low.id)!.y, 2.03);
    assert.equal(decor.refit(), false);

    // New pictures and moved ones go by the room too.
    const across = decor.add(portrait('west', 9, 2.9), 'Cy');
    assert.ok(typeof across !== 'string' && across.y === 2.03);
    const moved = decor.update(north.id, { wall: 'south', u: 5, y: 3.4 });
    assert.ok(typeof moved !== 'string' && moved.y === 4.07);

    // All one level: every wall is whole again, and nothing has to move back.
    room = NONE;
    assert.equal(decor.refit(), false);
    const mid = decor.add(portrait('south', -8, 2.9), 'Cy');
    assert.ok(typeof mid !== 'string' && mid.y === 2.9);

    // The loft back: its roof is lower than the ceiling, so the portrait up at 6 comes down under it.
    const top = decor.add(portrait('south', 14, 6, { title: 'Top' }), 'Cy');
    assert.ok(typeof top !== 'string' && top.y === 6);
    room = { mezzanine: 'corner' };
    assert.equal(decor.refit(), true);
    assert.equal(after(top.id).y, 5.08);
    // The one hung at 2.9 beside the loft is on a whole stretch of wall there, and stays.
    assert.equal(after(mid.id).y, 2.9);
  });
});

test('a picture too big for its wall once a mezzanine is there comes down, and the office says so', () => {
  withDir((dir) => {
    let room: RoomOptions = NONE;
    const decor = new Decor(dir, () => room);
    const tall = decor.add(portrait('south', 0, 3.4, { w: 1.7, h: 3.4, title: 'Tall' }), 'Ada');
    const small = decor.add(portrait('south', 6, 1.5), 'Ada');
    assert.ok(typeof tall !== 'string' && typeof small !== 'string');
    room = BIG;
    let changed = false;
    const said = warnings(() => (changed = decor.refit()));
    assert.equal(changed, true);
    assert.deepEqual(decor.list(), [small]);
    assert.equal(said.length, 1);
    assert.match(said[0], /took down "Tall" \(https:\/\/example\.com\/a\.png, hung by Ada\): the south wall has no room for it now/);
    assert.deepEqual(JSON.parse(readFileSync(path.join(dir, 'decor.json'), 'utf8')), [small]);
    // It can't be hung there again, and the reason is the usual one.
    assert.equal(decor.add(portrait('south', 0, 3.4, { w: 1.7, h: 3.4 }), 'Ada'), 'That picture is too big for the wall');
  });
});

test("pictures read back from disk go by the floor's room, and by the office's own with none given", () => {
  withDir((dir) => {
    const saved: Decoration[] = [
      { ...portrait('south', 0, 2.9), id: 'a1', by: 'Ada', at: 1 },
      { ...PORTRAITS[2], id: 'b2', by: 'Bo', at: 2 },
    ];
    writeFileSync(path.join(dir, 'decor.json'), JSON.stringify(saved));
    // As before: no room is the office as it comes.
    assert.deepEqual(new Decor(dir).list(), saved);
    assert.deepEqual(new Decor(dir, () => ({ tees: 2 })).list(), saved);
    // On a floor that has the big mezzanine by now, the first is under its slab from the start.
    const big = new Decor(dir, () => BIG);
    assert.deepEqual(big.list(), [{ ...saved[0], y: 2.03 }, saved[1]]);
    assert.equal(big.refit(), false);
  });
});
