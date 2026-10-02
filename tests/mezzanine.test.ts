// A floor's upstairs (shared/mezzanine.ts) and the rest of its room (RoomOptions in shared/floorplan.ts):
// how the options are read and kept, what each structure builds into the floor, and the big mezzanine's
// own numbers, which have to miss everything the office comes with.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Building } from '../src/server/building.js';
import { PANEL_SIDES, ROOM_DEFAULTS, cleanPlan, cleanRoom, roomOf, type RoomOptions } from '../src/shared/floorplan.js';
import { FLOOR_PALETTES, STOCK_PALETTES, floorPalette } from '../src/shared/floors.js';
import { DEFAULT_FURNITURE, type Piece } from '../src/shared/furniture.js';
import { BEANBAGS, DESKS, LOFT, MEETING_SEATS, SPAWN } from '../src/shared/layout.js';
import { BIG, BIG_FLIGHTS, BIG_POSTS, DECK_SLAB, DECK_Y, HEADROOM, POST_R, deckOf, deckSolids, hasBoss, hasKitchen, levelY, mezzanineOf, onDeck, structureKey } from '../src/shared/mezzanine.js';
import { deskPoint, officeNav, setOfficeRoom, walkable, wayIn } from '../src/shared/nav.js';
import { layoutProblems } from '../src/shared/office-builder.js';
import { FIXED, KEEP_CLEAR, fixedIn, hasLoft, keepClearIn, keepClearUp } from '../src/shared/office-fixed.js';

const BIG_ROOM = { mezzanine: 'big' } as const;
const defaults = (): Piece[] => DEFAULT_FURNITURE.map((p) => ({ ...p }));
const names = (room?: RoomOptions) => [...fixedIn(room).rects, ...fixedIn(room).circles, ...keepClearIn(room)].map((f) => f.what);
const count = (list: string[], what: string) => list.filter((w) => w === what).length;

test('a room keeps only what is valid and is not the default, in one order', () => {
  // A floor from before there were three kinds said `loft: false`: it reads as none, and is never written again.
  assert.deepEqual(cleanRoom({ loft: false }), { mezzanine: 'none' });
  assert.deepEqual(cleanRoom({ loft: true }), {});
  assert.deepEqual(cleanRoom({ mezzanine: 'corner' }), {});
  assert.deepEqual(cleanRoom({ mezzanine: 'big', loft: false }), { mezzanine: 'big' }, 'what it says for a mezzanine wins');
  assert.deepEqual(cleanRoom({ mezzanine: 'corner', loft: false }), {});
  assert.deepEqual(cleanRoom({ mezzanine: 'attic' }), {});
  // The boss's office is the corner loft's to leave out.
  assert.deepEqual(cleanRoom({ boss: false }), { boss: false });
  assert.deepEqual(cleanRoom({ mezzanine: 'big', boss: false }), { mezzanine: 'big' });
  assert.deepEqual(cleanRoom({ mezzanine: 'none', boss: false }), { mezzanine: 'none' });
  assert.deepEqual(cleanRoom({ boss: true, kitchen: true }), {});
  assert.deepEqual(cleanRoom({ kitchen: false }), { kitchen: false });
  // Wood walls come back in PANEL_SIDES' order, each once, with whatever isn't a side dropped.
  assert.deepEqual(PANEL_SIDES, ['north', 'east', 'south', 'west']);
  assert.deepEqual(cleanRoom({ panels: ['west', 'up', 'north', 'west', 7] }), { panels: ['north', 'west'] });
  assert.deepEqual(cleanRoom({ panels: [] }), {});
  assert.deepEqual(cleanRoom({ panels: 'north' }), {});
  assert.deepEqual(cleanRoom({ wood: 'walnut' }), { wood: 'walnut' });
  assert.deepEqual(cleanRoom({ wood: 'oak' }), {});
  assert.deepEqual(cleanRoom({ wood: 'cherry' }), {});
  // Whatever order it came in, it's kept in the one order.
  const all = cleanRoom({ wood: 'walnut', panels: ['south'], kitchen: false, mezzanine: 'big', tees: 2, extra: true });
  assert.equal(JSON.stringify(all), JSON.stringify({ tees: 2, mezzanine: 'big', kitchen: false, panels: ['south'], wood: 'walnut' }));
  assert.equal(JSON.stringify(cleanRoom({ boss: false, tees: 2 })), JSON.stringify({ tees: 2, boss: false }));
});

test('a room worked out in full says every fitting, the office as it comes when the floor says nothing', () => {
  assert.deepEqual(roomOf(undefined), ROOM_DEFAULTS);
  assert.deepEqual(roomOf({}), ROOM_DEFAULTS);
  assert.deepEqual(roomOf({ room: { tees: 2 } }), { ...ROOM_DEFAULTS, tees: 2 });
  assert.equal(JSON.stringify(roomOf({ room: { loft: false } })), JSON.stringify({ tees: 1, mezzanine: 'none', boss: false, kitchen: true, panels: [], wood: 'oak' }));
  assert.deepEqual(roomOf({ room: { mezzanine: 'big', kitchen: false, panels: ['south'], wood: 'walnut' } }), { tees: 1, mezzanine: 'big', boss: false, kitchen: false, panels: ['south'], wood: 'walnut' });
  assert.deepEqual(roomOf({ room: { boss: false } }), { ...ROOM_DEFAULTS, boss: false });
  // A room in full is a room to ask about: it reads the same as the options it came from.
  for (const room of [{}, { loft: false }, { boss: false }, BIG_ROOM, { mezzanine: 'big', kitchen: false } as const]) assert.equal(structureKey(roomOf({ room })), structureKey(room));

  assert.deepEqual([mezzanineOf(), mezzanineOf({}), mezzanineOf({ loft: true }), mezzanineOf({ loft: false }), mezzanineOf(BIG_ROOM)], ['corner', 'corner', 'corner', 'none', 'big']);
  assert.ok(hasBoss() && hasBoss({}) && hasBoss(ROOM_DEFAULTS) && hasBoss({ loft: true }));
  for (const room of [{ mezzanine: 'none' }, BIG_ROOM, { boss: false }, { loft: false }] as RoomOptions[]) assert.equal(hasBoss(room), false, JSON.stringify(room));
  assert.ok(hasKitchen() && hasKitchen(BIG_ROOM) && !hasKitchen({ kitchen: false }));
  assert.ok(hasLoft() && hasLoft({ boss: false }) && !hasLoft(BIG_ROOM) && !hasLoft({ mezzanine: 'none' }));
  // What changes the floor to get round, and nothing else.
  assert.equal(structureKey(), 'corner|b|k');
  assert.equal(structureKey({ tees: 2, panels: ['north'], wood: 'walnut' }), structureKey());
  assert.equal(new Set([structureKey(), structureKey({ boss: false }), structureKey({ kitchen: false }), structureKey(BIG_ROOM), structureKey({ loft: false })]).size, 5);
  assert.deepEqual([levelY(), levelY(0), levelY(1)], [0, 0, DECK_Y]);
});

test("what's built in goes by the room's structure: the kitchen, and each upstairs' own stairs and posts", () => {
  assert.equal(fixedIn({ tees: 2 }), FIXED);
  assert.equal(fixedIn({ panels: ['north'], wood: 'walnut' }), FIXED);
  assert.equal(keepClearIn({ mezzanine: 'corner' }), KEEP_CLEAR);
  assert.equal(fixedIn({ loft: false }), fixedIn({ mezzanine: 'none' }));
  // An empty loft still stands on its posts, with its stairs.
  assert.deepEqual(names({ boss: false }), names());

  // No kitchen: its counter and the floor in front of it go, and nothing else.
  const gone = new Set(['the kitchen', 'the kitchen counter']);
  assert.ok(names().includes('the kitchen') && names().includes('the kitchen counter'));
  assert.deepEqual(names({ kitchen: false }), names().filter((w) => !gone.has(w)));

  // The big mezzanine: its own stairs and seven posts, and none of the loft's.
  const big = names(BIG_ROOM);
  assert.equal(count(big, 'the stairs'), 1);
  assert.equal(count(big, 'the foot of the stairs'), 1);
  assert.equal(count(big, "one of the mezzanine's posts"), 7);
  assert.equal(count(big, "one of the loft's posts"), 0);
  assert.equal(count(names(), "one of the loft's posts"), 2);
  const rest = new Set(['the stairs', 'the foot of the stairs', "one of the mezzanine's posts", "one of the loft's posts"]);
  assert.deepEqual(big.filter((w) => !rest.has(w)), names().filter((w) => !rest.has(w)), 'everything else is where it was');
  assert.deepEqual(fixedIn(BIG_ROOM).rects.find((f) => f.what === 'the stairs')?.rect, [3.8, 5.8, -0.8, 5.2]);
  assert.deepEqual(keepClearIn(BIG_ROOM).find((f) => f.what === 'the foot of the stairs')?.rect, [3.9, 5.7, -2, -0.8]);
  assert.deepEqual(fixedIn(BIG_ROOM).circles.filter((f) => f.what.includes('mezzanine')).map((f) => f.circle), BIG_POSTS.map(([x, z]) => [x, z, POST_R]));

  // Upstairs, the top of each flight is kept clear.
  assert.deepEqual(keepClearUp({ mezzanine: 'none' }), []);
  assert.deepEqual(keepClearUp(BIG_ROOM), [{ rect: [3.9, 5.7, 5.2, 6.5], what: 'the top of the stairs' }]);
  assert.deepEqual(keepClearUp({ boss: false }), [{ rect: [LOFT.minX + 0.12, 10.3, 11.2, 13], what: 'the top of the stairs' }]);
});

test('a deck is its slab, the floor to furnish, its flights of stairs and its posts', () => {
  assert.equal(deckOf({ mezzanine: 'none' }), undefined);
  assert.equal(deckOf({ loft: false }), undefined);

  const corner = deckOf()!;
  assert.equal(corner, deckOf(ROOM_DEFAULTS));
  assert.deepEqual([corner.kind, corner.height, corner.floor], ['corner', 2.8, undefined], "nothing's stood up there while the boss's office has it");
  assert.deepEqual(corner.slab, { minX: 9, maxX: 18, minZ: 8, maxZ: 13 });
  assert.deepEqual(corner.posts, [[LOFT.minX + 0.15, LOFT.minZ + 0.15], [13.5, LOFT.minZ + 0.15]]);
  assert.equal(corner.flights.length, 1);
  assert.deepEqual(corner.flights[0], {
    rect: { minX: 3, maxX: 9, minZ: 11.2 - 0.1, maxZ: 13 },
    foot: { minX: 3 - 1.2, maxX: 3, minZ: 11.2, maxZ: 13 },
    top: { minX: 9.12, maxX: 10.3, minZ: 11.2, maxZ: 13 },
    footAt: { x: 2.4, z: 12.1 },
    topAt: { x: 9.6, z: 12.1 },
  });
  const empty = deckOf({ boss: false })!;
  assert.deepEqual(empty.floor, { minX: 9.12, maxX: 18, minZ: 8.12, maxZ: 13 });
  assert.deepEqual({ ...empty, floor: undefined }, { ...corner, floor: undefined });

  const big = deckOf(BIG_ROOM)!;
  assert.deepEqual([big.kind, big.slab, big.posts], ['big', BIG, BIG_POSTS]);
  assert.deepEqual(BIG, { minX: -18, maxX: 18, minZ: 5.2, maxZ: 13 });
  assert.ok(Math.abs(big.height - 3.8) < 1e-9);
  assert.ok(Math.abs(big.floor!.minZ - 5.3) < 1e-9 && big.floor!.maxZ === 13 && big.floor!.minX === -18 && big.floor!.maxX === 18);
  assert.deepEqual(BIG_FLIGHTS, [{ minX: 3.9, maxX: 5.7, fromZ: -0.8, toZ: 5.2, steps: 15 }]);
  assert.equal(big.flights.length, BIG_FLIGHTS.length);
  const f = big.flights[0];
  const near = (a: object, b: object) => Object.entries(b).every(([k, v]) => Math.abs((a as Record<string, number>)[k] - v) < 1e-9);
  assert.ok(near(f.rect, { minX: 3.8, maxX: 5.8, minZ: -0.8, maxZ: 5.2 }), JSON.stringify(f.rect));
  assert.ok(near(f.foot, { minX: 3.9, maxX: 5.7, minZ: -2, maxZ: -0.8 }), JSON.stringify(f.foot));
  assert.ok(near(f.top, { minX: 3.9, maxX: 5.7, minZ: 5.2, maxZ: 6.5 }), JSON.stringify(f.top));
  assert.ok(near(f.footAt, { x: 4.8, z: -1.4 }) && near(f.topAt, { x: 4.8, z: 5.8 }), JSON.stringify([f.footAt, f.topAt]));
  assert.deepEqual(BIG_POSTS.map(([x]) => x), [-15.5, -10.6, -4.9, 0.2, 3.6, 8.6, 14.4]);
  assert.ok(BIG_POSTS.every(([, z]) => z === 6.9));

  // Over a deck, or under it.
  assert.ok(onDeck(BIG_ROOM, 0, 9) && onDeck(BIG_ROOM, -17, 12) && !onDeck(BIG_ROOM, 0, 5) && !onDeck(BIG_ROOM, 0, 5.4, 0.5));
  assert.ok(onDeck({}, 14, 10) && !onDeck({}, 0, 9) && !onDeck({ mezzanine: 'none' }, 14, 10));
});

test("what you bump into of the big mezzanine: its slab, seven posts, the steps and their fences, and the rail", () => {
  assert.deepEqual([DECK_Y, DECK_SLAB, HEADROOM], [3, 0.25, 2.75]);
  const solids = deckSolids();
  assert.equal(solids.length, 27);
  assert.deepEqual(solids[0], { ...BIG, bottom: 2.75, top: 3 });
  const posts = solids.filter((s) => s.top === HEADROOM && s.bottom === undefined);
  assert.equal(posts.length, 7);
  assert.ok(posts.every((s) => Math.abs(s.maxX - s.minX - 2 * POST_R) < 1e-9));
  // Fifteen steps, each 0.4 deep and 0.2 higher, solid from the floor up.
  const steps = solids.filter((s) => s.bottom === undefined && s.top > 0 && s.top <= DECK_Y + 1e-9 && s.minX === 3.9 && s.maxX === 5.7);
  assert.equal(steps.length, 15);
  steps.forEach((s, i) => assert.ok(Math.abs(s.top - (i + 1) * 0.2) < 1e-9 && Math.abs(s.minZ - (-0.8 + i * 0.4)) < 1e-9 && Math.abs(s.maxZ - s.minZ - 0.4) < 1e-9, JSON.stringify(s)));
  assert.ok(Math.abs(steps[14].top - DECK_Y) < 1e-9 && Math.abs(steps[14].maxZ - BIG.minZ) < 1e-9, 'the last step is the deck');
  const fences = solids.filter((s) => s.top === 99 && s.bottom === undefined);
  assert.deepEqual(fences.map((s) => [Math.round(s.minX * 10) / 10, Math.round(s.maxX * 10) / 10, s.minZ, s.maxZ]), [[3.8, 3.9, -0.8, 5.2], [5.7, 5.8, -0.8, 5.2]]);
  // The rail runs along the open edge up on the deck (nobody under it meets it), with a gap where the stairs arrive.
  const rails = solids.filter((s) => s.top === 99 && s.bottom === DECK_Y);
  assert.deepEqual(rails.map((s) => [s.minX, s.maxX]), [[-18, 3.9], [5.7, 18]]);
  assert.ok(rails.every((s) => s.minZ === BIG.minZ && Math.abs(s.maxZ - 5.3) < 1e-9));
});

test('the big mezzanine misses everything the office comes with, but the hoop', () => {
  // Its stairs, their foot and its posts stand on no default desk, chair, plant, kiosk, pole or doorway: if one is ever moved onto one, this says so.
  assert.deepEqual([...layoutProblems({ desks: {}, furniture: defaults() }, BIG_ROOM)], [['hoop', 'Basketball hoop hangs too high to go under the mezzanine']]);
  assert.equal(layoutProblems({ desks: {}, furniture: defaults() }, { ...BIG_ROOM, kitchen: false }).size, 1);
  assert.equal(layoutProblems({ desks: {}, furniture: defaults().filter((p) => p.id !== 'hoop') }, BIG_ROOM).size, 0);
});

test('getting round a floor with the big mezzanine: under the deck, round its stairs and posts', () => {
  const nav = officeNav(0, undefined, DEFAULT_FURNITURE, BIG_ROOM);
  assert.equal(nav.walkable(0, 9), true, 'under the deck');
  assert.equal(nav.walkable(SPAWN.x, SPAWN.z), true, 'where you arrive');
  assert.equal(nav.walkable(4.8, 2), false, 'on the stairs');
  assert.equal(nav.walkable(8.6, 6.9), false, 'on a post');
  // Where the loft's stairs stood is floor.
  assert.equal(nav.walkable(6, 12.1), true);
  assert.equal(officeNav(0, undefined, DEFAULT_FURNITURE).walkable(6, 12.1), false);

  // A worker walks to beside its chair, either side of it: the stairs and the posts are on none of those spots.
  const flat = officeNav(0, undefined, DEFAULT_FURNITURE, { mezzanine: 'none' });
  for (const seat of [...DESKS, ...BEANBAGS]) {
    for (const side of [-1, 1]) {
      const [x, z] = deskPoint(seat, side * 0.7, 1.75);
      assert.equal(flat.walkable(x, z), true, `${seat.id} on a floor that's all one level`);
      assert.equal(nav.walkable(x, z), true, `${seat.id} (${x.toFixed(2)}, ${z.toFixed(2)}) under the big mezzanine`);
    }
  }

  // A browser shows one floor: its grid follows the room it's told, the mezzanine and the kitchen both.
  const head = MEETING_SEATS[0];
  try {
    assert.equal(walkable(4.8, 2), true);
    setOfficeRoom(BIG_ROOM);
    assert.equal(walkable(4.8, 2), false);
    assert.equal(walkable(4.8, 2, 1), false, 'built out into the back office too');
    assert.equal(walkable(6, 12.1), true);
    const way = wayIn(head);
    assert.ok(way.length >= 2, 'a worker called to a meeting still has a way in');
    assert.ok(Math.hypot(way.at(-1)![0] - deskPoint(head, 0.7, 0.95)[0], way.at(-1)![1] - deskPoint(head, 0.7, 0.95)[1]) < 1e-9 || Math.hypot(way.at(-1)![0] - deskPoint(head, -0.7, 0.95)[0], way.at(-1)![1] - deskPoint(head, -0.7, 0.95)[1]) < 1e-9);
    assert.equal(walkable(-14, 12.2), false, 'the kitchen counter');
    setOfficeRoom({ ...BIG_ROOM, kitchen: false });
    assert.equal(walkable(-14, 12.2), true);
    assert.equal(walkable(4.8, 2), false);
    // Paint and tees change nothing to walk round.
    setOfficeRoom({ ...BIG_ROOM, kitchen: false, tees: 2, panels: ['south'] });
    assert.equal(walkable(-14, 12.2), true);
  } finally {
    setOfficeRoom(ROOM_DEFAULTS);
  }
  assert.equal(walkable(4.8, 2), true);
  assert.equal(walkable(-14, 12.2), false);
});

test('a layout dropped on a floor with the big mezzanine leaves the office as it comes, less the hoop', () => {
  // Saved by an office whose deck was elsewhere: a sofa where the stairs are now.
  const stale = cleanPlan({ wing: 0, labels: {}, room: BIG_ROOM, desks: {}, furniture: [...defaults(), { id: 'new', kind: 'sofa', x: 4.8, z: 2, rotY: Math.PI / 2 }], layoutRevision: 3 });
  assert.deepEqual(stale.room, BIG_ROOM);
  assert.deepEqual(stale.furniture, defaults().filter((p) => p.id !== 'hoop'));
  assert.deepEqual([stale.desks, stale.layoutRevision], [undefined, undefined]);
  assert.equal(layoutProblems({ desks: {}, furniture: stale.furniture! }, stale.room).size, 0);
  // The same for one that has the room and no layout at all.
  assert.deepEqual(cleanPlan({ room: BIG_ROOM }).furniture?.some((p) => p.id === 'hoop'), false);
  // In a room the office's own furniture all fits, a dropped layout leaves nothing behind, as before.
  for (const room of [undefined, { tees: 2 }, { mezzanine: 'none' }, { kitchen: false }, { boss: false }]) {
    const plan = cleanPlan({ room, desks: {}, furniture: [{ id: 'new', kind: 'sofa', x: 40, z: 0, rotY: 0 }] });
    assert.deepEqual([plan.furniture, plan.desks], [undefined, undefined], JSON.stringify(room));
  }
});

test("new floors are handed one of the first ten looks: the three brands' own are only ever picked", () => {
  assert.equal(STOCK_PALETTES, 10);
  assert.deepEqual(FLOOR_PALETTES.slice(STOCK_PALETTES).map((p) => p.name), ['Friday', 'Innovators', 'Studio']);
  assert.deepEqual(floorPalette(10), { name: 'Friday', wall: '#f5f6f2', trim: '#09ca59', floor: '#9b6a45', floorAlt: '#8d5f3d', seam: '#6f4a30' });
  assert.deepEqual(floorPalette(11), { name: 'Innovators', wall: '#f5f6f2', trim: '#0080fe', floor: '#e6dcc8', floorAlt: '#dccfb6', seam: '#c2b497' });
  assert.deepEqual(floorPalette(12), { name: 'Studio', wall: '#1c1c1e', trim: '#218cff', floor: '#c9a36b', floorAlt: '#bd9560', seam: '#9c7a4c' });
  assert.equal(floorPalette(0).name, 'Maple');

  // Twelve floors added one after another: each of the ten stock looks once, then round again, never a brand's.
  const root = mkdtempSync(path.join(tmpdir(), 'content-studio-looks-'));
  try {
    mkdirSync(path.join(root, 'office'));
    const building = new Building(path.join(root, 'office'), path.join(root, 'projects'));
    const looks = Array.from({ length: 12 }, (_, i) => {
      const def = building.addFolder(path.join(root, 'work', `floor-${i}`), `Floor ${i}`, 'Tyler');
      assert.ok(typeof def === 'object', String(def));
      return def.palette;
    });
    assert.deepEqual([...looks.slice(0, STOCK_PALETTES)].sort((a, b) => a - b), Array.from({ length: STOCK_PALETTES }, (_, i) => i));
    assert.ok(looks.every((look) => look < STOCK_PALETTES), JSON.stringify(looks));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
