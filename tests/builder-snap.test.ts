// The builder's dragging (client/features/office-builder/drag.ts) and its draft (draft.ts): where a
// painting snaps to as it's dragged, the upstairs floor a piece is kept on, and what a wall takes with
// it when it's moved, turned or taken away. The faces themselves are shared/wall-faces.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DraftLayout } from '../src/client/features/office-builder/draft.js';
import { carry, dragPose, hungOn, otherSide } from '../src/client/features/office-builder/drag.js';
import { DEFAULT_FURNITURE, type Piece } from '../src/shared/furniture.js';
import type { RoomOptions } from '../src/shared/floorplan.js';
import { deckOf } from '../src/shared/mezzanine.js';
import { layoutProblems, ORIGINAL_DESKS } from '../src/shared/office-builder.js';
import { faceUnder, snapToFace, wallFaces } from '../src/shared/wall-faces.js';

const QUARTER = Math.PI / 2;
const NORTH = 0; // the way a painting on the north wall faces: into the room, toward +z
const WEST = QUARTER;
const SOUTH = 2 * QUARTER;
const EAST = 3 * QUARTER;
const BIG = { mezzanine: 'big' } as const;
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
const piece = (id: string, kind: Piece['kind'], x: number, z: number, rotY = 0, more: Partial<Piece> = {}): Piece => ({ id, kind, x, z, rotY, ...more });
const painting = (id: string, x: number, z: number, rotY: number, more: Partial<Piece> = {}): Piece => piece(id, 'painting', x, z, rotY, more);
const DESK_IDS = ORIGINAL_DESKS.map((d) => d.id);
/** A draft of the office as it comes (less the hoop, which a big mezzanine has no place for), with `pieces` added. */
const draftWith = (pieces: Piece[], room?: RoomOptions) => new DraftLayout({ desks: {}, furniture: [...DEFAULT_FURNITURE.filter((p) => p.id !== 'hoop').map((p) => ({ ...p })), ...pieces], room }, DESK_IDS);
const clean = (d: DraftLayout) => assert.deepEqual([...layoutProblems(d.now, d.now.room)], []);

test('a point by a wall snaps onto its face, facing the way the face does', () => {
  const faces = wallFaces([], 0);
  // 0.4 m in from the east wall: on it, facing west.
  assert.deepEqual(snapToFace({ x: 17.6, z: 2 }, faces), { x: 18, z: 2, rotY: EAST });
  assert.deepEqual(snapToFace({ x: 3, z: -12.7 }, faces), { x: 3, z: -13, rotY: NORTH });
  // A meter from any face is too far to be meant for one.
  assert.equal(snapToFace({ x: 17, z: 2 }, faces), null);
  assert.equal(snapToFace({ x: 0, z: 0 }, faces), null);
  // Asked for the nearest wherever it is (a new painting), there always is one.
  assert.deepEqual(snapToFace({ x: 1, z: 3 }, faces, Infinity), { x: 1, z: 13, rotY: SOUTH });
});

test('either side of a wall the builder put up takes a painting, and glass takes none', () => {
  const faces = wallFaces([piece('w', 'wall', 0, 0)], 0);
  // A wall is 0.14 deep: its faces are 7 cm either side of its middle.
  assert.deepEqual(snapToFace({ x: 0.5, z: 0.3 }, faces), { x: 0.5, z: 0.07, rotY: NORTH });
  assert.deepEqual(snapToFace({ x: -0.5, z: -0.3 }, faces), { x: -0.5, z: -0.07, rotY: SOUTH });
  // Off its end it lands on the end, not past it.
  assert.deepEqual(snapToFace({ x: 1.5, z: 0.2 }, faces), { x: 1.2, z: 0.07, rotY: NORTH });
  // A wood panel is 0.12 deep, and turned a quarter its faces look east and west.
  const wood = wallFaces([piece('p', 'wood-wall', 4, 0, QUARTER)], 0);
  assert.deepEqual(snapToFace({ x: 4.3, z: 0.5 }, wood), { x: 4.06, z: 0.5, rotY: WEST });
  assert.deepEqual(snapToFace({ x: 3.7, z: 0.5 }, wood), { x: 3.94, z: 0.5, rotY: EAST });
  // Glass has no face to hang on.
  const glass = wallFaces([piece('g', 'glass-wall', 0, 0), piece('h', 'glass-short', 4, 0)], 0);
  assert.equal(snapToFace({ x: 0, z: 0.2 }, glass), null);
  assert.equal(glass.length, wallFaces([], 0).length);
});

test('walls on the other level are not this level’s to hang on', () => {
  const furniture = [piece('down', 'wall', 0, 9), piece('up', 'wall', 6, 9, 0, { level: 1 })];
  const ground = wallFaces(furniture, 0, BIG);
  const upstairs = wallFaces(furniture, 1, BIG);
  assert.deepEqual(snapToFace({ x: 0, z: 9.3 }, ground), { x: 0, z: 9.07, rotY: NORTH });
  assert.equal(snapToFace({ x: 6, z: 9.3 }, ground), null);
  assert.deepEqual(snapToFace({ x: 6, z: 9.3 }, upstairs), { x: 6, z: 9.07, rotY: NORTH });
  assert.equal(snapToFace({ x: 0, z: 9.3 }, upstairs), null);
  // Upstairs has the outside walls its deck reaches: not the north one, on the big mezzanine.
  assert.deepEqual(snapToFace({ x: 2, z: 12.8 }, upstairs), { x: 2, z: 13, rotY: SOUTH });
  assert.equal(upstairs.some((f) => f.z === -13), false);
  // Up in the boss's office, its south and east walls and nothing else; on a floor that's all one level, no walls at all.
  assert.deepEqual(
    wallFaces(furniture, 1, {}).map((f) => [f.z, f.x, f.rotY, f.piece]),
    [
      [13, (9.12 + 18) / 2, SOUTH, undefined],
      [(8.12 + 13) / 2, 18, EAST, undefined],
    ],
  );
  assert.deepEqual(wallFaces(furniture, 1, { mezzanine: 'none' }), []);
});

test('dragging goes by the grid, and a painting by the walls', () => {
  const sofa = piece('s', 'sofa', 0, 0);
  // A quarter meter at a time; 5 cm with Alt held; a desk (no piece) always a quarter.
  assert.deepEqual(dragPose({ x: 1.13, z: -2.38 }, sofa, [], undefined, false), { x: 1.25, z: -2.5 });
  assert.deepEqual(dragPose({ x: 1.13, z: -2.38 }, sofa, [], undefined, true), { x: 1.15, z: -2.4 });
  assert.deepEqual(dragPose({ x: 1.13, z: -2.38 }, undefined, [], undefined, true), { x: 1.25, z: -2.5 });
  // Not out through the room's walls.
  assert.deepEqual(dragPose({ x: 40, z: -40 }, sofa, [], undefined, false), { x: 18, z: -13 });
  // A painting near a wall is on it; out in the room it's left in mid-air, which the rules refuse.
  const art = painting('a', 0, 0, 0);
  const faces = wallFaces([piece('w', 'wall', 0, 0)], 0);
  assert.deepEqual(dragPose({ x: 17.7, z: 2.1 }, art, faces, undefined, false), { x: 18, z: 2, rotY: EAST });
  assert.deepEqual(dragPose({ x: 0.4, z: 0.3 }, art, faces, undefined, false), { x: 0.5, z: 0.07, rotY: NORTH });
  assert.deepEqual(dragPose({ x: 6, z: 3 }, art, faces, undefined, false), { x: 6, z: 3 });
  // Which side of a wall goes by where the mouse is, not by the grid (the wall stands on a grid line, as near one face as the other).
  assert.deepEqual(dragPose({ x: 0.3, z: 0.07 }, art, faces, undefined, false), { x: 0.25, z: 0.07, rotY: NORTH });
  assert.deepEqual(dragPose({ x: 0.3, z: -0.07 }, art, faces, undefined, false), { x: 0.25, z: -0.07, rotY: SOUTH });
  assert.deepEqual(dragPose({ x: 0.3, z: 0.02 }, art, faces, undefined, false), { x: 0.25, z: 0.07, rotY: NORTH });
  assert.deepEqual(dragPose({ x: 0.3, z: -0.02 }, art, faces, undefined, false), { x: 0.25, z: -0.07, rotY: SOUTH });
  // Its frame stays on the wall: half its width in from the end of the run, and walls end to end are one run.
  assert.deepEqual(dragPose({ x: 1.4, z: 0.2 }, art, faces, undefined, false), { x: 0.53, z: 0.07, rotY: NORTH });
  const row = wallFaces([piece('w', 'wall', 0, 0), piece('w2', 'wall', 2.4, 0), piece('w3', 'wall-short', 4.2, 0), piece('far', 'wall', 9, 0)], 0);
  assert.deepEqual(dragPose({ x: 1.3, z: 0.2 }, art, row, undefined, false), { x: 1.25, z: 0.07, rotY: NORTH });
  assert.deepEqual(dragPose({ x: 5.1, z: 0.2 }, art, row, undefined, false), { x: 4.13, z: 0.07, rotY: NORTH });
  // On a wall shorter than it is, it hangs in the middle.
  assert.deepEqual(dragPose({ x: 0.4, z: 5.2 }, art, wallFaces([piece('s', 'wall-short', 0, 5)], 0), undefined, false), { x: 0, z: 5.07, rotY: NORTH });
  // With Alt it still goes onto the wall, a finer step along it.
  assert.deepEqual(dragPose({ x: 17.7, z: 2.13 }, art, faces, undefined, true), { x: 18, z: 2.15, rotY: EAST });
  // A new one, carried out of the catalog, rides the nearest wall however far that is.
  assert.deepEqual(dragPose({ x: 6, z: 9 }, art, faces, undefined, false, Infinity), { x: 6, z: 13, rotY: SOUTH });
  // On an outside wall its frame stays out of the corner: half its width in from the wall's end.
  const corner = dragPose({ x: 17.9, z: 12.9 }, art, wallFaces([], 0), undefined, false);
  assert.ok(corner.rotY !== undefined && (near(corner.x, 18 - 0.67) || near(corner.z, 13 - 0.67)), JSON.stringify(corner));
});

test('upstairs, what’s dragged stays on the deck', () => {
  const deck = deckOf(BIG)!;
  const sofa = piece('s', 'sofa', 0, 9, 0, { level: 1 });
  // All of it: a sofa is 4.4 by 1, and the deck's floor is x -18..18, z 5.3..13.
  assert.deepEqual(dragPose({ x: 0, z: 2 }, sofa, [], deck, false), { x: 0, z: 5.8 });
  assert.deepEqual(dragPose({ x: -30, z: 20 }, sofa, [], deck, false), { x: -15.8, z: 12.5 });
  assert.deepEqual(dragPose({ x: 3.1, z: 9.1 }, sofa, [], deck, false), { x: 3, z: 9 });
  // Turned a quarter it takes the floor the other way round.
  assert.deepEqual(dragPose({ x: 30, z: 0 }, { ...sofa, rotY: QUARTER }, [], deck, false), { x: 17.5, z: 7.5 });
  // A wall right at the rail keeps its 14 cm on the deck.
  assert.deepEqual(dragPose({ x: 0, z: 0 }, piece('w', 'wall', 0, 9, 0, { level: 1 }), [], deck, false), { x: 0, z: 5.4 });
  // The empty corner loft is a smaller floor: x 9.12..18, z 8.12..13.
  const loft = deckOf({ boss: false })!;
  assert.deepEqual(dragPose({ x: 0, z: 0 }, piece('c', 'armchair', 12, 10, 0, { level: 1 }), [], loft, false), { x: 9.65, z: 8.6 });
  // A piece on the office floor is not held to the deck, whatever the floor has upstairs.
  assert.deepEqual(dragPose({ x: 0, z: 2 }, piece('g', 'sofa', 0, 0), [], undefined, false), { x: 0, z: 2 });
  // A painting upstairs goes by the upstairs walls.
  const faces = wallFaces([], 1, BIG);
  assert.deepEqual(dragPose({ x: 2, z: 12.6 }, painting('a', 0, 0, 0, { level: 1 }), faces, deck, false), { x: 2, z: 13, rotY: SOUTH });
});

test('a wall carries the paintings on its faces: moved with it, turned with it', () => {
  const wall = piece('w', 'wall', 0, 0);
  const front = painting('front', 0.5, 0.07, NORTH);
  const back = painting('back', -0.6, -0.07, SOUTH);
  const other = painting('other', 18, 0, EAST);
  const all = [wall, front, back, other, piece('w2', 'wall', 6, 0), painting('elsewhere', 6, 0.07, NORTH)];
  assert.deepEqual(hungOn(wall, all, {}).map((p) => p.id), ['front', 'back']);
  assert.deepEqual(hungOn(other, all, {}), []);
  // Moved 2 m east and 1 m south, and turned a quarter: what was on its north face is on its west one.
  const riders = [front, back];
  carry(riders, wall, { x: 2, z: 1, rotY: QUARTER });
  Object.assign(wall, { x: 2, z: 1, rotY: QUARTER });
  assert.deepEqual([front.x, front.z, front.rotY], [2.07, 0.5, WEST]);
  assert.deepEqual([back.x, back.z, back.rotY], [1.93, 1.6, EAST]);
  const faces = wallFaces([wall], 0);
  assert.equal(faceUnder(front, faces)?.piece, 'w');
  assert.equal(faceUnder(back, faces)?.piece, 'w');
  // Round to the other side of the wall: the same place along it, facing the other way.
  assert.deepEqual(otherSide(front, faces), { x: 1.93, z: 0.5, rotY: EAST });
  assert.equal(otherSide(other, wallFaces([wall], 0)), undefined);
});

test('in the draft: a wall dragged, turned, nudged or removed takes its paintings along', () => {
  const d = draftWith([piece('w', 'wall', 6, -6), painting('art', 6.5, -5.93, NORTH), painting('east', 18, 0, EAST)]);
  clean(d);
  // The painting dragged along the wall stays on the side it's on, and its frame on the wall (it's 1.34 wide, the wall 2.4).
  assert.equal(d.dragTo('art', { x: 6.3, z: -5.93 }, false), true);
  assert.deepEqual([d.piece('art')!.x, d.piece('art')!.z, d.piece('art')!.rotY], [6.25, -5.93, NORTH]);
  assert.equal(d.dragTo('art', { x: 9, z: -5.8 }, false, Infinity), true);
  assert.deepEqual([d.piece('art')!.x, d.piece('art')!.z, d.piece('art')!.rotY], [6.53, -5.93, NORTH]);
  assert.equal(d.dragTo('art', { x: 6.5, z: -5.93 }, false), true);
  // Dragged: the painting keeps its place on the face.
  assert.equal(d.dragTo('w', { x: 6.1, z: -7.4 }, false), true);
  assert.deepEqual([d.piece('w')!.x, d.piece('w')!.z], [6, -7.5]);
  assert.deepEqual([d.piece('art')!.x, d.piece('art')!.z], [6.5, -7.43]);
  assert.equal(d.problem('w'), undefined);
  // Turned: it comes round with the wall.
  assert.equal(d.turn('w', 1), undefined);
  assert.deepEqual([d.piece('w')!.rotY, d.piece('art')!.x, d.piece('art')!.z, d.piece('art')!.rotY], [QUARTER, 6.07, -8, WEST]);
  clean(d);
  // Nudged a step (as the arrow keys do): the same.
  assert.equal(d.edit(() => d.setPose('w', 6.25, -7.5, QUARTER), 'w'), undefined);
  assert.deepEqual([d.piece('art')!.x, d.piece('art')!.z], [6.32, -8]);
  // A wall pushed up against the room's east wall, where its painting would be through it, is put back, painting and all.
  const before = d.key();
  assert.equal(d.edit(() => d.setPose('w', 17.95, -7.5, QUARTER), 'w'), 'Painting must stay inside the room');
  assert.equal(d.key(), before);
  // The painting on the room's own wall never moved.
  assert.deepEqual([d.piece('east')!.x, d.piece('east')!.z], [18, 0]);
  // Removed: its painting goes with it, and Undo brings both back.
  assert.equal(d.remove('w'), 1);
  assert.equal(d.piece('w'), undefined);
  assert.equal(d.piece('art'), undefined);
  assert.ok(d.piece('east'));
  clean(d);
  assert.equal(d.step(), true);
  assert.ok(d.piece('w') && d.piece('art'));
  // A wall with nothing on it goes alone.
  const bare = d.add('wall-short', 3, -8)!;
  assert.equal(d.remove(bare), 0);
});

test('in the draft: R puts a painting on the wall’s other side, and the arrows can’t push it off its wall', () => {
  const d = draftWith([piece('w', 'wall', 0, 0), painting('art', 0.5, 0.07, NORTH), painting('east', 18, 0, EAST)]);
  assert.equal(d.turn('art', 1), undefined);
  assert.deepEqual([d.piece('art')!.x, d.piece('art')!.z, d.piece('art')!.rotY], [0.5, -0.07, SOUTH]);
  assert.equal(d.turn('art', -1), undefined);
  assert.deepEqual([d.piece('art')!.x, d.piece('art')!.z, d.piece('art')!.rotY], [0.5, 0.07, NORTH]);
  clean(d);
  // One of the room's own walls has no other side.
  assert.match(d.turn('east', 1) ?? '', /no other side/);
  assert.deepEqual([d.piece('east')!.x, d.piece('east')!.rotY], [18, EAST]);
  // A step along the wall is fine; a step off it is refused and put back.
  assert.equal(d.edit(() => d.setPose('art', 0.75, 0.07, NORTH), 'art'), undefined);
  assert.equal(d.edit(() => d.setPose('art', 0.75, 0.32, NORTH), 'art'), 'Painting needs a wall to hang on');
  assert.deepEqual([d.piece('art')!.x, d.piece('art')!.z], [0.75, 0.07]);
});

test('in the draft: a new painting lands on the nearest wall, wherever the view is, and beside one already there', () => {
  const d = draftWith([]);
  const first = d.add('painting', 15, 0.25)!;
  assert.ok(first);
  assert.deepEqual([d.piece(first)!.x, d.piece(first)!.z, d.piece(first)!.rotY], [18, 0.25, EAST]);
  // It comes as a landscape in the gold frame, at eye level.
  assert.deepEqual([d.piece(first)!.frame, d.piece(first)!.size, d.piece(first)!.aspect, d.piece(first)!.lift], [3, 1.2, 4 / 3, 1.6]);
  // From the middle of the floor, 13 m from any wall, it still finds one.
  const far = d.add('painting', 0, 0)!;
  assert.ok(far && faceUnder(d.piece(far)!, wallFaces(d.now.furniture, 0)));
  // A second from the same spot hangs beside the first, not over it.
  const second = d.add('painting', 15, 0.25)!;
  assert.ok(second);
  assert.equal(d.piece(second)!.x, 18);
  assert.ok(Math.abs(d.piece(second)!.z - d.piece(first)!.z) >= 1.34, `${d.piece(second)!.z}`);
  clean(d);
});

test('in the draft: pieces are made upstairs only on a floor with a deck to furnish, and move between levels', () => {
  const d = draftWith([], BIG);
  const up = d.add('sofa', 0, 0, 1)!;
  assert.ok(up);
  assert.equal(d.piece(up)!.level, 1);
  assert.equal(d.levelOf(up), 1);
  assert.equal(d.upstairs, 1);
  clean(d);
  // What only stands on the office floor comes down there even when asked for upstairs.
  const tramp = d.spawn('trampoline', 0, -6, 1);
  assert.equal(d.piece(tramp)!.level, undefined);
  assert.match(d.relevel(tramp) ?? '', /only stands on the office floor/);
  d.remove(tramp);
  // A wall goes upstairs with its painting, and both come back down.
  const wall = d.add('wall', 0, -6)!;
  const art = d.add('painting', 0, -5.5)!;
  assert.equal(faceUnder(d.piece(art)!, wallFaces(d.now.furniture, 0, BIG))?.piece, wall);
  assert.equal(d.relevel(wall), undefined);
  assert.deepEqual([d.levelOf(wall), d.levelOf(art)], [1, 1]);
  assert.equal(faceUnder(d.piece(art)!, wallFaces(d.now.furniture, 1, BIG))?.piece, wall);
  clean(d);
  assert.equal(d.relevel(wall), undefined);
  assert.deepEqual([d.levelOf(wall), d.levelOf(art)], [0, 0]);
  clean(d);
  // A painting alone goes onto the nearest wall of the other level.
  assert.equal(d.relevel(art), undefined);
  assert.equal(d.levelOf(art), 1);
  clean(d);
  // Dragged upstairs it stays on the deck.
  d.dragTo(up, { x: 0, z: -4 }, false);
  assert.equal(d.piece(up)!.z, 5.8);
  // No deck, nowhere to go.
  const flat = draftWith([], { mezzanine: 'none' });
  const chair = flat.add('armchair', 0, -6)!;
  assert.equal(flat.relevel(chair), 'This floor has no upstairs to furnish');
  assert.equal(draftWith([]).relevel('couch'), 'This floor has no upstairs to furnish');
});

test('in the draft: the room’s structure changes only when nothing is in its way', () => {
  const d = draftWith([], { mezzanine: 'none' });
  // One level to the corner loft brings the boss's office back: the room is the office's own again.
  assert.equal(d.setRoom({ mezzanine: 'corner' }), undefined);
  assert.equal(d.now.room, undefined);
  // The loft kept empty, then all one level, then the loft again: it's the boss's office.
  assert.equal(d.setRoom({ boss: false }), undefined);
  assert.deepEqual(d.now.room, { boss: false });
  assert.equal(d.setRoom({ mezzanine: 'none' }), undefined);
  assert.deepEqual(d.now.room, { mezzanine: 'none' });
  assert.equal(d.setRoom({ mezzanine: 'corner' }), undefined);
  assert.equal(d.now.room, undefined);
  // Wood, the kitchen and the tees are kept beside it, and only what isn't the office's own.
  assert.equal(d.setRoom({ panels: ['south', 'north'] }), undefined);
  assert.equal(d.setRoom({ wood: 'walnut' }), undefined);
  assert.equal(d.setRoom({ kitchen: false }), undefined);
  assert.equal(d.setRoom({ tees: 2 }), undefined);
  assert.deepEqual(d.now.room, { tees: 2, kitchen: false, panels: ['north', 'south'], wood: 'walnut' });
  assert.equal(d.setRoom({ wood: 'oak', tees: 1, panels: [] }), undefined);
  assert.deepEqual(d.now.room, { kitchen: false });
  // The big mezzanine, the starter rooms on it, and then no going back to one level until upstairs is cleared.
  assert.equal(d.setRoom({ mezzanine: 'big' }), undefined);
  assert.equal(d.starter(), undefined);
  assert.equal(d.upstairs, 26);
  clean(d);
  const before = d.key();
  assert.match(d.setRoom({ mezzanine: 'none' }) ?? '', /^Clear upstairs first: /);
  assert.match(d.setRoom({ mezzanine: 'corner' }) ?? '', /^Clear upstairs first: /);
  assert.equal(d.key(), before);
  d.clearUp();
  assert.equal(d.upstairs, 0);
  assert.equal(d.setRoom({ mezzanine: 'none' }), undefined);
  // The kitchen can't come back onto a sofa.
  const sofa = d.add('sofa', -14, 12.2)!;
  assert.ok(sofa);
  assert.match(d.setRoom({ kitchen: true }) ?? '', /^Clear the floor for the kitchen first: /);
  // Nor the big mezzanine's stairs onto the hoop's floor, with the hoop still on its wall.
  const hoop = new DraftLayout({ desks: {}, furniture: DEFAULT_FURNITURE.map((p) => ({ ...p })) }, DESK_IDS);
  assert.equal(hoop.setRoom({ mezzanine: 'big' }), 'Clear the floor for the mezzanine first: Basketball hoop hangs too high to go under the mezzanine');
  // The draft reads the same whatever order its parts were set in.
  const a = draftWith([]);
  const key = a.key();
  a.setRoom({ tees: 2 });
  a.edit((x) => (x.look = 3));
  a.setRoom({ tees: 1 });
  a.edit((x) => delete x.look);
  assert.equal(a.key(), key);
});

test('in the draft: a picture changes the painting’s shape, and a bigger one keeps its frame off the floor', () => {
  const d = draftWith([painting('art', 18, 0, EAST, { frame: 3, size: 1.2, aspect: 4 / 3, lift: 1.6 })]);
  // One change: the file and its own shape (a 3:4 portrait).
  assert.equal(d.repiece('art', { media: 'da-vinci.png', aspect: 0.75 }), undefined);
  assert.deepEqual([d.piece('art')!.media, d.piece('art')!.aspect], ['da-vinci.png', 0.75]);
  assert.equal(d.step(), true);
  assert.deepEqual([d.piece('art')!.media, d.piece('art')!.aspect], [undefined, 4 / 3]);
  // As tall as it goes, hung low: lifted until the frame's bottom is 15 cm off the floor.
  assert.equal(d.repiece('art', { size: 3.4, aspect: 0.5, lift: 0.3 }), undefined);
  assert.equal(d.piece('art')!.lift, 1.95);
  // No picture: the key's gone, not empty.
  d.repiece('art', { media: 'x.png' });
  d.repiece('art', { media: undefined });
  assert.equal('media' in d.piece('art')!, false);
  clean(d);
});
