import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { PIECE_SCALE, type FurnitureKind } from '../src/shared/furniture.js';
import { assertInFootprint, fmt, kind, near, openPack } from './model-pack';

// greenery.glb (exported by blender/scripts/build_greenery.py) against what
// world/office/furniture-greenery.ts and the catalog (shared/furniture.ts) count on: each plant by name,
// its planter a root standing on the floor at the origin with what grows out of it hung under it as
// `<plant>_leaves` (as plants.glb has them), the materials the code paints, planters inside their kinds'
// footprints and as high as their colliders, and leaves that don't reach too far over them.

const greenery = openPack('greenery');

/** Each plant, and the kind it's built for. */
const PLANTS: Record<string, FurnitureKind> = {
  fiddle_leaf: 'fiddle-leaf',
  palm: 'palm',
  bird_of_paradise: 'bird-of-paradise',
  pothos: 'pothos',
  planter: 'planter',
};
const NAMES = Object.keys(PLANTS);
/** The ones in a pot of their own, which come in sizes. */
const POTTED = NAMES.filter((n) => n !== 'planter');
/** GREENERY_COLORS in furniture-greenery.ts, and Box, which is the planter box's own color. */
const MATERIALS = ['Ceramic', 'Stone', 'Charcoal', 'Oak', 'Steel', 'Soil', 'Bark', 'Leaf', 'LeafDark', 'LeafLight', 'Box'];
const GROWS = ['Bark', 'Leaf', 'LeafDark', 'LeafLight'];
/** What a pot, or the box, is made of. */
const POTS = ['Ceramic', 'Stone', 'Charcoal', 'Box'];
const PLANTERS: Record<string, string[]> = {
  fiddle_leaf: ['Ceramic', 'Oak', 'Soil'],
  palm: ['Soil', 'Stone'],
  bird_of_paradise: ['Charcoal', 'Soil'],
  pothos: ['Ceramic', 'Oak', 'Soil', 'Steel'],
  planter: ['Box', 'Soil', 'Steel'],
};

/** How far out from the middle the points reach along x or z, the way the walls run. */
const reach = (vs: Vector3[]) => Math.max(...vs.map((v) => Math.max(Math.abs(v.x), Math.abs(v.z))));
const trianglesOf = (plant: string) => greenery.trianglesOf(plant) + greenery.trianglesOf(`${plant}_leaves`);

test('each plant is its planter, a root node at the origin, with its leaves hung under it', () => {
  const names = greenery.nodes.map((n) => n.name ?? '');
  assert.deepEqual([...names].sort(), NAMES.flatMap((p) => [p, `${p}_leaves`]).sort(), 'only the planters and their leaves, each named once');
  for (const plant of NAMES) {
    assert.equal(greenery.parentName(greenery.byName(plant)), undefined, `${plant} hangs from nothing`);
    assert.equal(greenery.parentName(greenery.byName(`${plant}_leaves`)), plant, `${plant}_leaves hangs from its planter`);
  }
  greenery.assertPlaced(NAMES.flatMap((p) => [p, `${p}_leaves`]));
});

test('its materials are the ones furniture-greenery.ts paints, the planter\'s on the planter and what grows on the leaves', () => {
  const names = greenery.materials();
  for (const m of MATERIALS) assert.ok(names.includes(m), `a material called ${m}`);
  for (const m of names) assert.ok(MATERIALS.includes(m), `${m} isn't a material the code knows (it would come out magenta)`);
  for (const plant of NAMES) {
    assert.deepEqual(greenery.madeOf(plant), PLANTERS[plant], `${plant}'s planter is made of ${greenery.madeOf(plant)}`);
    const leaves = greenery.madeOf(`${plant}_leaves`);
    assert.ok(leaves.length && leaves.every((m) => GROWS.includes(m)), `${plant}_leaves is only what grows (${leaves})`);
  }
});

test('every planter stands on the floor inside its footprint, as high as its collider', () => {
  for (const plant of NAMES) {
    const k = kind(PLANTS[plant]);
    const box = greenery.bounds(plant);
    assert.ok(near(box.min.y, 0, 0.003), `${plant}'s planter stands on the floor (${box.min.y.toFixed(3)})`);
    assertInFootprint(`${plant}'s planter`, greenery.vertices(plant), k);
    // The pot itself (or the box) is centred on its origin; a three-legged stand's bounds needn't be.
    const middle = greenery.bounds(plant, POTS).getCenter(new Vector3());
    assert.ok(Math.hypot(middle.x, middle.z) < 1e-3, `${plant}'s planter is centred on its origin (${fmt(middle)})`);
  }
  // A pot's rim is its collider's top: what you bump into is the pot (and the stand under the pothos's).
  for (const plant of POTTED) {
    const top = greenery.bounds(plant).max.y;
    assert.ok(near(top, kind(PLANTS[plant]).top, 0.01), `${plant}'s pot is ${top.toFixed(3)} m high, its collider ${kind(PLANTS[plant]).top}`);
  }
  // The box is planted so thick you bump into its plants too: its collider's top is in among them, over its rim.
  const rim = greenery.bounds('planter', ['Box']).max.y;
  const leaves = greenery.bounds('planter_leaves');
  assert.ok(rim < kind('planter').top && leaves.max.y > kind('planter').top, `the box's rim is at ${rim.toFixed(3)}, its plants up to ${leaves.max.y.toFixed(3)}`);
});

test('the soil is in the planter, just under its rim, and what grows starts in it', () => {
  for (const plant of NAMES) {
    const soil = greenery.bounds(plant, ['Soil']);
    const pot = greenery.bounds(plant, POTS);
    assert.ok(soil.max.y < pot.max.y && soil.max.y > pot.max.y - 0.08, `${plant}'s soil is at ${soil.max.y.toFixed(3)}, its rim at ${pot.max.y.toFixed(3)}`);
    assert.ok(soil.min.x > pot.min.x && soil.max.x < pot.max.x && soil.min.z > pot.min.z && soil.max.z < pot.max.z, `${plant}'s soil is inside its planter`);
    // Stalks and trunks come up from a little under the soil's top, so nothing floats over it.
    const stems = greenery.vertices(`${plant}_leaves`).filter((v) => Math.hypot(v.x, v.z) < 0.2 || plant === 'planter');
    assert.ok(Math.min(...stems.map((v) => v.y)) < soil.max.y, `${plant} grows out of its soil`);
  }
});

test('the standing plants are tall and stay near their pots, at any size the builder gives them', () => {
  // (how tall at least and at most, how far its leaves may reach from its middle)
  const sizes: Record<string, [number, number, number]> = { fiddle_leaf: [1.6, 2, 0.45], palm: [1.6, 2, 0.7], bird_of_paradise: [1.6, 2, 0.6] };
  for (const [plant, [least, most, far]] of Object.entries(sizes)) {
    const leaves = greenery.vertices(`${plant}_leaves`);
    const tall = Math.max(...leaves.map((v) => v.y));
    assert.ok(tall >= least && tall <= most, `${plant} is ${tall.toFixed(3)} m tall`);
    assert.ok(reach(leaves) <= far, `${plant}'s leaves reach ${reach(leaves).toFixed(3)} m out`);
    // Its leaves start above its pot, clear of whoever walks past it.
    const out = leaves.filter((v) => Math.hypot(v.x, v.z) > kind(PLANTS[plant]).r! + 0.02);
    assert.ok(Math.min(...out.map((v) => v.y)) > 0.6, `${plant}'s leaves are over its pot where they reach past it`);
    // At its biggest it still fits under the meeting room's roof and the loft (2.75 and 3 up).
    assert.ok(tall * PIECE_SCALE.max < 3.6, `${plant} at its biggest is ${(tall * PIECE_SCALE.max).toFixed(2)} m`);
  }
});

test('the pothos trails down from a pot on a stand, off the floor and close in', () => {
  const stand = greenery.bounds('pothos', ['Oak']);
  const pot = greenery.bounds('pothos', ['Ceramic']);
  assert.ok(near(stand.min.y, 0, 0.003) && near(stand.max.y, pot.min.y, 0.005), `its pot stands on its stand, ${stand.max.y.toFixed(3)} up`);
  const leaves = greenery.vertices('pothos_leaves');
  const lowest = Math.min(...leaves.map((v) => v.y));
  assert.ok(lowest < stand.max.y - 0.3 && lowest > 0.1, `its vines hang down to ${lowest.toFixed(3)}`);
  assert.ok(reach(leaves) <= 0.36, `its leaves reach ${reach(leaves).toFixed(3)} m out`);
  assert.ok(Math.max(...leaves.map((v) => v.y)) > pot.max.y + 0.1, 'and heap up over its pot');
});

test('the planter box is planted from end to end, its plants over the box and its back clear', () => {
  const k = kind('planter');
  const box = greenery.bounds('planter', ['Box']);
  assert.ok(box.max.x - box.min.x > k.w! - 0.1 && box.max.z - box.min.z > k.d! - 0.1, 'the box is nearly its whole footprint');
  const leaves = greenery.vertices('planter_leaves');
  // Plants all along it: something growing over every fifth of its length.
  for (let i = 0; i < 5; i++) {
    const x0 = box.min.x + ((box.max.x - box.min.x) * i) / 5;
    const x1 = x0 + (box.max.x - box.min.x) / 5;
    assert.ok(leaves.some((v) => v.x >= x0 && v.x <= x1 && v.y > box.max.y + 0.15), `plants over the box between ${x0.toFixed(2)} and ${x1.toFixed(2)}`);
  }
  // Its back is its footprint's: nothing of it goes into a wall it's pushed up to. Its vines hang over the front.
  assert.ok(Math.min(...leaves.map((v) => v.z)) >= -k.d! / 2 - 0.001, `its plants stay over its back edge (${Math.min(...leaves.map((v) => v.z)).toFixed(3)})`);
  assert.ok(Math.max(...leaves.map((v) => v.z)) <= k.d! / 2 + 0.1, `its vines hang ${Math.max(...leaves.map((v) => v.z)).toFixed(3)} out at the front`);
  assert.ok(leaves.every((v) => Math.abs(v.x) <= k.w! / 2 + 0.001), 'and stay between its ends');
  assert.ok(leaves.some((v) => v.z > box.max.z && v.y < box.max.y - 0.15), 'vines hang down its front');
});

test('each plant is a few thousand triangles at most', () => {
  for (const plant of NAMES) assert.ok(trianglesOf(plant) <= 4500, `${plant}: ${trianglesOf(plant)} triangles`);
});
