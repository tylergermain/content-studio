import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { assertInFootprint, fmt, kind, near, openPack } from './model-pack';

// whisky.glb (exported by blender/scripts/build_whisky.py) against what world/office/furniture-whisky.ts
// and features/whisky count on: the cabinet as one root standing on the floor at the origin, facing +z
// inside the footprint shared/furniture.ts gives the kind; the parts the pour moves, hung where the
// code looks for them with their origins where it moves them about (WHISKY_PARTS and WHISKY_SIZES); the
// materials it paints; the decanter's cut panels and bevels; the bottle's whisky up to its shoulders
// under clear glass, with its surface its own; and the bottle's wrap, the crest and the box's art
// mapped for their canvases, the right way round.

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
  whisky_decanter_whisky: 'whisky_decanter',
  ...Object.fromEntries([0, 1, 2, 3].flatMap((i) => [[`whisky_glass_${i}`, 'whisky_cabinet'], [`whisky_glass_${i}_dram`, `whisky_glass_${i}`]])),
};
/** The materials furniture-whisky.ts paints: Body in the piece's own colour, and the canvases' three. */
const MATERIALS = ['Body', 'Dark', 'Brass', 'Silver', 'Stopper', 'Box', 'Whisky', 'WhiskyTop', 'Crystal', 'Cut', 'Glint', 'Sheen', 'Label', 'Crest', 'Art'];
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
  // The whisky in it is a part of its own (the office pours with a level one of its own), with its origin
  // at the decanter's, and comes about half way up, so there's glass to see over it. No streak of light
  // on it (through the whisky it read as a crack): light lies on whole panels (Sheen).
  assert.deepEqual(pack.madeOf('whisky_decanter'), ['Crystal', 'Cut', 'Sheen']);
  assert.deepEqual(pack.madeOf('whisky_decanter_whisky'), ['Whisky']);
  assert.ok(origin('whisky_decanter_whisky').distanceTo(at) < 0.001, 'the whisky turns with the decanter, about its foot');
  const whisky = pack.bounds('whisky_decanter_whisky');
  assert.ok(whisky.max.y - at.y < 0.1 && whisky.max.y - at.y > 0.06, `the decanter is about half full (${(whisky.max.y - at.y).toFixed(3)} up)`);
  assert.ok(whisky.max.x < body.max.x && whisky.min.x > body.min.x, 'inside the glass');
});

test('the decanter is cut: eight flat panels round it, a narrow bevel between each two, and light on a couple of them', () => {
  const at = origin('whisky_decanter');
  // Round the top of its body (where its shoulders start), which way each corner of a panel and of a bevel is from its middle.
  const round = (mats: string[]) =>
    [...new Set(pack.vertices('whisky_decanter', mats).filter((v) => Math.abs(v.y - at.y - 0.13) < 0.001).map((v) => Math.round((Math.atan2(v.x - at.x, v.z - at.z) * 180) / Math.PI + 360) % 360))].sort((a, b) => a - b);
  const corners = round(['Crystal']);
  assert.equal(corners.length, 16, `eight panels, two edges each (${corners})`);
  const gaps = corners.map((a, i) => (corners[(i + 1) % corners.length] - a + 360) % 360);
  assert.ok(gaps.every((g, i) => Math.abs(g - (i % 2 === 0 ? 7.5 : 37.5)) < 1.01) || gaps.every((g, i) => Math.abs(g - (i % 2 === 0 ? 37.5 : 7.5)) < 1.01), `wide panels and narrow bevels by turns (${gaps})`);
  assert.deepEqual(round(['Cut']), corners, 'the bevels are cut between the panels\' edges');
  // One of them faces the front: its edges either side of it.
  assert.ok(corners.includes(19) && corners.includes(341), `a panel facing the front (${corners})`);
  // The light on its panels lies on them, a hair out from the glass.
  const sheen = pack.bounds('whisky_decanter', ['Sheen']);
  const body = pack.bounds('whisky_decanter', ['Crystal']);
  assert.ok(sheen.min.y > body.min.y && sheen.max.y < body.max.y, 'on its body and shoulders');
  for (const v of pack.vertices('whisky_decanter', ['Sheen'])) {
    const out = Math.hypot(v.x - at.x, v.z - at.z);
    assert.ok(out > 0.015 && out < 0.0625, `just over a panel (${out.toFixed(4)} out)`);
  }
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
    // No streak of light on a glass: on one that small it read as a straw standing in it.
    assert.deepEqual(pack.madeOf(name), ['Crystal', 'Cut'], `${name} is crystal, with no glint`);
  }
});

test('the bottle\'s whisky comes up to its shoulders, with clear glass over it', () => {
  // The root's own crystal and whisky are the bottle's (the decanter's and the glasses' are parts of their own).
  const glass = pack.bounds('whisky_cabinet', ['Crystal']);
  const whisky = pack.bounds('whisky_cabinet', ['Whisky']);
  const tall = glass.max.y - glass.min.y;
  const shoulder = glass.min.y + tall * (0.741 / 0.9);
  assert.ok(whisky.max.y <= shoulder + 0.002 && whisky.max.y > shoulder - 0.01, `the whisky stops at the shoulder (${whisky.max.y.toFixed(3)}, the shoulder ${shoulder.toFixed(3)})`);
  assert.ok(glass.max.y - whisky.max.y > 0.05, 'and the shoulders and the neck are clear glass');
  const wrap = pack.bounds('whisky_label');
  assert.ok(whisky.max.y - wrap.max.y > 0.04, 'the whisky shows over the wrap');
  // Its surface is its own (a lighter gold), level at the top of it, and in from the glass so the glass shows round it.
  const top = pack.bounds('whisky_cabinet', ['WhiskyTop']);
  assert.ok(near(top.min.y, whisky.max.y, 0.0005) && near(top.max.y, whisky.max.y, 0.0005), `its surface is level at the top (${top.min.y.toFixed(4)}..${top.max.y.toFixed(4)})`);
  assert.ok(top.max.x - top.min.x < glass.max.x - glass.min.x - 0.012, 'in from the glass');
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

/** The vertex of `vs` that's most `by`. */
const most = (vs: Vector3[], by: (v: Vector3) => number) => vs.reduce((m, v, i) => (by(v) > by(vs[m]) ? i : m), 0);

test('the bottle\'s wrap goes all the way round it, from the back, its middle at the front and the canvas\'s top at the top', () => {
  const vs = pack.vertices('whisky_label');
  const uv = uvs('whisky_label');
  assert.equal(uv.length, vs.length);
  const box = pack.bounds('whisky_label');
  assert.ok(box.min.z < -0.05 && box.max.z > 0.05 && box.max.x - box.min.x > 0.1, `it wraps the bottle (${fmt(box.getSize(new Vector3()))})`);
  assert.ok(Math.abs((box.min.x + box.max.x) / 2 - -0.07) < 0.003, 'round the bottle');
  // u from the back round the left (0.25), the front (0.5) and the right (0.75) as you face it: the
  // cream label is painted in the canvas's middle, so it's at the front.
  const front = most(vs, (v) => v.z);
  const left = most(vs, (v) => -v.x);
  const right = most(vs, (v) => v.x);
  assert.ok(Math.abs(uv[front][0] - 0.5) < 0.03, `u ${uv[front][0].toFixed(2)} at the front`);
  assert.ok(Math.abs(uv[left][0] - 0.25) < 0.03 && Math.abs(uv[right][0] - 0.75) < 0.03, `u ${uv[left][0].toFixed(2)} at the left, ${uv[right][0].toFixed(2)} at the right`);
  const us = uv.map(([u]) => u);
  assert.ok(Math.min(...us) < 0.001 && Math.max(...us) > 0.999, 'the whole canvas, round to the seam at the back');
  const top = most(vs, (v) => v.y);
  const bottom = most(vs, (v) => -v.y);
  assert.ok(uv[top][1] < 0.01 && uv[bottom][1] > 0.99, `v ${uv[top][1].toFixed(2)} at the top, ${uv[bottom][1].toFixed(2)} at the foot`);
});

test('the crest goes round the front of the bottle, mapped left to right and the canvas\'s top at the top', () => {
  const name = 'whisky_crest';
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
});

test('the box\'s art wraps its left side, its front and its right side in one strip', () => {
  const uv = uvs('whisky_box_art');
  assert.equal(uv.length, 12, 'three faces');
  const us = [...new Set(uv.map(([u]) => +u.toFixed(3)))].sort((a, b) => a - b);
  assert.deepEqual(us, [0, 0.314, 0.686, 1], 'a side, the front, a side: 0.11, 0.13 and 0.11 of 0.35 round');
});

test('it keeps to its triangle budget', () => {
  const total = Object.keys(PARTS).concat('whisky_cabinet').reduce((n, p) => n + pack.trianglesOf(p), 0);
  assert.ok(total <= 4500, `${total} triangles`);
});
