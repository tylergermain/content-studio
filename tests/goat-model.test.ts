import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { openModel } from './glb';

// goat.glb (exported by blender/scripts/build_goat.py) against what features/goat/world.ts counts on: the
// parts it turns, by name, each hung where the code expects it with its origin at its joint; the materials
// it paints; and a goat the office was laid out for, about the dog's size but taller at the shoulder.

const goat = openModel('goat');
const { gltf, nodes, byName } = goat;
const at = (name: string) => goat.placed(byName(name)).at;
const fmt = (v: Vector3) => v.toArray().map((n) => n.toFixed(3)).join(', ');

/** GOAT_PARTS in world.ts: every part and what it hangs from. */
const PARTS: Record<string, string | undefined> = {
  goat: undefined,
  goat_neck: 'goat',
  goat_head: 'goat_neck',
  goat_bell: 'goat_neck',
  goat_beard: 'goat_head',
  goat_ear_l: 'goat_head',
  goat_ear_r: 'goat_head',
  goat_eye_l: 'goat_head',
  goat_eye_r: 'goat_head',
  goat_tail: 'goat',
  ...Object.fromEntries(['fl', 'fr', 'bl', 'br'].flatMap((l) => [[`goat_leg_${l}`, 'goat'], [`goat_shin_${l}`, `goat_leg_${l}`]])),
};
/** PAINT in world.ts. */
const MATERIALS = ['Coat', 'Patch', 'Beard', 'Horn', 'Hoof', 'Muzzle', 'Eye', 'Ink', 'Shine', 'Collar', 'Bell'];

type Primitive = { attributes: Record<string, number>; material?: number };
const materialsOf = (name: string) => [...new Set(((gltf.meshes[nodes[byName(name)].mesh ?? -1]?.primitives ?? []) as Primitive[]).map((p) => gltf.materials?.[p.material ?? -1]?.name ?? ''))].sort();
/** A part's own bounds where it stands in the model (not its children's). */
function boundsOf(name: string) {
  const i = byName(name);
  const m = goat.worldMatrix(i);
  const lo = new Vector3(Infinity, Infinity, Infinity);
  const hi = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const p of gltf.meshes[nodes[i].mesh!].primitives) {
    const a = gltf.accessors[p.attributes.POSITION];
    for (const x of [a.min![0], a.max![0]]) for (const y of [a.min![1], a.max![1]]) for (const z of [a.min![2], a.max![2]]) {
      const v = new Vector3(x, y, z).applyMatrix4(m);
      lo.min(v);
      hi.max(v);
    }
  }
  return { lo, hi };
}

test('it is the parts the code turns, each by name and hung from the part it moves with, and nothing else', () => {
  const names = nodes.map((n) => n.name ?? '');
  assert.deepEqual([...names].sort(), Object.keys(PARTS).sort());
  for (const [name, parent] of Object.entries(PARTS)) {
    const i = byName(name);
    assert.equal(goat.parentName(i), parent, `${name} hangs from ${parent ?? 'nothing'}`);
    assert.ok(nodes[i].mesh !== undefined, `${name} has a shape`);
    const { turn } = goat.placed(i);
    assert.ok(Math.abs(turn.w) > 0.9999, `${name} isn't turned at rest, so a turn about its x is a turn about his`);
  }
  assert.equal(gltf.skins, undefined, 'no skeleton: the code turns the parts themselves');
  assert.equal(goat.clips().length, 0, 'and no clips');
});

test('its materials are the ones the code paints, and only those', () => {
  const names = goat.materials();
  for (const m of MATERIALS) assert.ok(names.includes(m), `a material called ${m}`);
  for (const m of names) assert.ok(MATERIALS.includes(m), `${m} isn't a material the code knows (it would come out magenta)`);
  // White and tan, with the bits that make him a goat each in their own.
  assert.deepEqual(materialsOf('goat'), ['Coat', 'Patch']);
  assert.deepEqual(materialsOf('goat_head'), ['Coat', 'Horn', 'Ink', 'Muzzle', 'Patch']);
  assert.deepEqual(materialsOf('goat_beard'), ['Beard']);
  assert.deepEqual(materialsOf('goat_neck'), ['Coat', 'Collar']);
  assert.deepEqual(materialsOf('goat_bell'), ['Bell', 'Ink']);
  assert.deepEqual(materialsOf('goat_eye_l'), ['Eye', 'Ink', 'Shine']);
  for (const l of ['fl', 'fr', 'bl', 'br']) assert.deepEqual(materialsOf(`goat_shin_${l}`), ['Hoof', 'Patch']);
});

test('standing on the floor at the origin, facing +z, about the dog\'s size but taller at the shoulder', () => {
  const box = goat.bounds();
  assert.ok(at('goat').length() < 1e-6, `his root is at ${fmt(at('goat'))}`);
  assert.ok(Math.abs(box.min.y) < 0.01, `hooves at y ${box.min.y.toFixed(3)}, not 0`);
  // The dogs stand 0.69 to 0.78 to the tops of their heads, their shoulders about 0.3 up.
  assert.ok(box.max.y > 0.8 && box.max.y < 1, `${box.max.y.toFixed(3)} m to the tips of his horns`);
  assert.ok(at('goat_leg_fl').y >= 0.38 && at('goat_leg_fl').y < 0.5, `his shoulder is ${at('goat_leg_fl').y.toFixed(3)} up`);
  const size = box.getSize(new Vector3());
  assert.ok(size.z > 0.8 && size.z < 1.05, `${size.z.toFixed(3)} m long`);
  assert.ok(size.x < 0.5, `${size.x.toFixed(3)} m across, ears and all`);
  assert.ok(Math.abs(box.min.x + box.max.x) < 0.01, 'the same either side');
  assert.ok(box.max.z > -box.min.z, `reaches ${box.max.z.toFixed(3)} forward but ${(-box.min.z).toFixed(3)} back`);
  assert.ok(goat.triangles() < 12_000, `${goat.triangles()} triangles`);
});

test('every joint is where the part it turns meets the one it hangs from', () => {
  // Left is +x; each right part mirrors its left one.
  for (const [l, r] of [['goat_leg_fl', 'goat_leg_fr'], ['goat_leg_bl', 'goat_leg_br'], ['goat_shin_fl', 'goat_shin_fr'], ['goat_shin_bl', 'goat_shin_br'], ['goat_ear_l', 'goat_ear_r'], ['goat_eye_l', 'goat_eye_r']]) {
    assert.ok(at(l).x > 0.05, `${l} is on his left (+x)`);
    assert.ok(at(l).clone().multiply(new Vector3(-1, 1, 1)).distanceTo(at(r)) < 1e-4, `${r} mirrors ${l}`);
  }
  for (const l of ['fl', 'fr', 'bl', 'br']) {
    const leg = boundsOf(`goat_leg_${l}`);
    const shin = boundsOf(`goat_shin_${l}`);
    // A leg hangs from its joint, and its knee is where the upper part ends and the lower begins.
    assert.ok(leg.hi.y - at(`goat_leg_${l}`).y < 0.08, `goat_leg_${l} hangs from its origin`);
    assert.ok(Math.abs(at(`goat_shin_${l}`).y - leg.lo.y) < 0.06, `goat_shin_${l}'s origin is at the knee`);
    assert.ok(Math.abs(shin.lo.y) < 0.01, `goat_shin_${l} ends in a hoof on the floor`);
  }
  assert.ok(at('goat_leg_fl').z > 0.1 && at('goat_leg_bl').z < -0.1, 'front legs in front, back legs behind');
  // The neck rises forward from the shoulders to the head; the head is all in front of and above its joint.
  assert.ok(at('goat_head').y > at('goat_neck').y + 0.12 && at('goat_head').z > at('goat_neck').z, 'the neck leans forward and up');
  const head = boundsOf('goat_head');
  assert.ok(head.hi.z - at('goat_head').z > 0.2, 'his muzzle is out in front of his head\'s joint');
  assert.ok(head.hi.y > 0.85, 'his horns are the top of him');
  // His mouth is about half a meter ahead of his middle: where the server stands him to graze (MUZZLE in goat-plan.ts).
  assert.ok(Math.abs(head.hi.z - 0.55) < 0.06, `his nose is ${head.hi.z.toFixed(3)} ahead of him`);
  // The beard hangs from his chin, the bell from the front of his collar, the tail sticks up from his rump.
  const beard = boundsOf('goat_beard');
  assert.ok(beard.lo.y < at('goat_beard').y - 0.05 && beard.hi.y <= at('goat_beard').y + 0.04, 'the beard hangs down from its origin');
  const bell = boundsOf('goat_bell');
  assert.ok(bell.lo.y < at('goat_bell').y - 0.04 && at('goat_bell').z > at('goat_neck').z, 'the bell hangs in front of his neck');
  assert.ok(at('goat_tail').z < -0.25 && boundsOf('goat_tail').hi.y > at('goat_tail').y, 'the tail is at his rump, cocked up');
  // The ears flop out to the side and down from where they join his head.
  const ear = boundsOf('goat_ear_l');
  assert.ok(ear.hi.x > at('goat_ear_l').x + 0.06 && ear.lo.y < at('goat_ear_l').y - 0.05, 'his left ear hangs out and down');
});
