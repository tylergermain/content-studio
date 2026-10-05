import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { AGENT_PROVIDERS } from '../src/shared/providers.js';
import { DEFAULT_TOPPER, TOPPERS, topperFor } from '../src/client/world/toppers.js';
import { fmt, openPack } from './model-pack';

// toppers.glb (exported by blender/scripts/build_toppers.py) against what world/toppers.ts and
// world/character/worker-antenna.ts count on: an emblem for every provider and the plain one, each a root
// named topper_<id> whose origin is the point that stands on the antenna's tip, facing +z, the size of the
// ball it took the place of, made of the two materials the table paints, and a few hundred triangles.

const toppers = openPack('toppers');
const NAMES = [...AGENT_PROVIDERS.map((p) => `topper_${p}`), 'topper_default'];
/** The two materials every row of TOPPERS has a color for. */
const MATERIALS = Object.keys(DEFAULT_TOPPER.colors);
/** The emblems that read from every side, and the flat ones, cut from a slab. */
const ROUND = ['topper_claude', 'topper_opencode', 'topper_dsh', 'topper_default'];

test('it is an emblem for every provider and a plain one, each a root at the origin, facing +z as modelled', () => {
  const names = toppers.nodes.map((n) => n.name ?? '');
  assert.deepEqual([...names].sort(), [...NAMES].sort(), 'only the emblems, each named once');
  for (const name of NAMES) assert.equal(toppers.parentName(toppers.byName(name)), undefined, `${name} hangs from nothing`);
  toppers.assertPlaced(NAMES);
});

test('every provider wears a part the model has, or falls back to the plain one, which it has too', () => {
  assert.ok(toppers.byName(DEFAULT_TOPPER.part) >= 0, `the plain one, ${DEFAULT_TOPPER.part}`);
  for (const provider of AGENT_PROVIDERS) {
    const { part } = topperFor(provider);
    assert.ok(toppers.byName(part) >= 0, `${provider} wears ${part}, which the model has`);
  }
  for (const [provider, row] of Object.entries(TOPPERS)) assert.ok(toppers.byName(row.part) >= 0, `${provider}'s row names ${row.part}, which the model has`);
});

test('its materials are the two the table paints, and every emblem has something in its main color', () => {
  const names = toppers.materials();
  for (const m of names) assert.ok(MATERIALS.includes(m), `${m} isn't a material the table has a color for (it would come out magenta)`);
  for (const m of MATERIALS) assert.ok(names.includes(m), `a material called ${m}`);
  for (const name of NAMES) {
    const made = toppers.madeOf(name);
    assert.ok(made.includes('Main'), `${name} is made of ${made}`);
    assert.ok(made.every((m) => MATERIALS.includes(m)), `${name} is made of ${made}`);
  }
});

test('each stands on the antenna\'s tip, its middle over its origin', () => {
  for (const name of NAMES) {
    const box = toppers.bounds(name);
    assert.ok(box.min.y >= 0 && box.min.y < 0.006, `${name} stands on its origin (its lowest point is at ${box.min.y.toFixed(4)})`);
    const middle = box.getCenter(new Vector3());
    assert.ok(Math.hypot(middle.x, middle.z) < 0.004, `${name} is centred over its origin (${fmt(middle)})`);
  }
});

test('each is about the size of the ball it took the place of: 0.12 to 0.16 m across, and no taller', () => {
  for (const name of NAMES) {
    const size = toppers.bounds(name).getSize(new Vector3());
    const across = Math.max(size.x, size.y, size.z);
    assert.ok(across >= 0.12 && across <= 0.162, `${name} is ${across.toFixed(3)} m across (${fmt(size)})`);
    assert.ok(size.y <= 0.162, `${name} is ${size.y.toFixed(3)} m tall, and has to fit under the name tag`);
    // A flat one is a slab facing +z, thick enough to see from the side as it turns; a round one is as deep as it's wide.
    if (ROUND.includes(name)) assert.ok(size.z > 0.1, `${name} is ${size.z.toFixed(3)} m deep, round`);
    else assert.ok(size.z >= 0.04 && size.z < 0.06 && size.z < size.x, `${name} is ${size.z.toFixed(3)} m thick, its face along z`);
  }
});

test('no two emblems have the same outline', () => {
  // Their bounds and their triangles, which two shapes drawn apart don't share.
  const marks = NAMES.map((name) => `${fmt(toppers.bounds(name).getSize(new Vector3()))} / ${toppers.trianglesOf(name)}`);
  assert.equal(new Set(marks).size, NAMES.length, `each is its own shape: ${marks.join(' | ')}`);
});

test('each keeps to a few hundred triangles, and the pack to a small file', () => {
  let all = 0;
  for (const name of NAMES) {
    const n = toppers.trianglesOf(name);
    all += n;
    assert.ok(n >= 40 && n <= 500, `${name}: ${n} triangles`);
  }
  assert.ok(all <= 3000, `the pack: ${all} triangles`);
});
