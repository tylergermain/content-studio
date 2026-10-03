import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CAR, CARS, carPoint } from '../src/shared/garage.js';
import { BALCONY, ELEVATOR, ELEVATOR_FRONT, FLOOR, PARACHUTE, ROAD, SLAB, STREET_Y, WALL_T } from '../src/shared/layout.js';
import { setStoreys } from '../src/client/world/facade.js';
import { forecourt, listings } from '../src/client/world/forecourt.js';
import type { NightParts } from '../src/client/world/outside.js';
import type { StreetSite } from '../src/client/world/office/fixture.js';

// The way in from the street (world/forecourt.ts), built as the office builds it and measured: the
// marquee, the lane, the lift's frame and the directory stand in nobody's way (no colliders, nothing
// a car or anyone on foot would go through but paint on the floor or things high overhead), they're
// clear of the balcony's posts and of where the parachutes come down, and the directory lists the
// building from the roof down to the garage.

// The signs are painted on canvases, which is all they need of a page: a 2D context that measures
// every letter 10 px wide and draws nothing.
const ctx2d = new Proxy({}, { get: (_, k) => (k === 'measureText' ? (s: string) => ({ width: s.length * 10 }) : () => {}), set: () => true });
(globalThis as { document?: unknown }).document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }) };

const G = STREET_Y;
/** Paint on the floor comes no higher than this over the street. */
const PAINT = 0.03;
/** Anyone and anything on the street passes under this: a car's roof, and a head with room to spare. */
const HEADROOM = 2.5;

/**
 * The forecourt built into a street of its own, with what it hands back and the box round each
 * triangle it's made of (its parts are merged, one mesh to a material, so a mesh's box is no use).
 */
function built() {
  const night = { bulbs: [], halos: [], lamps: [], windows: [], glows: [], street: G } as unknown as NightParts;
  const ground = new THREE.Group();
  const site = { group: new THREE.Group(), colliders: [], interactables: [], ground, groundColliders: [], get: () => night } as unknown as StreetSite;
  const fixture = forecourt(site);
  ground.updateMatrixWorld(true);
  const boxes: THREE.Box3[] = [];
  ground.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const at = m.geometry.getAttribute('position');
    const index = m.geometry.getIndex();
    const count = index ? index.count : at.count;
    for (let i = 0; i < count; i += 3) {
      const corners = [0, 1, 2].map((k) => new THREE.Vector3().fromBufferAttribute(at, index ? index.getX(i + k) : i + k).applyMatrix4(m.matrixWorld));
      boxes.push(new THREE.Box3().setFromPoints(corners));
    }
  });
  return { night, site, fixture, ground, boxes };
}

/** The part of `b` that stands on the street lower than `top`, as a box in plan, or null if none does. */
function standing(b: THREE.Box3, top: number) {
  if (b.max.y <= G + PAINT || b.min.y >= G + top) return null;
  return { minX: b.min.x, maxX: b.max.x, minZ: b.min.z, maxZ: b.max.z };
}

const meets = (a: { minX: number; maxX: number; minZ: number; maxZ: number }, b: { minX: number; maxX: number; minZ: number; maxZ: number }) =>
  a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ;

const show = (b: THREE.Box3) => `x ${b.min.x.toFixed(2)}..${b.max.x.toFixed(2)}, y ${b.min.y.toFixed(2)}..${b.max.y.toFixed(2)}, z ${b.min.z.toFixed(2)}..${b.max.z.toFixed(2)}`;

test('it adds nothing to bump into and nothing to use, and two downlights under the marquee', () => {
  const { site, night } = built();
  assert.equal(site.colliders.length + site.groundColliders.length + site.interactables.length, 0);
  // Down by the street, so they go down with it on a floor further up; pushed once, as the sky reads them once.
  assert.equal(night.lamps.length, 2);
  assert.equal(night.halos.length, 2);
  for (const l of [...night.lamps, ...night.halos.map((h) => ({ ...h, x: h.at.x, y: h.at.y, z: h.at.z }))]) {
    assert.equal(l.ground, true);
    assert.ok(l.x > 4 && l.x < 17 && l.z > FLOOR.maxZ + WALL_T && l.z < FLOOR.maxZ + WALL_T + 4, `under the marquee: (${l.x}, ${l.z})`);
    assert.ok(l.y > G + HEADROOM && l.y < -SLAB, `overhead: ${l.y}`);
  }
});

test('nothing of it is in a parked car, or lower than a car and a head anywhere a car goes but paint', () => {
  const { boxes } = built();
  const cars = CARS.map((c) => {
    // With 5 cm round it: the lift's frame stands 10 cm from the Purple Lambo's side.
    const a = carPoint(c, -CAR.width / 2 - 0.05, -CAR.length / 2 - 0.05);
    const b = carPoint(c, CAR.width / 2 + 0.05, CAR.length / 2 + 0.05);
    return { name: c.name, minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z) };
  });
  // Where a car drives: the garage and the lot out to the road, all but the strip along the walls at the back.
  const driven = { minX: FLOOR.minX, maxX: FLOOR.maxX + WALL_T + 12, minZ: FLOOR.minZ + 0.2, maxZ: ROAD.maxZ };
  for (const b of boxes) {
    const low = standing(b, HEADROOM);
    if (!low) continue;
    for (const car of cars) assert.ok(!meets(low, car), `${show(b)} is clear of the ${car.name}`);
    // What stands on the floor (the lift's frame, the directory) is against the back wall, by the lift's shaft.
    assert.ok(low.maxZ <= ELEVATOR_FRONT + 0.25, `${show(b)} stands at the back, by the lift`);
    assert.ok(meets(low, driven) ? low.minX >= ELEVATOR.x - ELEVATOR.width / 2 - 0.31 || low.maxZ <= FLOOR.minZ + 0.1 : true, `${show(b)} is against the lift or the back wall`);
  }
});

test('the lift is left its doorway, the balcony its posts, and the parachutes their way down', () => {
  const { boxes } = built();
  const doorway = { minX: ELEVATOR.x - ELEVATOR.doorWidth / 2, maxX: ELEVATOR.x + ELEVATOR.doorWidth / 2, minZ: ELEVATOR_FRONT - 0.2, maxZ: ELEVATOR_FRONT + 2.2 };
  const posts = [BALCONY.minX + 0.25, BALCONY.maxX - 0.25].map((x) => ({ minX: x - 0.3, maxX: x + 0.3, minZ: BALCONY.maxZ - 0.55, maxZ: BALCONY.maxZ + 0.05 }));
  // From the jump off the balcony out to where they land, and a metre round that.
  const chute = { minX: PARACHUTE.jump.x - 1, maxX: PARACHUTE.jump.x + PARACHUTE.east[1] + 1, minZ: BALCONY.minZ, maxZ: PARACHUTE.jump.z + PARACHUTE.out + 1 };
  for (const b of boxes) {
    const low = standing(b, ELEVATOR.doorHeight + 0.1);
    if (low) assert.ok(!meets(low, doorway), `${show(b)} is out of the lift's doorway`);
    const any = standing(b, -SLAB - G);
    if (any) for (const p of posts) assert.ok(!meets(any, p), `${show(b)} is clear of the balcony's posts`);
    const plan = { minX: b.min.x, maxX: b.max.x, minZ: b.min.z, maxZ: b.max.z };
    assert.ok(!meets(plan, chute), `${show(b)} is clear of the parachutes' way down`);
  }
});

test('the marquee hangs over the garage mouth east of the balcony, from 2.55 m up', () => {
  const { boxes } = built();
  const out = boxes.filter((b) => b.max.z > FLOOR.maxZ + WALL_T + 0.01);
  assert.ok(out.length > 0);
  for (const b of out) {
    assert.ok(b.min.x >= 4 - 0.03 && b.max.x <= 17 + 0.03, `${show(b)} is within x 4..17`);
    assert.ok(b.max.z <= FLOOR.maxZ + WALL_T + 4 + 0.03, `${show(b)} is no more than 4 m out`);
    assert.ok(b.min.y >= G + 2.55 - 1e-6 && b.max.y <= G + 3.45 + 1e-6, `${show(b)} is between 2.55 and 3.45 m up`);
  }
});

test('the directory lists the roof bar, the floors from the top down and the garage, and repaints only when they change', () => {
  setStoreys([]);
  assert.deepEqual(
    listings(2).map((l) => `${l.key} ${l.name}`),
    ['R Rooftop bar', '2 Floor 2', '1 Floor 1', 'G Garage'],
  );
  setStoreys([
    { name: 'Friday Labs', accent: '#09ca59' },
    { name: 'AI Innovators', accent: '#0080fe' },
    { name: 'Content', accent: '#218cff' },
  ]);
  const rows = listings(3);
  assert.deepEqual(
    rows.map((l) => `${l.key} ${l.name}`),
    ['R Rooftop bar', '3 Content', '2 AI Innovators', '1 Friday Labs', 'G Garage'],
  );
  assert.deepEqual(rows.map((l) => l.accent ?? null), [null, '#218cff', '#0080fe', '#09ca59', null]);
  assert.deepEqual(rows.map((l) => !!l.here), [false, false, false, false, true]);

  const { fixture, ground } = built();
  const face = (() => {
    let tex: THREE.Texture | null = null;
    ground.traverse((o) => {
      const mat = (o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
      if (mat?.map && !mat.transparent) tex = mat.map;
    });
    return tex as unknown as THREE.Texture;
  })();
  const v0 = face.version;
  fixture.setLevel!(0, 3, []);
  const v1 = face.version;
  assert.ok(v1 > v0, 'painted once there are floors');
  fixture.setLevel!(2, 3, []);
  assert.equal(face.version, v1, 'not again for another floor of the same building');
  setStoreys([{ name: 'Friday Labs', accent: '#09ca59' }]);
  fixture.setLevel!(0, 1, []);
  assert.ok(face.version > v1, 'again once the floors change');
  setStoreys([]);
});
