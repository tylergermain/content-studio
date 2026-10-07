import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FastOutlineEffect } from '../src/client/core/outline-effect.js';
import '../src/client/core/still-matrices.js';
import { buildTrees, wantTree } from '../src/client/core/ray-trees.js';
import { ownSet, ownSetIn, toon } from '../src/client/world/toon.js';

// The office drawn faster and looking the same (docs/code-layout.md, "Drawing fast"): the toon outline
// (core/outline-effect.ts), matrices worked out only for what moved (core/still-matrices.ts), rays through big
// meshes (core/ray-trees.ts), and the hands' and the dog's own copies of the shared toon materials (world/toon.ts).

/** A renderer as far as the outline effect goes: what each render saw, and the render list three would have kept. */
function renderer() {
  const seen: { scene: THREE.Object3D; clear: boolean; materials: Map<THREE.Mesh, THREE.Material | THREE.Material[]> }[] = [];
  const lists = new Map<THREE.Object3D, { opaque: { object: THREE.Object3D }[]; transmissive: { object: THREE.Object3D }[]; transparent: { object: THREE.Object3D }[] }>();
  const r = {
    autoClear: true,
    shadowMap: { enabled: true },
    renderLists: { get: (scene: THREE.Object3D) => lists.get(scene) ?? { opaque: [], transmissive: [], transparent: [] } },
    render(scene: THREE.Object3D, _camera: THREE.Camera) {
      const materials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
      scene.traverse((o) => (o as THREE.Mesh).isMesh && materials.set(o as THREE.Mesh, (o as THREE.Mesh).material));
      seen.push({ scene, clear: r.autoClear, materials });
    },
  };
  return { r, seen, lists };
}

const box = (mat: THREE.Material) => new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);

test("the outline effect draws the scene, then its outline over it without clearing what's drawn, and puts every material back", () => {
  const { r, seen } = renderer();
  const effect = new FastOutlineEffect(r as never, { defaultThickness: 0.0032 });
  const scene = new THREE.Scene();
  const a = box(toon('#ff0000'));
  const sign = box(new THREE.MeshBasicMaterial());
  sign.material.userData.outlineParameters = { visible: false };
  const hidden = new THREE.Group();
  hidden.visible = false;
  const inside = box(toon('#00ff00'));
  hidden.add(inside);
  scene.add(a, sign, hidden);
  const camera = new THREE.PerspectiveCamera();
  effect.render(scene, camera);
  assert.equal(seen.length, 2, 'the scene, then its outline');
  // Neither pass clears: the scene's sky color does, and the hands, drawn over it after, mustn't wipe it.
  assert.deepEqual(seen.map((s) => s.clear), [false, false]);
  const outline = seen[1].materials.get(a) as THREE.ShaderMaterial;
  assert.ok(outline.isShaderMaterial && outline.side === THREE.BackSide, 'drawn inside out for its outline');
  assert.equal((seen[1].materials.get(sign) as THREE.Material).visible, false, 'a sign has none');
  assert.equal(seen[1].materials.get(inside), inside.material, 'nothing under something hidden is touched');
  // Everything as it was, after.
  assert.equal(a.material, toon('#ff0000'));
  assert.equal(r.autoClear, true);
  assert.equal(r.shadowMap.enabled, true);
  // The same copy each frame, kept by the material it's of.
  effect.render(scene, camera);
  assert.equal(seen[3].materials.get(a), outline);
});

test("the outline effect swaps only what the scene's own render drew, when it has the list, and tidies away copies nothing uses", () => {
  const { r, seen, lists } = renderer();
  const effect = new FastOutlineEffect(r as never);
  const scene = new THREE.Scene();
  const drawn = box(toon('#123456'));
  const offscreen = box(toon('#654321'));
  scene.add(drawn, offscreen);
  lists.set(scene, { opaque: [{ object: drawn }, { object: drawn }], transmissive: [], transparent: [] });
  const camera = new THREE.PerspectiveCamera();
  effect.render(scene, camera);
  assert.ok((seen[1].materials.get(drawn) as THREE.Material).type === 'OutlineEffect');
  assert.equal(seen[1].materials.get(offscreen), offscreen.material, 'not drawn, not swapped');
  assert.equal(drawn.material, toon('#123456'), 'once only, and back');
  // A copy unused for two tidies (a couple of seconds' frames) goes.
  const copy = seen[1].materials.get(drawn) as THREE.Material;
  let disposed = false;
  copy.addEventListener('dispose', () => (disposed = true));
  lists.set(scene, { opaque: [{ object: offscreen }], transmissive: [], transparent: [] });
  for (let i = 0; i < 200; i++) effect.render(scene, camera);
  assert.ok(disposed);
});

test("a matrix is worked out again only when its object moved, and an object put somewhere new is placed under its new parent", () => {
  const a = new THREE.Group();
  const child = new THREE.Mesh();
  child.position.set(1, 0, 0);
  a.add(child);
  a.updateMatrixWorld();
  assert.equal(child.matrixWorld.elements[12], 1);
  // Nothing moved: nothing needs working out again.
  child.updateMatrix();
  assert.equal(child.matrixWorldNeedsUpdate, false);
  // It moves, and its parent moves: both show.
  child.position.x = 2;
  a.position.z = 5;
  a.updateMatrixWorld();
  assert.deepEqual([child.matrixWorld.elements[12], child.matrixWorld.elements[14]], [2, 5]);
  // Moved to another parent without moving itself: placed under the new one.
  const b = new THREE.Group();
  b.position.set(0, 10, 0);
  b.updateMatrixWorld();
  b.add(child);
  b.updateMatrixWorld();
  assert.deepEqual([child.matrixWorld.elements[12], child.matrixWorld.elements[13], child.matrixWorld.elements[14]], [2, 10, 0]);
  // Turned, scaled and pivoted, the same as three would have it.
  child.rotation.y = 0.5;
  child.scale.set(2, 2, 2);
  child.pivot = new THREE.Vector3(0.5, 0, 0);
  b.updateMatrixWorld();
  const want = new THREE.Mesh();
  want.position.copy(child.position);
  want.rotation.copy(child.rotation);
  want.scale.copy(child.scale);
  want.pivot = child.pivot.clone();
  b.add(want);
  b.updateMatrixWorld();
  assert.deepEqual([...child.matrixWorld.elements], [...want.matrixWorld.elements]);
});

test('a ray through a big mesh lands where it always did, with its tree', () => {
  const g = new THREE.PlaneGeometry(40, 40, 60, 60);
  const plain = new THREE.Mesh(g.clone(), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  const treed = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  for (const m of [plain, treed]) {
    m.rotation.x = -Math.PI / 2;
    m.updateMatrixWorld();
  }
  wantTree(treed);
  buildTrees();
  assert.ok(treed.geometry.boundsTree, 'it has a tree');
  assert.equal(treed.geometry.index, g.index, 'built to the side: the geometry is as it was');
  const ray = new THREE.Raycaster(new THREE.Vector3(3.3, 5, -7.1), new THREE.Vector3(0.1, -1, 0.05).normalize());
  const [a] = ray.intersectObject(plain);
  const [b] = ray.intersectObject(treed);
  assert.ok(a && b && a.point.distanceTo(b.point) < 1e-6 && a.faceIndex === b.faceIndex);
  // Its positions changed: its tree is made again before it's used.
  (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  wantTree(treed);
  assert.ok(!treed.geometry.boundsTree, "its old tree is gone");
  buildTrees();
  assert.ok(treed.geometry.boundsTree);
});

test("a skinned mesh and the hands get their own copies of the shared toon materials; anything else is its own already", () => {
  const shared = toon('#abcdef');
  const hands = ownSet(shared, 'hands');
  assert.notEqual(hands, shared);
  assert.equal(ownSet(shared, 'hands'), hands, 'one copy, kept');
  assert.notEqual(ownSet(shared, 'skinned'), hands);
  assert.ok(hands.color.equals(shared.color) && (hands as THREE.MeshToonMaterial).gradientMap === shared.gradientMap, 'looking the same');
  const own = new THREE.MeshBasicMaterial();
  assert.equal(ownSet(own, 'hands'), own);
  const scene = new THREE.Scene();
  const mug = box(shared);
  scene.add(mug);
  ownSetIn(scene, 'hands');
  assert.equal(mug.material, hands);
});

test('see-through glass seen from both sides is drawn in one pass where that looks the same: flat, or one even color over itself', async () => {
  const { sweepGlass } = await import('../src/client/features/perf/index.js');
  const glass = (geo: THREE.BufferGeometry, mat: THREE.Material) => new THREE.Mesh(geo, mat);
  const pane = new THREE.MeshToonMaterial({ transparent: true, side: THREE.DoubleSide });
  const bubble = new THREE.MeshToonMaterial({ transparent: true, side: THREE.DoubleSide });
  const frost = new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: false, color: '#ffffff' });
  const solid = new THREE.MeshToonMaterial({ side: THREE.DoubleSide });
  const scene = new THREE.Scene();
  scene.add(glass(new THREE.PlaneGeometry(2, 2), pane), glass(new THREE.SphereGeometry(1), bubble), glass(new THREE.BoxGeometry(1, 1, 1), frost), glass(new THREE.PlaneGeometry(), solid));
  sweepGlass(scene, new WeakMap());
  assert.equal(pane.forceSinglePass, true, 'a flat pane');
  assert.equal(bubble.forceSinglePass, false, 'a lit shape with depth keeps its two passes');
  assert.equal(frost.forceSinglePass, true, 'one even color, not hiding what is behind it');
  assert.equal(solid.forceSinglePass, false, 'nothing see-through is touched');
});

test('the bundle goes compressed to a browser that takes it, as the build made it', async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { PassThrough } = await import('node:stream');
  const { serveFile } = await import('../src/server/http/static.js');
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-static-'));
  try {
    const file = path.join(dir, 'main-abc.js');
    writeFileSync(file, 'plain');
    writeFileSync(`${file}.br`, 'brotli');
    writeFileSync(`${file}.gz`, 'gzip');
    const serve = (accept: string) =>
      new Promise<{ headers: Record<string, string>; body: string }>((done) => {
        const res = new PassThrough() as PassThrough & { writeHead(code: number, h: Record<string, string>): void; headers: Record<string, string> };
        let body = '';
        res.writeHead = (_code, h) => (res.headers = h);
        res.on('data', (c) => (body += c));
        res.on('end', () => done({ headers: res.headers, body }));
        serveFile(res as never, file, true, accept);
      });
    const br = await serve('gzip, deflate, br');
    assert.deepEqual([br.headers['content-encoding'], br.body, br.headers.vary], ['br', 'brotli', 'accept-encoding']);
    assert.equal(br.headers['content-type'], 'text/javascript; charset=utf-8');
    assert.deepEqual([(await serve('gzip')).body, (await serve('gzip')).headers['content-encoding']], ['gzip', 'gzip']);
    const plain = await serve('');
    assert.deepEqual([plain.body, plain.headers['content-encoding']], ['plain', undefined]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
