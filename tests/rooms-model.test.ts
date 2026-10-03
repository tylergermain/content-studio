import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import type { FurnitureKind } from '../src/shared/furniture.js';
import { assertInFootprint, fmt, kind, near, openPack } from './model-pack';

// rooms.glb (exported by blender/scripts/build_rooms.py) against what world/office/furniture-rooms.ts and
// the catalog (shared/furniture.ts) count on: the six walls by name, each a root standing on the floor at
// the origin with its length along x, as long as its kind's footprint and no thicker, the materials the
// code paints, and where the glass goes in a glass wall's frame.

const rooms = openPack('rooms');

/** Each piece, and the kind it's built for. */
const PIECES: Record<string, FurnitureKind> = {
  wall: 'wall',
  wall_short: 'wall-short',
  glass_wall: 'glass-wall',
  glass_short: 'glass-short',
  wood_wall: 'wood-wall',
  wood_short: 'wood-short',
};
const NAMES = Object.keys(PIECES);
/** What furniture-rooms.ts paints: Wall, Trim, Frame and Slat from the piece's own color, the rest from its palette. */
const MATERIALS = ['Wall', 'Trim', 'Frame', 'Slat', 'Backing', 'Steel'];
const MADE_OF: Record<string, string[]> = {
  wall: ['Trim', 'Wall'],
  wall_short: ['Trim', 'Wall'],
  glass_wall: ['Frame'],
  glass_short: ['Frame'],
  wood_wall: ['Backing', 'Slat', 'Steel'],
  wood_short: ['Backing', 'Slat', 'Steel'],
};
/** GLASS and BAYS in furniture-rooms.ts: the glass's bottom and top, and each bay's middle along x and its width. */
const GLASS = { bottom: 0.09, top: 2.54 };
/** How high the two transoms across each bay are (TRANSOMS in build_rooms.py): every bay is three panes high. */
const TRANSOMS = [0.93, 1.77];
const BAYS: Record<string, [number, number][]> = {
  glass_wall: [
    [-0.585, 1.13],
    [0.585, 1.13],
  ],
  glass_short: [[0, 1.1]],
};

test('it is six walls, each a root node at the origin, its length along x', () => {
  assert.deepEqual(rooms.nodes.map((n) => n.name ?? '').sort(), [...NAMES].sort(), 'only the six walls, each named once');
  for (const name of NAMES) assert.equal(rooms.parentName(rooms.byName(name)), undefined, `${name} hangs from nothing`);
  rooms.assertPlaced(NAMES);
});

test('its materials are the ones furniture-rooms.ts paints, and each wall is made of its own', () => {
  const names = rooms.materials();
  for (const m of MATERIALS) assert.ok(names.includes(m), `a material called ${m}`);
  for (const m of names) assert.ok(MATERIALS.includes(m), `${m} isn't a material the code knows (it would come out magenta)`);
  for (const name of NAMES) assert.deepEqual(rooms.madeOf(name), MADE_OF[name], `${name} is made of ${rooms.madeOf(name)}`);
});

test('every wall stands on the floor, as long as its footprint, no thicker, and as tall as its collider', () => {
  for (const name of NAMES) {
    const k = kind(PIECES[name]);
    const box = rooms.bounds(name);
    assert.ok(near(box.min.y, 0, 1e-3), `${name} stands on the floor (${box.min.y.toFixed(3)})`);
    assert.ok(near(box.max.y, k.top, 1e-3), `${name} is ${box.max.y.toFixed(3)} m tall, its collider ${k.top}`);
    // End to end, two of them make one wall: each reaches exactly to the ends of its footprint.
    assert.ok(near(box.min.x, -k.w! / 2, 1e-3) && near(box.max.x, k.w! / 2, 1e-3), `${name} runs ${box.min.x.toFixed(3)} to ${box.max.x.toFixed(3)}`);
    assertInFootprint(name, rooms.vertices(name), k);
    const middle = box.getCenter(new Vector3());
    assert.ok(Math.hypot(middle.x, middle.z) < 1e-3, `${name} is centred on its origin (${fmt(middle)})`);
  }
});

test('a glass wall is a frame round the bays the code hangs its glass in', () => {
  for (const name of ['glass_wall', 'glass_short']) {
    const frame = rooms.vertices(name, ['Frame']);
    for (const [x, w] of BAYS[name]) {
      // Inside a bay, clear of its edges, nothing of the frame has a corner: the transoms run right across it, from post to post.
      const inside = frame.filter((v) => Math.abs(v.x - x) < w / 2 - 0.02 && v.y > GLASS.bottom + 0.02 && v.y < GLASS.top - 0.02);
      assert.equal(inside.length, 0, `${name}'s bay at ${x} is open from post to post`);
      for (const y of TRANSOMS) {
        const ends = frame.filter((v) => near(v.y, y, 0.03) && near(Math.abs(v.x - x), w / 2, 0.03));
        assert.ok(ends.some((v) => v.x < x) && ends.some((v) => v.x > x), `${name}'s bay at ${x} has a transom across it ${y} up`);
      }
      // A post either side of it, its face right at the bay's edge.
      for (const side of [-1, 1]) {
        const edge = x + (side * w) / 2;
        const post = frame.filter((v) => Math.abs(v.x - edge) < 0.009);
        assert.ok(post.some((v) => v.y < GLASS.bottom + 0.1) && post.some((v) => v.y > GLASS.top - 0.1), `${name} has a post at ${edge.toFixed(3)}, from the floor's rail to the top one`);
      }
    }
    // The rails the glass stands on and stops under.
    assert.ok(frame.some((v) => near(v.y, GLASS.bottom, 0.012)) && frame.some((v) => near(v.y, GLASS.top, 0.012)), `${name} has a rail at the glass's bottom and its top`);
    // The glass is hung on the wall's middle (z = 0): the frame stands either side of it.
    const z = rooms.bounds(name);
    assert.ok(z.min.z < -0.03 && z.max.z > 0.03, `${name}'s frame is thicker than its glass`);
  }
});

test('a wood panel has slats on both faces, spaced so a row of panels keeps its rhythm', () => {
  const pitch = 0.075;
  for (const name of ['wood_wall', 'wood_short']) {
    const k = kind(PIECES[name]);
    const slats = rooms.vertices(name, ['Slat']);
    const backing = rooms.bounds(name, ['Backing']);
    for (const side of [-1, 1]) {
      const face = slats.filter((v) => v.z * side > 0);
      assert.ok(face.length, `${name} has slats on its ${side > 0 ? 'front' : 'back'}`);
      assert.ok(Math.max(...face.map((v) => v.z * side)) > backing.max.z + 0.02, `${name}'s slats stand out of its backing`);
    }
    // Each slat's face is where its vertices are furthest forward: their middles are a pitch apart, half a pitch in from each end.
    const front = Math.max(...slats.map((v) => v.z));
    const xs = [...new Set(slats.filter((v) => near(v.z, front, 1e-4)).map((v) => v.x.toFixed(3)))].map(Number).sort((a, b) => a - b);
    const middles: number[] = [];
    for (let i = 0; i + 1 < xs.length; i += 2) middles.push((xs[i] + xs[i + 1]) / 2);
    assert.equal(middles.length, Math.round(k.w! / pitch), `${name} has ${middles.length} slats`);
    middles.forEach((x, i) => assert.ok(near(x, -k.w! / 2 + pitch * (i + 0.5), 1e-3), `${name}'s slat ${i} is at ${x.toFixed(3)}`));
  }
});

test('each wall keeps to its triangle budget', () => {
  const most: Record<string, number> = { wall: 200, wall_short: 200, glass_wall: 500, glass_short: 400, wood_wall: 1200, wood_short: 700 };
  for (const name of NAMES) assert.ok(rooms.trianglesOf(name) <= most[name], `${name}: ${rooms.trianglesOf(name)} triangles`);
});
