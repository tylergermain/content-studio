import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BALCONY, BALCONY_DOOR, ELEVATOR, ELEVATOR_FRONT, FLOOR, STOREY, STREET_Y, WALL_HEIGHT, WALL_T, WINDOWS, roofDrop } from '../src/shared/layout.js';
import { MAX_FLOORS } from '../src/shared/floors.js';
import { TOWER, setStoreys } from '../src/client/world/facade.js';
import type { NightParts } from '../src/client/world/outside.js';
import { buildTowerSigns } from '../src/client/world/tower-signs.js';
import { MAST, buildMast } from '../src/client/features/rooftop/mast.js';

// The building's signs (world/tower-signs.ts) and the roof's mast (features/rooftop/mast.ts), built
// as the tower builds them and measured: each real storey's name sits on its own south wall over its
// own floor, clear of that wall's windows and the balcony door; the lockup and the mark are where the
// plan puts them near the top of the tower, on drawn glass only, inside the roof city's plaza; nothing
// is lit twice over however often the tower's redrawn; and the mast stands on the elevator's housing
// with its beacon about 131 m over the street.

// The signs are painted on canvases, which is all they need of a page: a 2D context that measures
// every letter 10 px wide and draws nothing, and a lockup picture that won't load (so the drawn one's painted).
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
  onload?: () => void;
  onerror?: () => void;
  set src(_: string) {
    queueMicrotask(() => this.onerror?.());
  }
};

const B = { minX: FLOOR.minX - WALL_T, maxX: FLOOR.maxX + WALL_T, minZ: FLOOR.minZ - WALL_T, maxZ: FLOOR.maxZ + WALL_T };
const near = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) < 1e-6, `${what}: ${a} is not ${b}`);
const LOOKS = [
  { name: 'Friday Labs', accent: '#09ca59' },
  { name: 'AI Innovators', accent: '#0080fe' },
  { name: 'Content', accent: '#218cff' },
];

/** The signs drawn into a tower's parts from storey `index`, each picture as the box round it (names are the 1.6 m tall ones). */
function drawn(index: number, count: number, total: number = TOWER.storeys) {
  const night = { bulbs: [], halos: [], lamps: [], windows: [], glows: [], street: 0 } as unknown as NightParts;
  const signs = buildTowerSigns(night);
  const draw = () => {
    const parts = new THREE.Group();
    signs.draw(parts, index, count, total);
    parts.updateMatrixWorld(true);
    const pictures: THREE.Box3[] = [];
    const all: THREE.Box3[] = [];
    parts.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const box = new THREE.Box3().setFromObject(m);
      all.push(box);
      if ((m.material as THREE.MeshToonMaterial).map) pictures.push(box);
    });
    const names = pictures.filter((b) => Math.abs(b.max.y - b.min.y - 1.6) < 1e-6).sort((a, b) => a.min.y - b.min.y);
    const brand = pictures.filter((b) => !names.includes(b));
    return { names, brand, all };
  };
  return { night, draw };
}

test("each real storey's name is on its own south wall, over its own floor, clear of its windows and the balcony door", () => {
  setStoreys(LOOKS);
  const holes = [...WINDOWS.filter((o) => o.wall === 'south'), BALCONY_DOOR];
  for (let index = 0; index < LOOKS.length; index++) {
    const { names } = drawn(index, LOOKS.length).draw();
    assert.equal(names.length, LOOKS.length, `from storey ${index}`);
    names.forEach((b, k) => {
      const y0 = (k - index) * STOREY;
      near(b.min.y - y0, 1.0, `storey ${k}'s name's foot`);
      near(b.max.y - y0, 2.6, `storey ${k}'s name's top`);
      near(b.min.x, 4.3, `storey ${k}'s name's west end`);
      near(b.max.x, 16.7, `storey ${k}'s name's east end`);
      near(b.min.z, B.maxZ + 0.02, `storey ${k}'s name off its wall`);
      for (const o of holes) {
        const apart = o.u + o.width / 2 <= b.min.x || o.u - o.width / 2 >= b.max.x || o.y1 <= b.min.y - y0 || o.y0 >= b.max.y - y0;
        assert.ok(apart, `storey ${k}'s name meets the south opening at u ${o.u}`);
      }
    });
    assert.ok(BALCONY.maxX < names[0].min.x, 'the names start east of the balcony');
  }
});

test('a storey with no name has no sign, and redrawing the tower lights nothing twice', () => {
  setStoreys([LOOKS[0], { name: ' ', accent: '#0080fe' }, LOOKS[2]]);
  const { night, draw } = drawn(0, 3);
  assert.equal(draw().names.length, 2);
  const lit = night.windows.length;
  // The lockup and the mark, and a name for each storey that has one.
  assert.equal(lit, 2 + 2);
  draw();
  setStoreys(LOOKS);
  assert.equal(draw().names.length, 3);
  assert.equal(night.windows.length, lit + 1, 'only the newly named storey adds a sign');
  draw();
  assert.equal(night.windows.length, lit + 1);
});

test("the lockup is 30 by 8 on the top bar's south and north faces from 100.3 to 108.3 m over the street, the mark alone 8 square on its ends", () => {
  setStoreys(LOOKS);
  for (const index of [0, 2, TOWER.storeys]) {
    const { brand } = drawn(index, 3).draw();
    assert.equal(brand.length, 4, `from storey ${index}`);
    const street = STREET_Y - index * STOREY;
    for (const b of brand) {
      near(b.min.y - street, 100.3, 'its foot over the street');
      near(b.max.y - street, 108.3, 'its top over the street');
    }
    const [south, north] = [brand.find((b) => b.min.z > B.maxZ)!, brand.find((b) => b.max.z < B.minZ)!];
    const [east, west] = [brand.find((b) => b.min.x > B.maxX)!, brand.find((b) => b.max.x < B.minX)!];
    for (const b of [south, north]) {
      near(b.min.x, -15, 'the lockup west end');
      near(b.max.x, 15, 'the lockup east end');
    }
    for (const b of [east, west]) {
      near(b.min.z, -4, 'the mark north edge');
      near(b.max.z, 4, 'the mark south edge');
    }
    near(south.min.z - B.maxZ, 0.4, 'the south panel out from the face');
    near(B.minZ - north.max.z, 0.4, 'the north panel out from the face');
    near(east.min.x - B.maxX, 0.4, 'the east panel out from the face');
    near(B.minX - west.max.x, 0.4, 'the west panel out from the face');
  }
  // All of it on the top bar: over its foot and under the roof.
  const top = TOWER.bars[TOWER.bars.length - 1];
  assert.equal(top.to, TOWER.storeys);
  assert.ok(108.3 < roofDrop(TOWER.storeys) && 100.3 > -STREET_Y + top.from * STOREY);
});

test("the lockup goes on drawn glass, never over a real floor, and nothing stands out of the roof city's plaza", () => {
  setStoreys([]);
  assert.equal(drawn(0, TOWER.storeys - 2).draw().brand.length, 4);
  assert.equal(drawn(0, TOWER.storeys - 1).draw().brand.length, 0);
  assert.equal(drawn(0, MAX_FLOORS, MAX_FLOORS).draw().brand.length, 0);
  setStoreys(LOOKS);
  // The roof's city leaves the building a plaza x -22..22, z -23..21 (world/city.ts).
  for (const b of drawn(0, 3).draw().all) assert.ok(b.min.x > -22 && b.max.x < 22 && b.min.z > -23 && b.max.z < 21);
});

test("the mast stands on the elevator's housing, and its beacon is about 131 m over the street", () => {
  const night = { bulbs: [], halos: [], lamps: [], windows: [], glows: [], street: 0 } as unknown as NightParts;
  const box = new THREE.Box3().setFromObject(buildMast(night));
  const hw = ELEVATOR.width / 2;
  assert.ok(box.min.x > ELEVATOR.x - hw && box.max.x < ELEVATOR.x + hw, 'over the shaft, east to west');
  assert.ok(box.min.z > B.minZ && box.max.z < ELEVATOR_FRONT, 'over the shaft, back to front');
  near(box.min.y, WALL_HEIGHT + 0.3, "its foot, on the housing's roof");
  near(box.max.y, WALL_HEIGHT + 0.3 + MAST.height, 'its top');
  near(MAST.height, 14, 'its height');
  const beacon = roofDrop(TOWER.storeys) + MAST.foot + MAST.height + 0.2;
  assert.ok(beacon > 130 && beacon < 132, `the beacon is ${beacon} m up`);
  assert.equal(night.bulbs.length, 1, 'one red bulb, for the light on each collar');
});
