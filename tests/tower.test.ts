import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { FLOOR, SLAB, STOREY, WALL_HEIGHT, WALL_T, streetBelow } from '../src/shared/layout.js';
import { MAX_FLOORS } from '../src/shared/floors.js';
import { TOWER, setStoreys } from '../src/client/world/facade.js';
import type { NightParts } from '../src/client/world/outside.js';
import { buildTower } from '../src/client/world/tower.js';
import { barOf, buildTowerBars, spanOf } from '../src/client/world/tower-bars.js';
import type { Collider } from '../src/client/world/types.js';

// The rest of the building from outside (world/tower.ts) and the three bars of glass over the real
// floors (world/tower-bars.ts), built and measured: the bars stand where TOWER puts them, each storey
// within its own bar's span; a seam goes round a bar's foot only while that storey is drawn; about a
// third of the bars' bays are lit at night; the roof and its mast are at the tower's full height
// whatever the floors; and redrawing the tower never adds to what the sky lights.

// The signs on the tower are painted on canvases: a 2D context that measures and draws nothing is
// all they need here, and a lockup picture that won't load.
function canvas() {
  const c = { width: 0, height: 0, getContext: () => g };
  const g: object = new Proxy({}, {
    get: (_, k) => (k === 'canvas' ? c : k === 'measureText' ? (s: string) => ({ width: s.length * 10, actualBoundingBoxAscent: 10, actualBoundingBoxDescent: 0 }) : () => {}),
    set: () => true,
  });
  return c;
}
(globalThis as { document?: unknown }).document ??= { createElement: canvas };
(globalThis as { Image?: unknown }).Image ??= class {
  onerror?: () => void;
  set src(_: string) {
    queueMicrotask(() => this.onerror?.());
  }
};

const B = { minX: FLOOR.minX - WALL_T, maxX: FLOOR.maxX + WALL_T, minZ: FLOOR.minZ - WALL_T, maxZ: FLOOR.maxZ + WALL_T };
const nightParts = () => ({ bulbs: [], halos: [], lamps: [], windows: [], glows: [], street: 0 }) as unknown as NightParts;
const counts = (n: NightParts) => [n.bulbs.length, n.halos.length, n.lamps.length, n.windows.length, n.glows.length].join();
const LOOKS = [
  { name: 'Friday Labs', accent: '#09ca59' },
  { name: 'AI Innovators', accent: '#0080fe' },
  { name: 'Content', accent: '#218cff' },
];

/** Storey `k` of the bars, drawn alone, over `count` real floors: its meshes and their boxes. */
function storey(k: number, count = 3) {
  const night = nightParts();
  const bars = buildTowerBars(night);
  const parts = new THREE.Group();
  bars.storey(parts, k, 0, count);
  parts.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  parts.traverse((o) => (o as THREE.Mesh).isMesh && meshes.push(o as THREE.Mesh));
  return { night, meshes, box: (m: THREE.Mesh) => new THREE.Box3().setFromObject(m) };
}

test('the bars are stacked in order, up to the tower’s height, and inside the roof city’s plaza', () => {
  assert.equal(TOWER.bars[0].from, 3);
  for (let i = 1; i < TOWER.bars.length; i++) assert.equal(TOWER.bars[i].from, TOWER.bars[i - 1].to);
  assert.equal(TOWER.bars[TOWER.bars.length - 1].to, TOWER.storeys);
  assert.ok(TOWER.storeys <= MAX_FLOORS - 1);
  for (const b of TOWER.bars) assert.ok(b.minX >= -22 && b.maxX <= 22, 'the roof city keeps x -22..22 for the building');
  // The top bar is the whole plate: the rooftop bar needs all of it.
  const top = TOWER.bars[TOWER.bars.length - 1];
  assert.deepEqual([top.minX, top.maxX], [B.minX, B.maxX]);
  // A real floor is the building's width wherever it is; a drawn one is its bar's.
  assert.deepEqual(spanOf(4, 3), { minX: TOWER.bars[0].minX, maxX: TOWER.bars[0].maxX });
  assert.deepEqual(spanOf(4, 5), { minX: B.minX, maxX: B.maxX });
  assert.deepEqual(spanOf(1, 1), { minX: B.minX, maxX: B.maxX });
});

test('each drawn storey stands within its bar, round all four sides of it', () => {
  for (let k = TOWER.bars[0].from; k < TOWER.storeys; k++) {
    const bar = barOf(k)!;
    const { meshes, box } = storey(k);
    const all = new THREE.Box3();
    // Over its foot (where the roof over a wider storey under it goes), only the storey itself.
    for (const m of meshes) {
      const b = box(m);
      if (b.min.y > 0.05) all.union(b);
    }
    assert.ok(Math.abs(all.min.x - bar.minX) < 0.05 && Math.abs(all.max.x - bar.maxX) < 0.05, `storey ${k} spans x ${all.min.x}..${all.max.x}`);
    assert.ok(Math.abs(all.min.z - B.minZ) < 0.05 && Math.abs(all.max.z - B.maxZ) < 0.05, `storey ${k} spans z ${all.min.z}..${all.max.z}`);
    assert.ok(all.max.y <= WALL_HEIGHT + 1e-6, `storey ${k} goes up to ${all.max.y}`);
  }
});

test('a seam goes round a bar’s foot while that storey is drawn, and nowhere else', () => {
  for (const count of [1, 3, 4, 8]) {
    for (let k = Math.max(count, TOWER.bars[0].from); k < TOWER.storeys; k++) {
      const { night, meshes, box } = storey(k, count);
      const line = night.bulbs[0].mat;
      const lit = meshes.filter((m) => m.material === line);
      const foot = barOf(k)!.from === k;
      assert.equal(lit.length > 0, foot, `storey ${k} of ${count} real floors ${foot ? 'has no' : 'has a'} seam`);
      if (!foot) continue;
      assert.equal(lit.length, 4, 'one line on each side');
      for (const m of lit) {
        const b = box(m);
        assert.ok(b.min.y >= -TOWER.seam.below - 1e-6 && b.max.y <= -TOWER.seam.below + TOWER.seam.height + 1e-6, 'within the seam');
      }
    }
  }
});

test('about a third of the bars’ bays light up at night', () => {
  let lit = 0;
  let all = 0;
  for (let k = TOWER.bars[0].from; k < TOWER.storeys; k++) {
    const { night, meshes } = storey(k);
    const glowing = new Set<THREE.Material>(night.windows);
    for (const m of meshes) {
      if (!(m.geometry instanceof THREE.PlaneGeometry) || m.geometry.parameters.height < 2) continue;
      all++;
      if (glowing.has(m.material as THREE.Material)) lit++;
    }
  }
  assert.ok(all > 1000, `${all} bays`);
  assert.ok(lit / all > 0.25 && lit / all < 0.45, `${((100 * lit) / all).toFixed(0)}% lit`);
});

test('the sky’s indoor light and clear air stay off the bars, by the names it goes by', () => {
  // The bars' materials take those two out of their shaders by name (outdoors in tower-bars.ts).
  assert.ok(readFileSync(new URL('../src/client/world/sky.ts', import.meta.url), 'utf8').includes('skyInOffice( vSkyWorld )'));
  assert.ok(readFileSync(new URL('../src/client/world/haze.ts', import.meta.url), 'utf8').includes('skyIndoors( vSkyFogAt )'));
  const { meshes } = storey(5);
  const shader = { fragmentShader: 'float a = skyInOffice( vSkyWorld ); if ( b && skyIndoors( vSkyFogAt ) ) {}', vertexShader: '', uniforms: {} };
  (meshes[0].material as THREE.Material).onBeforeCompile(shader as never, {} as never);
  assert.equal(shader.fragmentShader, 'float a = 0.0; if ( b && false ) {}');
});

test('the tower is TOWER.storeys tall whatever the floors, with the mast and its beacon on top', () => {
  setStoreys(LOOKS);
  const night = nightParts();
  const colliders: Collider[] = [];
  const tower = buildTower(colliders, night);
  const top = (index: number, count: number) => {
    tower.set(index, count, Array(count).fill(0));
    tower.group.updateMatrixWorld(true);
    return new THREE.Box3().setFromObject(tower.group);
  };
  for (const [index, count] of [[0, 3], [2, 3], [0, 1], [3, 4]]) {
    const box = top(index, count);
    const street = streetBelow(index);
    // The beacon's top: the roof deck at 15 storeys, a storey of housing and a 14 m mast.
    const beacon = box.max.y - street;
    assert.ok(Math.abs(beacon - (-streetBelow(TOWER.storeys) + STOREY + 14 + 0.2 + 0.32)) < 0.01, `beacon at ${beacon.toFixed(2)} m`);
    assert.ok(beacon > 130 && beacon < 133);
    assert.ok(box.min.x >= -20.75 && box.max.x <= B.maxX + 0.5, `x ${box.min.x}..${box.max.x}`);
  }
  // Sixteen floors: the roof's a storey higher.
  const box = top(0, MAX_FLOORS);
  assert.ok(Math.abs(box.max.y - streetBelow(0) - (-streetBelow(MAX_FLOORS) + STOREY + 14 + 0.52)) < 0.01);
  // Up on the roof there's no top drawn: the roof's its own.
  const roof = top(TOWER.storeys, 3);
  assert.ok(roof.max.y < 0, `the roof sees it below: up to ${roof.max.y}`);
  assert.ok(Math.abs(roof.min.y - (-TOWER.storeys * STOREY - SLAB)) < 0.05, `down to the bottom floor's slab: ${roof.min.y}`);
});

test('redrawing the tower adds nothing to what the sky lights, and keeps its colliders to the floors below', () => {
  setStoreys(LOOKS);
  const night = nightParts();
  const colliders: Collider[] = [];
  const tower = buildTower(colliders, night);
  const all = [[0, 3], [1, 3], [2, 3], [15, 3], [3, 4], [0, 1]];
  // The first time a storey has a name its sign is lit (tower-signs.ts); after that, nothing more.
  for (const [index, count] of all) tower.set(index, count, [1, 0, 2, 0].slice(0, count));
  const before = counts(night);
  for (const [index, count] of [...all, ...all]) tower.set(index, count, [1, 0, 2, 0].slice(0, count));
  assert.equal(counts(night), before);
  // On the middle floor: the walls down to the garage and the slab over it, and the back offices' posts.
  tower.set(1, 3, [1, 0, 0]);
  const walls = colliders.filter((c) => c.top === -SLAB || c.top === -STOREY);
  assert.equal(walls.length, 5);
  assert.ok(colliders.every((c) => c.top <= 0 || c.bottom === undefined || c.bottom < 0), 'nothing to bump into over the floor you’re on');
  tower.set(0, 3, [0, 0, 0]);
  assert.equal(colliders.length, 0);
});
