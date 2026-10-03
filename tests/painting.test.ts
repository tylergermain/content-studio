// Paintings as furniture (the `painting` kind in shared/furniture.ts): how much wall one takes
// (shared/hangings.ts), how a list of them is cleaned, the faces they hang on (shared/wall-faces.ts), and
// the rule that one is always on a wall (shared/office-builder.ts). And the doorway, the other new kind.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FRAMES } from '../src/shared/decor.js';
import { DEFAULT_FURNITURE, FURNITURE, MAX_PIECE_TEXT, cleanFurniture, isSolid, kindDef, pieceBox, pieceCollider, pieceTop, type Piece } from '../src/shared/furniture.js';
import { PAINTING, hangSize } from '../src/shared/hangings.js';
import { layoutProblems, problemAt, validateLayout } from '../src/shared/office-builder.js';
import { faceUnder, snapToFace, wallFaces } from '../src/shared/wall-faces.js';

const QUARTER = Math.PI / 2;
const NORTH = 0;
const WEST = QUARTER; // on the west wall, facing east
const SOUTH = 2 * QUARTER;
const EAST = 3 * QUARTER;
const BIG = { mezzanine: 'big' } as const;
const EMPTY_LOFT = { boss: false } as const;
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
const defaults = (): Piece[] => DEFAULT_FURNITURE.map((p) => ({ ...p }));
const noHoop = (): Piece[] => defaults().filter((p) => p.id !== 'hoop');
const painting = (x: number, z: number, rotY: number, more: Partial<Piece> = {}): Piece => ({ id: 'art', kind: 'painting', x, z, rotY, ...more });
const wall = (id: string, kind: Piece['kind'], x: number, z: number, rotY = 0, more: Partial<Piece> = {}): Piece => ({ id, kind, x, z, rotY, ...more });
const withPieces = (pieces: Piece[], base = defaults()) => ({ desks: {}, furniture: [...base, ...pieces] });
const NEEDS = 'Painting needs a wall to hang on';

test('a painting takes the shape of its picture: a scene is wide, a portrait tall', () => {
  assert.deepEqual(PAINTING, { size: 1.2, aspect: 4 / 3, lift: 1.6, frame: 3 });
  assert.equal(FRAMES[PAINTING.frame].name, 'Gold');
  // With nothing said it's a landscape, not a portrait.
  const plain = hangSize({});
  assert.ok(near(plain.w, 1.34) && near(plain.h, 1.04), JSON.stringify(plain));
  const scene = hangSize({ size: 2, aspect: 16 / 9 });
  assert.ok(near(scene.w, 2.14) && near(scene.h, 1.265), JSON.stringify(scene));
  const portrait = hangSize({ size: 1.2, aspect: 0.75 });
  assert.ok(near(portrait.w, 1.04) && near(portrait.h, 1.34), JSON.stringify(portrait));
  // The floor it takes is its frame's width, from the wall's face out into the room.
  const onEast = pieceBox(painting(18, 0, EAST, { size: 2, aspect: 16 / 9 }));
  assert.ok(near(onEast.maxX, 18) && near(onEast.minX, 17.92) && near(onEast.minZ, -1.07) && near(onEast.maxZ, 1.07), JSON.stringify(onEast));
  const onNorth = pieceBox(painting(0, -13, NORTH));
  assert.ok(near(onNorth.minZ, -13) && near(onNorth.maxZ, -12.92) && near(onNorth.maxX - onNorth.minX, 1.34), JSON.stringify(onNorth));
  // Nothing bumps into it, and it reaches to the top of its frame.
  assert.equal(pieceCollider(painting(18, 0, EAST)), undefined);
  assert.equal(isSolid(painting(18, 0, EAST)), false);
  assert.ok(near(pieceTop(painting(18, 0, EAST)), 1.6 + 1.04 / 2));
  assert.ok(near(pieceTop(painting(18, 0, EAST, { lift: 3, size: 2, aspect: 0.5 })), 3 + 2.14 / 2));
});

test('a painting in a list of furniture is kept with its picture, frame, size, shape and height, each within bounds', () => {
  const clean = (more: Record<string, unknown>) => (cleanFurniture([{ id: 'art', kind: 'painting', x: 18, z: 0, rotY: EAST, ...more }]) as Piece[])[0];
  // What it has until someone sets it up, in the order it's kept.
  assert.equal(JSON.stringify(clean({})), JSON.stringify({ id: 'art', kind: 'painting', x: 18, z: 0, rotY: EAST, frame: 3, size: 1.2, aspect: 4 / 3, lift: 1.6 }));
  assert.equal(JSON.stringify(clean({ level: 1, media: 'skyline.jpg' })), JSON.stringify({ id: 'art', kind: 'painting', x: 18, z: 0, rotY: EAST, media: 'skyline.jpg', level: 1, frame: 3, size: 1.2, aspect: 4 / 3, lift: 1.6 }));
  // A picture is a file of the floor's own: not a path, and not the channels a screen follows.
  assert.equal(clean({ media: 'da-vinci (1).png' }).media, 'da-vinci (1).png');
  assert.equal('media' in clean({ media: '../secret.png' }), false);
  assert.equal('media' in clean({ media: '@watch' }), false);
  assert.equal('media' in clean({ media: 7 }), false);
  const others = cleanFurniture([
    { id: 's', kind: 'sofa', x: 0, z: 0, rotY: 0, media: 'skyline.jpg', frame: 2, size: 2, aspect: 2, lift: 2 },
    { id: 'v', kind: 'screen', x: 4, z: 0, rotY: 0, media: '@watch', frame: 2 },
    { id: 'w', kind: 'wall-screen', x: 8, z: 0, rotY: 0, media: 'reel.mp4' },
  ]) as Piece[];
  assert.deepEqual(others[0], { id: 's', kind: 'sofa', x: 0, z: 0, rotY: 0, color: FURNITURE.sofa.color }, 'a sofa shows nothing');
  assert.deepEqual([others[1].media, 'frame' in others[1], others[2].media], ['@watch', false, 'reel.mp4']);

  // Each within its bounds, and its own default when it isn't a number.
  assert.deepEqual([clean({ frame: 6 }).frame, clean({ frame: 7 }).frame, clean({ frame: -1 }).frame, clean({ frame: 1.5 }).frame, clean({ frame: '2' }).frame], [6, 3, 3, 3, 3]);
  assert.deepEqual([clean({ size: 9 }).size, clean({ size: 0.01 }).size, clean({ size: 2.004 }).size, clean({ size: 'big' }).size, clean({ size: NaN }).size], [3.4, 0.3, 2, 1.2, 1.2]);
  assert.deepEqual([clean({ aspect: 16 / 9 }).aspect, clean({ aspect: 99 }).aspect, clean({ aspect: 0.01 }).aspect, clean({ aspect: 0 }).aspect, clean({ aspect: -2 }).aspect, clean({ aspect: 'wide' }).aspect], [16 / 9, 5, 0.2, 4 / 3, 4 / 3, 4 / 3]);
  assert.deepEqual([clean({ lift: 2.52 }).lift, clean({ lift: 9 }).lift, clean({ lift: 'high' }).lift], [2.5, 3.6, 1.6]);
  // However low it's asked for, its frame's bottom edge stays 15 cm off its floor (upstairs, that's a ceiling).
  assert.equal(clean({ lift: 0 }).lift, 0.7, 'a 1.04 m frame');
  const tall = clean({ lift: 0.3, size: 3.4, aspect: 0.5 });
  assert.ok(tall.lift! - hangSize(tall).h / 2 >= 0.15 - 1e-9 && tall.lift! < 2, JSON.stringify(tall));
  assert.equal(clean({ lift: 0.3, size: 0.3, aspect: 1 }).lift, 0.4);

  // It stands on a finer grid than the rest: a wall's faces are 6 or 7 cm off the wall's middle.
  assert.deepEqual([clean({ x: 1.234, z: -0.068 }).x, clean({ x: 1.234, z: -0.068 }).z], [1.23, -0.07]);
  assert.deepEqual((cleanFurniture([{ id: 's', kind: 'sofa', x: 1.234, z: -0.068, rotY: 0 }]) as Piece[])[0].x, 1.25);
  assert.equal(typeof cleanFurniture([{ id: 'art', kind: 'painting', x: 0, z: 0, rotY: 0.4 }]), 'string', 'it hangs flat on a wall: quarter turns');
});

test('the faces to hang on: the outside walls, and both sides of every wall the builder put up', () => {
  // The room's four, each facing in.
  const outer = wallFaces([], 0);
  assert.deepEqual(outer, [
    { x: 0, z: -13, rotY: NORTH, half: 18 },
    { x: 0, z: 13, rotY: SOUTH, half: 18 },
    { x: -18, z: 0, rotY: WEST, half: 13 },
    { x: 18, z: 0, rotY: EAST, half: 13 },
  ]);
  assert.equal(wallFaces(defaults(), 0).length, 4, 'nothing the office comes with is a wall');
  // A wall is 0.14 thick and a wood panel 0.12: a face either side. Glass takes nothing.
  const pieces = [wall('w', 'wall', 0, 0), wall('s', 'wall-short', 5, 5, QUARTER), wall('o', 'wood-wall', -5, 2), wall('p', 'wood-short', -5, 6, 3 * QUARTER), wall('g', 'glass-wall', 0, 4), wall('h', 'glass-short', 3, 4), wall('d', 'doorway', 6, 4)];
  const faces = wallFaces(pieces, 0).filter((f) => f.piece);
  assert.deepEqual(faces, [
    { x: 0, z: 0.07, rotY: NORTH, half: 1.2, piece: 'w' },
    { x: 0, z: -0.07, rotY: SOUTH, half: 1.2, piece: 'w' },
    { x: 5.07, z: 5, rotY: QUARTER, half: 0.6, piece: 's' },
    { x: 4.93, z: 5, rotY: 3 * QUARTER, half: 0.6, piece: 's' },
    { x: -5, z: 2.06, rotY: NORTH, half: 1.2, piece: 'o' },
    { x: -5, z: 1.94, rotY: SOUTH, half: 1.2, piece: 'o' },
    { x: -5.06, z: 6, rotY: 3 * QUARTER, half: 0.6, piece: 'p' },
    { x: -4.94, z: 6, rotY: QUARTER, half: 0.6, piece: 'p' },
  ]);
  for (const kind of ['wall', 'wall-short', 'wood-wall', 'wood-short'] as const) assert.equal(kindDef(kind).wall, true, kind);
  assert.equal(kindDef('glass-wall').wall, undefined);

  // Each level has its own: a wall upstairs is no face downstairs, and the other way round.
  const split = [wall('low', 'wall', 0, 9), wall('high', 'wall', -10, 9, 0, { level: 1 })];
  assert.deepEqual(wallFaces(split, 0, BIG).filter((f) => f.piece).map((f) => f.piece), ['low', 'low']);
  assert.deepEqual(wallFaces(split, 1, BIG).filter((f) => f.piece).map((f) => f.piece), ['high', 'high']);
  // Upstairs the outside walls are the ones the deck reaches: none on a floor with no deck, and the
  // loft's two while the boss's office has it (the same as an empty loft's).
  assert.deepEqual(wallFaces([], 1), wallFaces([], 1, EMPTY_LOFT));
  assert.deepEqual(wallFaces(split, 1, { mezzanine: 'none' }), []);
  assert.deepEqual(wallFaces([], 1, EMPTY_LOFT).map((f) => f.rotY), [SOUTH, EAST]);
  const loftSouth = wallFaces([], 1, EMPTY_LOFT)[0];
  assert.ok(near(loftSouth.z, 13) && near(loftSouth.x - loftSouth.half, 9.12) && near(loftSouth.x + loftSouth.half, 18), JSON.stringify(loftSouth));
  const deck = wallFaces([], 1, BIG);
  assert.deepEqual(deck.map((f) => f.rotY), [SOUTH, WEST, EAST]);
  assert.ok(near(deck[1].z - deck[1].half, 5.3) && near(deck[1].z + deck[1].half, 13) && deck[0].half === 18, JSON.stringify(deck));
});

test('the builder snaps a painting to the nearest face, on the side it was dropped', () => {
  const faces = wallFaces([wall('w', 'wall', 0, 0), wall('g', 'glass-wall', 0, 6)], 0);
  assert.deepEqual(snapToFace({ x: 17.6, z: 3.333 }, faces), { x: 18, z: 3.33, rotY: EAST });
  assert.deepEqual(snapToFace({ x: -3, z: -12.5 }, faces), { x: -3, z: -13, rotY: NORTH });
  // Either side of a wall, whichever the point's on; past its end, onto its end.
  assert.deepEqual(snapToFace({ x: 0.5, z: 0.3 }, faces), { x: 0.5, z: 0.07, rotY: NORTH });
  assert.deepEqual(snapToFace({ x: 0.5, z: -0.3 }, faces), { x: 0.5, z: -0.07, rotY: SOUTH });
  assert.deepEqual(snapToFace({ x: 1.5, z: 0.2 }, faces), { x: 1.2, z: 0.07, rotY: NORTH });
  // Glass gives no face, and neither does anything a meter off.
  assert.equal(snapToFace({ x: 0, z: 6.2 }, faces), null);
  assert.equal(snapToFace({ x: 0, z: 1.1 }, faces), null);
  assert.equal(snapToFace({ x: 6, z: 3 }, faces), null);
  // With no limit it's wherever the nearest is (a new painting has to start somewhere).
  assert.deepEqual(snapToFace({ x: 6, z: 3 }, faces, Infinity), { x: 1.2, z: 0.07, rotY: NORTH });
  assert.equal(snapToFace({ x: 0, z: 0 }, [], Infinity), null);
  // On an outside wall, a margin of half its width keeps the frame out of the corner.
  assert.deepEqual(snapToFace({ x: 17.9, z: -12.95 }, faces), { x: 17.9, z: -13, rotY: NORTH });
  assert.deepEqual(snapToFace({ x: 17.9, z: -12.95 }, faces, 0.6, 1), { x: 17, z: -13, rotY: NORTH });
  assert.deepEqual(snapToFace({ x: 17.9, z: -12.6 }, faces, 0.6, 1), { x: 18, z: -12, rotY: EAST }, 'the nearer wall is still the one it goes on');
  assert.deepEqual(snapToFace({ x: 1.5, z: 0.2 }, faces, 0.6, 1), { x: 1.2, z: 0.07, rotY: NORTH }, "a wall piece's face is used to its ends: the next piece carries on");

  // Which face a painting is on: where it is and the way it faces both have to match.
  assert.equal(faceUnder(painting(0.5, 0.07, NORTH), faces)?.piece, 'w');
  assert.equal(faceUnder(painting(0.5, -0.07, SOUTH), faces)?.piece, 'w');
  assert.equal(faceUnder(painting(0.5, 0.07, SOUTH), faces), undefined, 'facing into the wall');
  assert.equal(faceUnder(painting(0.5, 0.2, NORTH), faces), undefined);
  assert.equal(faceUnder(painting(1.5, 0.07, NORTH), faces), undefined, 'past its end');
  assert.deepEqual(faceUnder(painting(18, 3.33, EAST), faces), { x: 18, z: 0, rotY: EAST, half: 13 });
});

test('a painting is always on a wall: one hanging in mid-air is refused, by the builder and by the office', () => {
  // On the outside walls, facing in.
  for (const p of [painting(-2, -13, NORTH), painting(12, 13, SOUTH), painting(-18, -6, WEST), painting(18, 9, EAST)]) {
    assert.equal(problemAt(withPieces([p]), 'art'), undefined, JSON.stringify(p));
    assert.equal(layoutProblems(withPieces([p])).size, 0);
  }
  // Out on the floor, a little off its wall, or turned side-on to it: not on a wall.
  for (const p of [painting(5, 7.5, NORTH), painting(17.8, 9, EAST), painting(0, -12.9, NORTH), painting(17.3, 9, NORTH)]) {
    assert.equal(problemAt(withPieces([p]), 'art'), NEEDS, JSON.stringify(p));
    assert.equal(layoutProblems(withPieces([p])).get('art'), NEEDS);
    assert.equal(validateLayout({}, withPieces([p]).furniture), NEEDS);
  }
  // Facing into its wall, or too wide for the corner it's in: it sticks out of the room.
  assert.equal(problemAt(withPieces([painting(18, 9, WEST)]), 'art'), 'Painting must stay inside the room');
  assert.equal(problemAt(withPieces([painting(17.9, -13, NORTH)]), 'art'), 'Painting must stay inside the room');

  // Either face of a wall, and of a wood panel: gone with the wall, it's in mid-air.
  const w = wall('w', 'wall', 5, 7.5);
  const wood = wall('o', 'wood-wall', 5, 9, QUARTER);
  assert.equal(problemAt(withPieces([w, painting(5, 7.57, NORTH)]), 'art'), undefined);
  assert.equal(problemAt(withPieces([w, painting(5.6, 7.43, SOUTH)]), 'art'), undefined);
  assert.equal(problemAt(withPieces([wood, painting(5.06, 9, QUARTER)]), 'art'), undefined);
  assert.equal(problemAt(withPieces([wood, painting(4.94, 9.4, 3 * QUARTER)]), 'art'), undefined);
  assert.equal(problemAt(withPieces([painting(5, 7.57, NORTH)]), 'art'), NEEDS);
  assert.equal(problemAt(withPieces([{ ...w, z: 8 }, painting(5, 7.57, NORTH)]), 'art'), NEEDS, 'the wall moved and it did not');
  assert.equal(problemAt(withPieces([wall('g', 'glass-wall', 5, 7.5), painting(5, 7.55, NORTH)]), 'art'), NEEDS);
  // It's nothing to bump into: furniture stands in front of it, and it hangs over a sofa.
  assert.equal(layoutProblems(withPieces([painting(18, 0, EAST), { id: 'chair', kind: 'armchair', x: 17.4, z: -3, rotY: 0 }, painting(18, -3, EAST, { id: 'art-2' })])).size, 0);
  // What the cleaned list keeps is what's checked: a painting sent a hair off its face is on it.
  assert.equal(typeof validateLayout({}, withPieces([w, painting(5.004, 7.5701, NORTH)]).furniture), 'object');
});

test('upstairs a painting hangs on the walls up there, and under the big mezzanine it has to fit', () => {
  const up = { level: 1 } as const;
  const base = noHoop();
  // The deck's own outside walls, and a wall standing on the deck.
  assert.equal(problemAt(withPieces([painting(-10, 13, SOUTH, up)], base), 'art', BIG), undefined);
  assert.equal(problemAt(withPieces([painting(18, 9, EAST, up)], base), 'art', BIG), undefined);
  const high = wall('high', 'wall', -10, 9, 0, up);
  assert.equal(problemAt(withPieces([high, painting(-10, 9.07, NORTH, up)], base), 'art', BIG), undefined);
  assert.equal(layoutProblems(withPieces([high, painting(-10, 9.07, NORTH, up)], base), BIG).size, 0);
  // Not a wall on the floor below, and not the open side of the deck.
  assert.equal(problemAt(withPieces([{ ...high, level: undefined }, painting(-10, 9.07, NORTH, up)], base), 'art', BIG), NEEDS);
  assert.equal(problemAt(withPieces([high, painting(-10, 9.07, NORTH)], base), 'art', BIG), NEEDS, 'nor the other way round');
  assert.equal(problemAt(withPieces([painting(0, -13, NORTH, up)], base), 'art', BIG), 'Painting must stay on the mezzanine');
  // In a loft the boss's office has, its south and east walls clear of what's against them (tests/boss-loft.test.ts);
  // in an empty one, the same walls, under its roof.
  assert.equal(problemAt(withPieces([painting(14, 13, SOUTH, up)]), 'art'), undefined);
  assert.equal(problemAt(withPieces([painting(11, 13, SOUTH, up)]), 'art'), 'Painting is in the way of the window');
  assert.equal(problemAt(withPieces([painting(14, 13, SOUTH, up)]), 'art', EMPTY_LOFT), undefined);
  assert.equal(problemAt(withPieces([painting(14, 13, SOUTH, { ...up, lift: 2.4, size: 1.2, aspect: 0.75 })]), 'art', EMPTY_LOFT), 'Painting is too tall for the loft');

  // Down under the deck, the top of its frame has to clear the slab.
  assert.equal(problemAt(withPieces([painting(-12, 13, SOUTH)], base), 'art', BIG), undefined);
  assert.equal(problemAt(withPieces([painting(-12, 13, SOUTH, { lift: 2.3 })], base), 'art', BIG), 'Painting hangs too high to go under the mezzanine');
  // Out in the open part of the floor it goes as high as the wall does.
  assert.equal(problemAt(withPieces([painting(-12, -13, NORTH, { lift: 3.6, size: 3 })], base), 'art', BIG), undefined);
  assert.equal(problemAt(withPieces([painting(12, 13, SOUTH, { lift: 2.3 })]), 'art'), undefined, 'and on a floor with the corner loft nothing is checked');
});

test('a doorway is a frame to walk through, with the name of its room', () => {
  const k = kindDef('doorway');
  assert.deepEqual([k.group, k.w, k.d, k.top, k.text, k.color], ['Rooms', 1.2, 0.14, 0, 'Office', '#fff6ea']);
  const door: Piece = { id: 'door', kind: 'doorway', x: 5, z: 7.5, rotY: 0 };
  assert.equal(pieceCollider(door), undefined, 'nothing to bump into');
  // It stands in a row of walls, in the gap they leave, and in nobody's way.
  const row = withPieces([wall('a', 'wall', 3.2, 7.5), door, wall('b', 'wall', 6.8, 7.5), { id: 'chair', kind: 'armchair', x: 5, z: 7.5, rotY: 0 }]);
  assert.equal(layoutProblems(row).size, 0);
  const clean = cleanFurniture([{ ...door, text: '  Video   Editor ' }, { ...door, id: 'plain' }, { ...door, id: 'long', text: 'x'.repeat(60) }]) as Piece[];
  assert.deepEqual(clean[0], { id: 'door', kind: 'doorway', x: 5, z: 7.5, rotY: 0, color: '#fff6ea', text: 'Video Editor' });
  assert.equal(clean[1].text, 'Office');
  assert.equal(clean[2].text!.length, MAX_PIECE_TEXT);
  // A painting has no paint and no words of its own; a doorway shows no picture.
  assert.deepEqual([kindDef('painting').color, kindDef('painting').text, kindDef('painting').hangs, kindDef('painting').shows], [undefined, undefined, true, true]);
  assert.equal('media' in (cleanFurniture([{ ...door, media: 'a.png' }]) as Piece[])[0], false);
});
