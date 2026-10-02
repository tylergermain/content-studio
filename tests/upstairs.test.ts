// Furniture upstairs (a piece with `level: 1`, see shared/furniture.ts): what it is to whoever bumps into
// it, sits on it or walks the floor under it, where the builder's rules let it stand, what they refuse
// under the big mezzanine, and what changing a floor's structure says is in the way.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FloorPlanStore } from '../src/server/floorplan.js';
import { DEFAULT_FURNITURE, FURNITURE_KINDS, MAX_PIECES, canGoUp, cleanFurniture, furnitureObstacles, furnitureSeats, kindDef, pieceAway, pieceCollider, pieceSeat, pieceTop, pieceY, type Piece } from '../src/shared/furniture.js';
import { DECK_Y } from '../src/shared/mezzanine.js';
import { starterRooms } from '../src/shared/mezzanine-rooms.js';
import { officeNav } from '../src/shared/nav.js';
import { layoutProblems, mezzanineProblem, problemAt, structureProblem, validateLayout } from '../src/shared/office-builder.js';

const QUARTER = Math.PI / 2;
const BIG = { mezzanine: 'big' } as const;
const EMPTY_LOFT = { boss: false } as const;
const defaults = (): Piece[] => DEFAULT_FURNITURE.map((p) => ({ ...p }));
/** The office as it comes without its hoop, which a floor with the big mezzanine can't keep. */
const noHoop = (): Piece[] => defaults().filter((p) => p.id !== 'hoop');
const withPiece = (p: Piece, base = noHoop()) => ({ desks: {}, furniture: [...base, p] });
const up = (kind: Piece['kind'], x: number, z: number, rotY = 0): Piece => ({ id: 'new', kind, x, z, rotY, level: 1 });
const down = (kind: Piece['kind'], x: number, z: number, rotY = 0): Piece => ({ id: 'new', kind, x, z, rotY });

test('a piece upstairs stands on the deck: what you bump into starts there, and you sit up there', () => {
  const wall = pieceCollider(up('wall', 0, 9))!;
  assert.deepEqual([wall.bottom, wall.top], [3, 5.6]);
  assert.equal('bottom' in pieceCollider(down('wall', 0, 9))!, false, 'down on the office floor nothing changes');
  assert.equal(pieceCollider(down('wall', 0, 9))!.top, 2.6);
  assert.deepEqual([pieceY(up('sofa', 0, 9)), pieceY(down('sofa', 0, 9))], [DECK_Y, 0]);
  assert.equal(pieceSeat(up('sofa', 0, 9))!.y, 3);
  assert.equal(pieceSeat(down('sofa', 0, 9))!.y, 0);
  assert.equal(furnitureSeats([up('sofa', 0, 9)], 0)[0].y, 3);

  // The way round the floor is the office floor's: what's upstairs is in nobody's way down there.
  assert.deepEqual(furnitureObstacles([up('sofa', 0, 9), up('pouf', 2, 9)]), { rects: [], circles: [] });
  assert.equal(furnitureObstacles([down('sofa', 0, 9)]).rects.length, 1);
  assert.equal(officeNav(0, undefined, [up('sofa', 0, 9)], BIG).walkable(0, 9), true);
  assert.equal(officeNav(0, undefined, [down('sofa', 0, 9)], BIG).walkable(0, 9), false);
  // Nor in the way into the back office.
  assert.equal(pieceAway({ ...up('sofa', 15, -12), level: 1 }, 1), false);
  assert.equal(pieceAway(down('sofa', 15, -12), 1), true);
});

test('upstairs is for furniture: not what the office has one of, what is played with, or the ticker', () => {
  for (const kind of FURNITURE_KINDS) {
    const k = kindDef(kind);
    assert.equal(canGoUp(kind), !k.fixed && k.group !== 'Play' && kind !== 'ticker', kind);
  }
  assert.ok(canGoUp('sofa') && canGoUp('wall') && canGoUp('painting') && canGoUp('doorway') && canGoUp('neon') && canGoUp('team-desk'));
  assert.ok(!canGoUp('whiteboard') && !canGoUp('trampoline') && !canGoUp('ticker') && !canGoUp('hoop') && !canGoUp('jukebox'));

  const clean = cleanFurniture([
    { ...up('sofa', 0, 9), id: 'a' },
    { ...down('sofa', 0, 2), id: 'b', level: 2 },
    { ...down('sofa', 0, 4), id: 'c', level: '1' },
    { id: 'whiteboard', kind: 'whiteboard', x: 5.4, z: -5.4, rotY: 0, level: 1 },
    { ...up('trampoline', 3, 9), id: 'd' },
    { ...up('ticker', 0, 0), id: 'e' },
  ]) as Piece[];
  assert.equal(clean[0].level, 1);
  for (const p of clean.slice(1)) assert.equal('level' in p, false, p.kind);
  // A piece that says nothing of a level gains no key: what a floor saved before is what it reads back.
  assert.deepEqual(cleanFurniture(JSON.parse(JSON.stringify(DEFAULT_FURNITURE))), defaults());
  assert.equal(MAX_PIECES, 300);
});

test('how high things reach, for whether they fit under a deck', () => {
  assert.equal(pieceTop(down('wall', 0, 0)), 2.6);
  assert.equal(pieceTop(down('rug', 0, 0)), 0);
  assert.ok(Math.abs(pieceTop({ ...down('palm', 0, 0), scale: 1.5 }) - 0.9) < 1e-9);
  // What hangs from the ceiling over the office floor goes all the way up; upstairs a neon is on its wall.
  for (const kind of ['ticker', 'neon', 'hoop'] as const) assert.equal(pieceTop(down(kind, 0, 0)), Infinity, kind);
  assert.equal(pieceTop(up('neon', 0, 9)), 0);
  assert.equal(pieceTop(down('wall-screen', 0, 0)), 0, 'a wall screen hangs at eye level');
});

test('where a piece upstairs may stand goes by the deck the floor has', () => {
  // The boss's office has the corner loft, and a floor that's all one level has no upstairs.
  assert.equal(problemAt(withPiece(up('sofa', 14, 10.5), defaults()), 'new'), "Sofa is upstairs, where the boss's office is");
  assert.equal(problemAt(withPiece(up('sofa', 14, 10.5)), 'new', { mezzanine: 'none' }), 'Sofa is upstairs, and this floor is all one level');
  assert.equal(layoutProblems(withPiece(up('rug-small', 14, 10.5)), { loft: false }).get('new'), 'Small rug is upstairs, and this floor is all one level');

  // An empty loft takes furniture inside its glass, clear of where the stairs come in.
  assert.equal(problemAt(withPiece(up('sofa', 14, 10.5), defaults()), 'new', EMPTY_LOFT), undefined);
  assert.equal(problemAt(withPiece(up('sofa', 5, 0), defaults()), 'new', EMPTY_LOFT), 'Sofa must stay on the mezzanine');
  assert.equal(problemAt(withPiece(up('armchair', 9.8, 12.2), defaults()), 'new', EMPTY_LOFT), 'Armchair would block the top of the stairs');
  assert.equal(problemAt(withPiece(up('rug-small', 10.7, 12), defaults()), 'new', EMPTY_LOFT), undefined, 'a rug lies under whoever comes in');
  // (2.8 m under the loft's roof: a wall fits, a high striker doesn't go up at all.)
  assert.equal(problemAt(withPiece(up('wall', 14, 9), defaults()), 'new', EMPTY_LOFT), undefined);

  // The big mezzanine: anywhere on the deck behind its rail, but where the stairs arrive.
  assert.equal(problemAt(withPiece(up('sofa', -10, 9)), 'new', BIG), undefined);
  assert.equal(problemAt(withPiece(up('sofa', 0, 2)), 'new', BIG), 'Sofa must stay on the mezzanine');
  assert.equal(problemAt(withPiece(up('sofa', -10, 5.6)), 'new', BIG), 'Sofa must stay on the mezzanine', 'through the rail');
  assert.equal(problemAt(withPiece(up('sofa', 4.8, 5.8)), 'new', BIG), 'Sofa would block the top of the stairs');
  assert.equal(problemAt(withPiece(up('rug-small', 4.8, 6.5)), 'new', BIG), undefined);

  // What can't go up says so, wherever it's put.
  assert.equal(problemAt({ desks: {}, furniture: [{ ...up('trampoline', -10, 9) }] }, 'new', BIG), 'The trampoline only stands on the office floor');
  assert.equal(layoutProblems({ desks: {}, furniture: [{ ...up('ticker', -10, 9) }] }, BIG).get('new'), 'The stock ticker only stands on the office floor');
});

test('upstairs and downstairs are in each other\'s way only on their own level', () => {
  const both = { desks: {}, furniture: [...noHoop(), { ...down('sofa', -10, 9), id: 'low' }, { ...up('sofa', -10, 9), id: 'high' }] };
  assert.equal(layoutProblems(both, BIG).size, 0);
  assert.equal(problemAt(both, 'low', BIG), undefined);
  assert.equal(problemAt(both, 'high', BIG), undefined);
  const two = { desks: {}, furniture: [...noHoop(), { ...up('sofa', -10, 9), id: 'a' }, { ...up('armchair', -10, 9), id: 'b' }] };
  assert.deepEqual([...layoutProblems(two, BIG)], [['a', 'Sofa overlaps the armchair'], ['b', 'Armchair overlaps the sofa']]);
  assert.equal(problemAt(two, 'b', BIG), 'Armchair overlaps the sofa');
  // A desk is down on the office floor: a piece over it upstairs isn't on it. (Desk 13 is under the deck's edge.)
  const overDesk = withPiece(up('sofa', -11.6, 5.9));
  assert.equal(problemAt(overDesk, 'new', BIG), undefined);
  assert.match(problemAt(withPiece(down('sofa', -11.6, 5.9)), 'new', BIG)!, /overlaps desk/);
  // Nor is what's upstairs on what's built into the floor below: over the kitchen is deck like any other.
  assert.equal(problemAt(withPiece(up('sofa', -14, 12.2)), 'new', BIG), undefined);
  assert.match(problemAt(withPiece(down('sofa', -14, 12.2)), 'new', BIG)!, /the kitchen/);
});

test('under the big mezzanine nothing stands taller than the room there, or hangs from the ceiling', () => {
  const board = (x: number, z: number) => ({ desks: {}, furniture: noHoop().map((p) => (p.id === 'whiteboard' ? { ...p, x, z } : p)) });
  assert.equal(problemAt(board(0, 9), 'whiteboard', BIG), 'Whiteboard is too tall to stand under the mezzanine');
  assert.equal(layoutProblems(board(0, 9), BIG).get('whiteboard'), 'Whiteboard is too tall to stand under the mezzanine');
  assert.equal(problemAt(withPiece(down('ticker', 0, 9)), 'new', BIG), 'Stock ticker hangs too high to go under the mezzanine');
  assert.equal(problemAt(withPiece(down('neon', 0, 9)), 'new', BIG), 'Neon sign hangs too high to go under the mezzanine');
  assert.equal(problemAt(withPiece(down('ticker', 0, 4, QUARTER)), 'new', BIG), 'Stock ticker hangs too high to go under the mezzanine', 'one end of it reaches under');
  assert.equal(problemAt(withPiece(down('ticker', 0, 4)), 'new', BIG), undefined, 'along the deck, short of it');
  assert.equal(problemAt({ desks: {}, furniture: defaults() }, 'hoop', BIG), 'Basketball hoop hangs too high to go under the mezzanine');
  // Out in the open part of the floor they're fine, and so is everything that fits.
  assert.equal(problemAt(withPiece(down('neon', 0, 0)), 'new', BIG), undefined);
  assert.equal(problemAt(withPiece(down('wall', 0, 9)), 'new', BIG), undefined);
  assert.equal(problemAt(withPiece(down('high-striker', 0, 9)), 'new', BIG), undefined);
  // On a floor with the corner loft, or none, nothing changes: they stand and hang where they did.
  for (const room of [{}, { mezzanine: 'none' }] as const) {
    assert.equal(problemAt(board(0, 9), 'whiteboard', room), undefined);
    assert.equal(problemAt(withPiece(down('ticker', 0, 9), defaults()), 'new', room), undefined);
    assert.equal(problemAt(withPiece(down('neon', 0, 9), defaults()), 'new', room), undefined);
    assert.equal(layoutProblems({ desks: {}, furniture: defaults() }, room).size, 0);
  }
});

test('changing the room says what has to be cleared first, and where', () => {
  // Taking the deck away from under a sofa.
  const upstairs = withPiece(up('sofa', -10, 9));
  assert.equal(structureProblem(upstairs, BIG, { mezzanine: 'none' }), 'Clear upstairs first: Sofa is upstairs, and this floor is all one level');
  assert.equal(structureProblem(upstairs, BIG, {}), "Clear upstairs first: Sofa is upstairs, where the boss's office is");
  assert.equal(structureProblem(upstairs, BIG, EMPTY_LOFT), 'Clear upstairs first: Sofa must stay on the mezzanine');
  // The boss moving back into a loft someone furnished.
  const inLoft = withPiece(up('sofa', 14, 10.5), defaults());
  assert.equal(structureProblem(inLoft, EMPTY_LOFT, {}), "Clear upstairs first: Sofa is upstairs, where the boss's office is");
  // Stairs landing on something.
  const sofa = withPiece(down('sofa', 4.8, 2, QUARTER));
  assert.equal(structureProblem(sofa, {}, BIG), 'Clear the floor for the mezzanine first: Sofa is in the way of the stairs');
  assert.equal(structureProblem(sofa, { mezzanine: 'none' }, BIG), 'Clear the floor for the mezzanine first: Sofa is in the way of the stairs');
  assert.equal(mezzanineProblem(sofa, BIG), 'Clear the floor for the mezzanine first: Sofa is in the way of the stairs');
  assert.equal(mezzanineProblem(sofa), undefined, "the corner loft's stairs are elsewhere");
  assert.equal(structureProblem(withPiece(down('neon', 0, 9)), {}, BIG), 'Clear the floor for the mezzanine first: Neon sign hangs too high to go under the mezzanine');
  // The kitchen coming back onto a sofa: alone, and along with a mezzanine that has nothing against it.
  const inKitchen = withPiece(down('sofa', -14, 12.2));
  assert.equal(structureProblem(inKitchen, { kitchen: false }, {}), 'Clear the floor for the kitchen first: Sofa is in the way of the kitchen');
  assert.equal(structureProblem(inKitchen, { mezzanine: 'none', kitchen: false }, BIG), 'Clear the floor for the kitchen first: Sofa is in the way of the kitchen');
  // Nothing in the way, or nothing the change brought: nothing to say.
  assert.equal(structureProblem({ desks: {}, furniture: noHoop() }, {}, BIG), undefined);
  assert.equal(structureProblem(upstairs, BIG, { ...BIG, kitchen: false }), undefined);
  assert.equal(structureProblem(withPiece(down('sofa', 40, 0)), {}, BIG), undefined, 'outside the room either way');
});

test('the starter rooms are 26 pieces that fit the big mezzanine as it comes', () => {
  const rooms = starterRooms([]);
  assert.equal(rooms.length, 26);
  assert.ok(rooms.every((p) => p.level === 1));
  assert.equal(new Set(rooms.map((p) => p.id)).size, 26);
  const kinds = (kind: Piece['kind']) => rooms.filter((p) => p.kind === kind);
  assert.deepEqual([kinds('glass-wall').length, kinds('glass-short').length, kinds('doorway').length, kinds('wall').length, kinds('wall-short').length], [9, 1, 4, 8, 4]);
  assert.deepEqual(kinds('doorway').map((p) => [p.x, p.z, p.text]), [[-10.2, 6.9, 'Office 1'], [-1.8, 6.9, 'Office 2'], [7.8, 6.9, 'Studio'], [13.8, 6.9, 'Office 3']]);
  // Four cross walls from the fronts back to the south wall; the fourth stands clear of the loft's high south window (x 9.6..12.4).
  assert.deepEqual([...new Set(kinds('wall').map((p) => p.x))], [-9.6, -1.2, 7.2, 13.2]);
  assert.ok([...kinds('wall'), ...kinds('wall-short')].every((p) => p.rotY === QUARTER));
  // Ids none of the floor's own pieces has.
  const taken = defaults();
  assert.ok(starterRooms(taken).every((p) => !taken.some((q) => q.id === p.id)));

  // With the office as it comes (less the hoop) they validate clean, and are kept as they are.
  const layout = validateLayout({}, [...noHoop(), ...rooms], BIG);
  assert.ok(typeof layout === 'object', String(layout));
  assert.deepEqual(layout.furniture.slice(-26), rooms);
  // The landing where the stairs arrive is open: nothing of them is on the top of the stairs.
  assert.equal(problemAt({ desks: {}, furniture: [...rooms, up('armchair', 3, 9)] }, 'new', BIG), undefined);
  // They're for the big deck: no other floor has room for them.
  assert.equal(typeof validateLayout({}, [...defaults(), ...rooms]), 'string');
});

test('a floor saves a big mezzanine with rooms upstairs, and reads it back after a restart', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'content-studio-upstairs-'));
  try {
    const plan = new FloorPlanStore(dir);
    const free = () => false;
    const room = { mezzanine: 'big', kitchen: false, panels: ['south'] } as const;
    const furniture = [...noHoop(), ...starterRooms(noHoop()), { ...up('sofa', -14, 9.5), id: 'up-sofa' }];
    // The hoop can't stay: the reason names what's changing.
    assert.equal(plan.layout({ desks: {}, furniture: [...defaults()], room }, 0, free), 'Clear the floor for the mezzanine first: Basketball hoop hangs too high to go under the mezzanine');
    assert.equal(plan.layout({ desks: {}, furniture, room }, 0, free), undefined);
    assert.deepEqual(plan.state().room, room);
    assert.deepEqual(plan.layoutNow().room, { tees: 1, mezzanine: 'big', boss: false, kitchen: false, panels: ['south'], wood: 'oak' });
    assert.equal(plan.seat('up-sofa')?.y, 3);
    assert.equal(plan.seat('boss-chair'), undefined, "no boss's office on this floor");

    const again = new FloorPlanStore(dir);
    assert.deepEqual(again.state().room, room);
    assert.equal(again.state().furniture?.length, furniture.length);
    assert.equal(again.state().furniture?.filter((p) => p.level === 1).length, 27);
    assert.equal(again.state().layoutRevision, 1);
    // Going back to one level with the rooms still up there is refused, and says to clear them.
    assert.match(again.layout({ desks: {}, furniture, room: { mezzanine: 'none', kitchen: false } }, 1, free)!, /^Clear upstairs first: /);
    // The kitchen back, with nothing in its corner: fine.
    assert.equal(again.layout({ desks: {}, furniture, room: { mezzanine: 'big' } }, 1, free), undefined);
    assert.deepEqual(again.state().room, { mezzanine: 'big' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
