import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { assertInFootprint, fmt, kind, near, openPack } from './model-pack';

// whisky.glb (exported by blender/scripts/build_whisky.py) against what world/office/furniture-whisky.ts
// and features/whisky count on: the cabinet as one root standing on the floor at the origin, facing +z
// inside the footprint shared/furniture.ts gives the kind; the parts the pour moves, hung where the
// code looks for them with their origins where it moves them about (WHISKY_PARTS and WHISKY_SIZES); the
// materials it paints; and the label, the crest and the box's art mapped for their canvases, the right
// way round.

const FILE = new URL('../src/client/models/whisky.glb', import.meta.url);
const pack = openPack('whisky');
const { nodes, byName, gltf } = pack;

/** Every part, and the part it hangs under. */
const PARTS: Record<string, string> = {
  whisky_label: 'whisky_cabinet',
  whisky_crest: 'whisky_cabinet',
  whisky_box_art: 'whisky_cabinet',
  whisky_decanter: 'whisky_cabinet',
  whisky_stopper: 'whisky_decanter',
  ...Object.fromEntries([0, 1, 2, 3].flatMap((i) => [[`whisky_glass_${i}`, 'whisky_cabinet'], [`whisky_glass_${i}_dram`, `whisky_glass_${i}`]])),
};
/** The materials furniture-whisky.ts paints: Body in the piece's own colour, and the canvases' three. */
const MATERIALS = ['Body', 'Dark', 'Brass', 'Silver', 'Gold', 'Stopper', 'Box', 'Whisky', 'Crystal', 'Cut', 'Glint', 'Label', 'Crest', 'Art'];
/** WHISKY_SIZES: the decanter's lip over its foot, and a glass's rim over its foot. */
const LIP = 0.226;
const RIM = 0.085;

/** Where a part's origin is in the model. */
const origin = (name: string) => pack.placed(byName(name)).at;
/** Every vertex of a part and of everything under it. */
const family = (name: string): Vector3[] => [name, ...Object.keys(PARTS).filter((p) => PARTS[p] === name).flatMap((p) => [p, ...Object.keys(PARTS).filter((q) => PARTS[q] === p)])].flatMap((n) => pack.vertices(n));

test('it is one cabinet, a root at the origin facing +z, with every part the pour moves hung where the code looks', () => {
  const roots = nodes.map((n, i) => (pack.parentOf.has(i) ? '' : (n.name ?? ''))).filter(Boolean);
  assert.deepEqual(roots, ['whisky_cabinet']);
  pack.assertPlaced(['whisky_cabinet']);
  for (const [part, parent] of Object.entries(PARTS)) {
    assert.ok(byName(part) >= 0, `a part called ${part}`);
    assert.equal(pack.parentName(byName(part)), parent, `${part} hangs under ${parent}`);
  }
});

test('its materials are the ones furniture-whisky.ts paints', () => {
  const names = pack.materials();
  for (const m of MATERIALS) assert.ok(names.includes(m), `a material called ${m}`);
  for (const m of names) assert.ok(MATERIALS.includes(m), `${m} isn't a material the code knows (it would come out magenta)`);
  assert.deepEqual(pack.madeOf('whisky_label'), ['Label']);
  assert.deepEqual(pack.madeOf('whisky_crest'), ['Crest']);
  assert.deepEqual(pack.madeOf('whisky_box_art'), ['Art']);
  assert.ok(pack.madeOf('whisky_cabinet').includes('Body'), 'the sideboard is painted the piece\'s own colour');
});

test('it stands on the floor inside its footprint, its top where things stand on it and under its collider', () => {
  const k = kind('whisky-cabinet');
  const all = family('whisky_cabinet');
  assertInFootprint('the cabinet', all, k);
  const lowest = Math.min(...all.map((v) => v.y));
  assert.ok(near(lowest, 0, 0.002), `it stands on the floor (${lowest.toFixed(3)})`);
  const top = pack.bounds('whisky_cabinet', ['Body']);
  assert.ok(near(top.max.y, 0.8, 0.003), `the sideboard's top is ${top.max.y.toFixed(3)} up`);
  assert.ok(top.max.y < k.top, 'what you bump into reaches over it');
  assert.ok(near(top.max.x - top.min.x, 1.2) && near(top.max.z - top.min.z, 0.45), `it's ${fmt(top.getSize(new Vector3()))}`);
  // Its doors and pulls are at the front.
  const pulls = pack.bounds('whisky_cabinet', ['Brass']);
  assert.ok(pulls.max.z > 0.2, 'brass at the front');
});

test('the decanter turns about its foot, its lip where the pour starts, and its stopper comes off on its own', () => {
  const at = origin('whisky_decanter');
  const body = pack.bounds('whisky_decanter', ['Crystal']);
  assert.ok(near(body.min.y, at.y, 0.002), `its origin is under its foot (${fmt(at)} / ${body.min.y.toFixed(3)})`);
  assert.ok(near((body.min.x + body.max.x) / 2, at.x, 0.002) && near((body.min.z + body.max.z) / 2, at.z, 0.002), 'and under its middle');
  assert.ok(near(body.max.y - at.y, LIP, 0.002), `its lip is ${(body.max.y - at.y).toFixed(3)} over its foot`);
  const stopper = pack.bounds('whisky_stopper');
  assert.ok(near(stopper.min.y, origin('whisky_stopper').y - 0.006, 0.003) && stopper.min.y > at.y + LIP - 0.01, 'the stopper sits in its neck, its origin at the lip');
});

test('each glass stands on the tray, its rim where the pour aims, and the whisky fills it up from its floor', () => {
  const tray = pack.bounds('whisky_cabinet', ['Silver']);
  for (const i of [0, 1, 2, 3]) {
    const name = `whisky_glass_${i}`;
    const at = origin(name);
    const g = pack.bounds(name, ['Crystal']);
    assert.ok(near(g.min.y, at.y, 0.002) && at.y > 0.8 && at.y < tray.max.y, `${name} stands on the tray (${fmt(at)})`);
    assert.ok(near(g.max.y - at.y, RIM, 0.002), `${name}'s rim is ${(g.max.y - at.y).toFixed(3)} up`);
    const dram = pack.bounds(`${name}_dram`);
    const floor = origin(`${name}_dram`);
    assert.ok(near(dram.min.y, floor.y, 0.001), `the whisky in ${name} starts at its origin, so scaling it fills the glass`);
    assert.ok(dram.max.y < g.max.y && dram.max.y - floor.y > 0.025, 'a good dram, under the rim');
    assert.ok(Math.hypot(dram.min.x + dram.max.x - 2 * at.x, dram.min.z + dram.max.z - 2 * at.z) < 0.004, 'in the middle of the glass');
  }
});

/** The texture coordinates of a part, as the vertices are, from the .glb's binary chunk. */
function uvs(name: string): [number, number][] {
  const b = readFileSync(FILE);
  const json = 20 + b.readUInt32LE(12);
  const bin = b.subarray(json + 8, json + 8 + b.readUInt32LE(json));
  const views = (gltf as unknown as { bufferViews: { byteOffset?: number; byteStride?: number }[] }).bufferViews;
  const out: [number, number][] = [];
  for (const p of gltf.meshes[nodes[byName(name)].mesh!].primitives) {
    assert.ok(p.attributes.TEXCOORD_0 !== undefined, `${name} is UV mapped`);
    const a = gltf.accessors[p.attributes.TEXCOORD_0] as unknown as { bufferView: number; byteOffset?: number; count: number };
    const view = views[a.bufferView];
    const start = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
    for (let k = 0; k < a.count; k++) {
      const o = start + k * (view.byteStride ?? 8);
      out.push([bin.readFloatLE(o), bin.readFloatLE(o + 4)]);
    }
  }
  return out;
}

test('the label and the crest go round the front of the bottle, mapped left to right and the canvas\'s top at the top', () => {
  for (const name of ['whisky_label', 'whisky_crest']) {
    const vs = pack.vertices(name);
    const uv = uvs(name);
    assert.equal(uv.length, vs.length);
    const box = pack.bounds(name);
    const mid = (box.min.x + box.max.x) / 2;
    // Facing +z: all of it in front of the bottle's middle (z 0), its middle right at the front of the glass.
    assert.ok(box.min.z > 0 && box.max.z > 0.05, `${name} faces forward (${box.min.z.toFixed(3)} to ${box.max.z.toFixed(3)})`);
    // u runs from its left edge to its right as you face it; v from the canvas's top (glTF's 0) down.
    const left = vs.reduce((m, v, i) => (v.x < vs[m].x ? i : m), 0);
    const right = vs.reduce((m, v, i) => (v.x > vs[m].x ? i : m), 0);
    assert.ok(uv[left][0] < 0.05 && uv[right][0] > 0.95, `${name}: u ${uv[left][0].toFixed(2)} at the left, ${uv[right][0].toFixed(2)} at the right`);
    const top = vs.reduce((m, v, i) => (v.y > vs[m].y ? i : m), 0);
    const bottom = vs.reduce((m, v, i) => (v.y < vs[m].y ? i : m), 0);
    assert.ok(uv[top][1] < 0.01 && uv[bottom][1] > 0.99, `${name}: v ${uv[top][1].toFixed(2)} at the top, ${uv[bottom][1].toFixed(2)} at the foot`);
    assert.ok(Math.abs(mid - -0.07) < 0.03, `${name} is on the bottle`);
  }
});

test('the box\'s art wraps its left side, its front and its right side in one strip', () => {
  const uv = uvs('whisky_box_art');
  assert.equal(uv.length, 12, 'three faces');
  const us = [...new Set(uv.map(([u]) => +u.toFixed(3)))].sort((a, b) => a - b);
  assert.deepEqual(us, [0, 0.314, 0.686, 1], 'a side, the front, a side: 0.11, 0.13 and 0.11 of 0.35 round');
});

test('it keeps to its triangle budget', () => {
  const total = Object.keys(PARTS).concat('whisky_cabinet').reduce((n, p) => n + pack.trianglesOf(p), 0);
  assert.ok(total <= 6000, `${total} triangles`);
});
