import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BAND, CELL, batchKey, materialKind, meshVeto, planBatches, regionKey, type MaterialFacts, type MeshFacts, type PartPlan } from '../src/client/world/batch/plan.js';
import { mergeParts, rangeOf } from '../src/client/world/batch/merge.js';
import { Batcher, DRAWN, materialFacts, meshFacts, type BatcherDeps } from '../src/client/world/batch/batcher.js';

// Static batching (world/batch): which meshes are drawn together and in which batch (plan.ts), how a
// batch's geometry is merged (merge.ts), and the batcher at work (batcher.ts): what it hides from the
// camera and what it leaves to rays, and what it does when something it batched moves.

const mat = (over: Partial<MaterialFacts> = {}): MaterialFacts => ({
  id: 'm1',
  type: 'MeshToonMaterial',
  visible: true,
  transparent: false,
  blending: 1,
  depthTest: true,
  depthWrite: true,
  colorWrite: true,
  wireframe: false,
  special: false,
  textured: false,
  vertexColors: false,
  glows: false,
  look: '0|',
  ...over,
});

const facts = (over: Partial<MeshFacts> = {}): MeshFacts => ({
  mesh: true,
  layers: 1,
  frustumCulled: true,
  renderOrder: 0,
  groupOrder: 0,
  hooked: false,
  kept: false,
  castShadow: true,
  receiveShadow: true,
  normals: true,
  uvs: true,
  colors: false,
  extra: false,
  ...over,
});

const part = (mesh: number, over: Partial<PartPlan> = {}): PartPlan => ({
  mesh,
  group: -1,
  kind: { key: 'plain|MeshToonMaterial|0|', plain: true },
  needsUv: false,
  hasUv: true,
  colored: false,
  castShadow: true,
  receiveShadow: true,
  region: '0,0,0',
  ...over,
});

test('a region is a cell CELL metres across and BAND high, by the middle of what is in it; anything bigger than a cell is in its kind\'s big region', () => {
  assert.equal(regionKey(1, 1, 1, 0.5), '0,0,0');
  assert.equal(regionKey(CELL + 0.1, BAND + 0.1, -0.1, 1), '1,1,-1');
  assert.equal(regionKey(-CELL - 0.1, -3.6, 2 * CELL, 2), '-2,-1,2', 'the street, below the office floor, is a band of its own');
  assert.equal(regionKey(0, 0, 0, 12), 'big');
});

test('a plain material batches whatever its colour; one with a picture only with itself; one that is see-through or drawn its own way never', () => {
  const plain = materialKind(mat());
  assert.deepEqual(plain, { key: 'plain|MeshToonMaterial|0|', plain: true });
  assert.deepEqual(materialKind(mat({ id: 'm2' })), plain, 'another toon of another colour is the same kind');
  assert.notDeepEqual(materialKind(mat({ look: '2|' })), plain, 'but not one drawn on both sides');
  assert.notDeepEqual(materialKind(mat({ type: 'MeshBasicMaterial' })), plain, 'nor an unlit one');
  assert.deepEqual(materialKind(mat({ textured: true })), { key: 'own|m1', plain: false });
  assert.deepEqual(materialKind(mat({ vertexColors: true })), { key: 'own|m1', plain: false }, 'one coloured by its vertices already keeps its own');
  assert.deepEqual(materialKind(mat({ type: 'MeshStandardMaterial' })), { key: 'own|m1', plain: false });
  assert.deepEqual(materialKind(mat({ glows: true })), { key: 'own|m1', plain: false }, 'a glow the sky turns up at dusk changes the merged mesh with it');
  for (const odd of [{ transparent: true }, { visible: false }, { blending: 2 }, { depthWrite: false }, { depthTest: false }, { colorWrite: false }, { wireframe: true }, { special: true }]) {
    assert.equal(materialKind(mat(odd)), null, JSON.stringify(odd));
  }
});

test('a mesh is batched only if it is a plain mesh on layer 0, culled, in no order of its own, drawing nothing of its own, with normals', () => {
  assert.equal(meshVeto(facts()), null);
  assert.ok(meshVeto(facts({ mesh: false })), 'skinned, instanced, a line, points or a sprite');
  assert.ok(meshVeto(facts({ kept: true })), 'userData.noBatch');
  assert.ok(meshVeto(facts({ layers: 1 | (1 << 3) })));
  assert.ok(meshVeto(facts({ frustumCulled: false })));
  assert.ok(meshVeto(facts({ renderOrder: 5 })));
  assert.ok(meshVeto(facts({ groupOrder: 1 })), 'under a group drawn in an order of its own');
  assert.ok(meshVeto(facts({ hooked: true })), 'onBeforeRender');
  assert.ok(meshVeto(facts({ normals: false })));
  assert.ok(meshVeto(facts({ extra: true })), 'morphs, skinning');
});

test('batches: a kind, its shadows and a region each; one mesh alone gains nothing; a multi-material mesh is all in or all out', () => {
  const plan = planBatches([
    part(0),
    part(1),
    // Alone in its region: left to draw itself.
    part(2, { region: '5,0,5' }),
    // Casts no shadow: a batch of its own.
    part(3, { castShadow: false }),
    part(4, { castShadow: false }),
    // A multi-material mesh: its odd part alone in its batch is batched anyway.
    part(5, { group: 0 }),
    part(5, { group: 1, kind: { key: 'own|wall', plain: false }, needsUv: true }),
    // One with a picture and no uvs can't be merged, so none of its parts are.
    part(6, { group: 0 }),
    part(6, { group: 1, kind: { key: 'own|sign', plain: false }, needsUv: true, hasUv: false }),
  ]);
  const meshesIn = (key: string) => plan.get(key)?.map((p) => p.mesh);
  assert.deepEqual(meshesIn(batchKey(part(0))), [0, 1, 5]);
  assert.deepEqual(meshesIn(batchKey(part(3, { castShadow: false }))), [3, 4]);
  assert.deepEqual(meshesIn(batchKey(part(5, { group: 1, kind: { key: 'own|wall', plain: false } }))), [5]);
  const all = [...plan.values()].flat().map((p) => p.mesh);
  assert.ok(!all.includes(2), 'alone in its region');
  assert.ok(!all.includes(6), 'a part that can\'t be merged keeps the whole mesh out');
});

test('merging: each part where its mesh stood, normals turned with it, a mirrored part turned back round, a plain part\'s colour in its vertices', () => {
  const box = new THREE.BoxGeometry(1, 1, 1);
  const a = new THREE.Matrix4().makeTranslation(10, 0, 0);
  const b = new THREE.Matrix4().compose(new THREE.Vector3(0, 5, 0), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2), new THREE.Vector3(2, 2, 2));
  const mirror = new THREE.Matrix4().makeScale(-1, 1, 1);
  const red = new THREE.Color(1, 0, 0);
  const blue = new THREE.Color(0, 0, 1);
  const whole = rangeOf(box, -1);
  assert.deepEqual(whole, { start: 0, count: 36 });
  assert.deepEqual(rangeOf(box, 2), { start: 12, count: 6 }, 'a group of a box: one face');
  const g = mergeParts(
    [
      { geometry: box, ...whole, matrix: a, color: red },
      { geometry: box, ...whole, matrix: b, color: blue },
      { geometry: box, ...rangeOf(box, 0), matrix: mirror, color: red },
    ],
    { uv: false, color: 'plain' },
  );
  assert.equal(g.index!.count, 36 + 36 + 6);
  assert.equal(g.attributes.position.count, 24 + 24 + 4, 'only the vertices each part uses');
  assert.equal(g.attributes.uv, undefined);
  const pos = g.attributes.position;
  const first = new THREE.Vector3().fromBufferAttribute(pos, 0);
  assert.deepEqual(first.toArray(), new THREE.Vector3().fromBufferAttribute(box.attributes.position, 0).applyMatrix4(a).toArray());
  const n = new THREE.Vector3().fromBufferAttribute(g.attributes.normal, 24);
  assert.ok(Math.abs(n.length() - 1) < 1e-6, 'normals still of unit length under a scale');
  const col = g.attributes.color;
  assert.deepEqual([col.getX(0), col.getY(0), col.getZ(0)], [1, 0, 0]);
  assert.deepEqual([col.getX(24), col.getY(24), col.getZ(24)], [0, 0, 1]);
  // The mirrored face: its first triangle's winding is reversed, so it still faces out.
  const idx = g.index!;
  const tri = (i: number) => [0, 1, 2].map((k) => new THREE.Vector3().fromBufferAttribute(pos, idx.getX(i + k)));
  const [p0, p1, p2] = tri(72);
  const facing = new THREE.Vector3().subVectors(p1, p0).cross(new THREE.Vector3().subVectors(p2, p0)).normalize();
  const normal = new THREE.Vector3().fromBufferAttribute(g.attributes.normal, idx.getX(72));
  assert.ok(facing.dot(normal) > 0.99, 'the triangle faces the way its normal does');
});

/** An office to batch: `n` boxes in a row under a root, a plane with a picture, a see-through pane, and the camera. */
function office(n = 4, more: Partial<BatcherDeps> = {}) {
  const scene = new THREE.Scene();
  const root = new THREE.Group();
  scene.add(root);
  const toon = (c: string) => new THREE.MeshToonMaterial({ color: c });
  const boxes = Array.from({ length: n }, (_, i) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), toon(i % 2 ? '#ff0000' : '#00ff00'));
    m.position.set(i, 0.5, 0);
    root.add(m);
    return m;
  });
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.5 }));
  root.add(pane);
  const camera = new THREE.PerspectiveCamera();
  let now = 0;
  let version = 'a';
  let paused = false;
  const batcher = new Batcher({ scene, camera, roots: () => [root], version: () => version, paused: () => paused, now: () => now, ...more });
  /** A frame: the batcher's tick, the scene's matrices, then the check three's render would run. */
  const frame = (ms = 100) => {
    now += ms;
    batcher.frame();
    scene.updateMatrixWorld();
    scene.onBeforeRender(undefined as never, scene, camera, null as never, undefined as never, undefined as never);
  };
  const settle = () => {
    for (let i = 0; i < 40; i++) frame();
  };
  return { scene, root, boxes, pane, camera, batcher, frame, settle, setVersion: (v: string) => (version = v), pause: (p: boolean) => (paused = p) };
}

const drawnBy = (camera: THREE.Camera, o: THREE.Object3D) => o.layers.test(camera.layers);

test('batched: the still meshes drawn as one by the camera, and still what a ray lands on', () => {
  const o = office();
  o.batcher.enable(true);
  o.settle();
  const s = o.batcher.stats();
  assert.equal(s.state, 'ready');
  assert.equal(s.batched, 4);
  assert.equal(s.batches, 1, 'red and green boxes in one batch, their colours in its vertices');
  assert.equal(s.passed['see-through'], 1);
  assert.ok(o.camera.layers.isEnabled(DRAWN));
  for (const b of o.boxes) assert.equal(drawnBy(o.camera, b), false, 'the camera passes the batched mesh by');
  assert.equal(drawnBy(o.camera, o.pane), true);
  const container = o.scene.getObjectByName('batches')!;
  const merged = container.children[0] as THREE.Mesh;
  assert.equal(drawnBy(o.camera, merged), true);
  assert.equal((merged.material as THREE.MeshToonMaterial).vertexColors, true);
  // A ray lands on the box itself (E, the VR trigger and the builder read what it hits), never on the batch.
  const ray = new THREE.Raycaster(new THREE.Vector3(2, 0.5, 5), new THREE.Vector3(0, 0, -1));
  const hit = ray.intersectObjects(o.scene.children, true)[0];
  assert.equal(hit?.object, o.boxes[2]);
  o.batcher.enable(false);
  for (const b of o.boxes) assert.equal(drawnBy(o.camera, b), true, 'off: every mesh draws itself again');
  assert.equal(o.scene.getObjectByName('batches'), undefined);
  assert.equal(o.camera.layers.isEnabled(DRAWN), false);
});

test('what moves while it is watched is never batched; what moves once batched draws itself from that frame, and its batch is merged again', () => {
  const o = office(5);
  o.batcher.enable(true);
  // The last box spins all the time.
  for (let i = 0; i < 40; i++) {
    o.boxes[4].rotation.y += 0.1;
    o.frame();
  }
  assert.equal(o.batcher.stats().state, 'ready');
  assert.equal(drawnBy(o.camera, o.boxes[4]), true, 'the spinning box draws itself');
  assert.equal(drawnBy(o.camera, o.boxes[0]), false);
  const before = o.batcher.stats().rebuilds;
  // A door opens: it moves, and is drawn where it is the same frame.
  o.boxes[1].position.y += 1;
  o.frame();
  assert.equal(drawnBy(o.camera, o.boxes[1]), true);
  assert.equal(o.batcher.stats().rebuilds, before + 1);
  const merged = o.scene.getObjectByName('batches')!.children[0] as THREE.Mesh;
  assert.equal(merged.geometry.index!.count, 3 * 36, 'three boxes left in it');
  // Hidden, or its material swapped: the same.
  o.boxes[2].visible = false;
  o.frame();
  assert.equal(drawnBy(o.camera, o.boxes[2]), true);
  (o.boxes[3].material as THREE.MeshToonMaterial).color.set('#0000ff');
  o.frame();
  assert.equal(drawnBy(o.camera, o.boxes[3]), true, 'a plain colour changed: it is in no batch now');
  o.batcher.enable(false);
});

test('a new floor, layout or room starts it over; the builder holds it off', () => {
  const o = office();
  o.batcher.enable(true);
  o.settle();
  const resets = o.batcher.stats().resets;
  o.setVersion('b');
  o.frame();
  assert.equal(o.batcher.stats().resets, resets + 1);
  assert.equal(o.batcher.stats().state, 'watching');
  for (const b of o.boxes) assert.equal(drawnBy(o.camera, b), true, 'everything draws itself while it watches afresh');
  o.settle();
  assert.equal(o.batcher.stats().state, 'ready');
  o.pause(true);
  o.frame();
  for (const b of o.boxes) assert.equal(drawnBy(o.camera, b), true, 'nothing batched while the builder is open');
  o.settle();
  assert.equal(o.batcher.stats().batches, 0);
  o.pause(false);
  o.settle();
  assert.equal(o.batcher.stats().batches, 1);
  o.batcher.enable(false);
});

test('a plain batch\'s own shader is compiled before any batch is built, once for each kind, on a stand-in with what a batch has', async () => {
  const warmed: THREE.Object3D[] = [];
  let compiled = () => {};
  const o = office(4, {
    warm: (probes) => {
      warmed.push(probes);
      return new Promise<void>((resolve) => (compiled = resolve));
    },
  });
  o.batcher.enable(true);
  o.settle();
  assert.equal(o.batcher.stats().state, 'warming');
  assert.equal(o.batcher.stats().batches, 0, 'nothing built while its shader compiles');
  for (const b of o.boxes) assert.equal(drawnBy(o.camera, b), true, 'and every mesh draws itself meanwhile');
  const probe = warmed[0].children[0] as THREE.Mesh;
  assert.equal(warmed[0].children.length, 1, 'one kind: the red and the green boxes are one plain toon');
  assert.equal((probe.material as THREE.MeshToonMaterial).vertexColors, true);
  compiled();
  await new Promise((resolve) => setImmediate(resolve));
  o.settle();
  assert.equal(o.batcher.stats().state, 'ready');
  const merged = o.scene.getObjectByName('batches')!.children[0] as THREE.Mesh;
  assert.equal(merged.material, probe.material, 'the batch is drawn with the material compiled');
  assert.deepEqual(Object.keys(merged.geometry.attributes).sort(), Object.keys(probe.geometry.attributes).sort(), 'and its geometry has what the stand-in had (three picks the shader by both)');
  // Another floor: the same kind needs no compiling again.
  o.setVersion('b');
  o.settle();
  assert.equal(o.batcher.stats().state, 'ready');
  assert.equal(warmed.length, 1);
  o.batcher.enable(false);
});

test('what batching reads of a material and of a mesh', () => {
  const toon = new THREE.MeshToonMaterial({ color: '#123456' });
  const f = materialFacts(toon);
  assert.equal(f.type, 'MeshToonMaterial');
  assert.equal(f.textured, false);
  assert.equal(f.special, false, 'the sky\'s own shader lines (on every material) are no reason to leave one out');
  assert.equal(materialKind(f)?.plain, true);
  toon.map = new THREE.Texture();
  assert.equal(materialFacts(toon).textured, true);
  toon.normalMap = new THREE.Texture();
  assert.equal(materialFacts(toon).special, true, 'a normal map needs tangents a merged mesh hasn\'t');
  const m = new THREE.Mesh(new THREE.BoxGeometry(), toon);
  assert.equal(meshVeto(meshFacts(m, false, 0)), null);
  const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(), toon, 2);
  assert.ok(meshVeto(meshFacts(inst, false, 0)));
  m.onBeforeRender = () => {};
  assert.ok(meshVeto(meshFacts(m, false, 0)));
});
