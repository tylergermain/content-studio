import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { Ctx } from '../src/client/core/context.js';
import { Activities, Ticks } from '../src/client/core/registry.js';
import { FADE_IN, FADE_OUT, KEEP_FROM, LEAVE, LOOK_FAR, LOOK_MISS, MAX_GROW, NEAR, createHireMarkers, fade, growAt, nearYou, offView } from '../src/client/features/workers/hire-markers.js';
import { MARKER_SIZE, markerIn, vacancyMarker } from '../src/client/world/office/hire-marker.js';
import type { DeskView } from '../src/client/world/types.js';

// The "+" over a free seat (world/office/hire-marker.ts, features/workers/hire-markers.ts): a small
// disc of glass, not the old solid green cross, that only shows on the free desks near you and the one
// you look at, fading in and out, and on every free desk in the office builder or with the Workers
// list open. A long bench of empty desks is no longer a row of green crosses.

// The disc is painted on a canvas, which is all it needs of a page: a 2D context that takes every call.
function canvas() {
  const c = { width: 0, height: 0, getContext: () => g };
  const g: object = new Proxy({}, { get: (_, k) => (k === 'canvas' ? c : () => g), set: () => true });
  return c;
}
(globalThis as { document?: unknown }).document ??= { createElement: canvas };

const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

test('the "+" is a small sprite of glass, out of sight until something shows it', () => {
  const vacancy = vacancyMarker(1.33);
  const plus = markerIn(vacancy);
  assert.ok(plus instanceof THREE.Sprite, 'a camera-facing disc, like the labels over people');
  assert.equal(vacancy.position.y, 1.33);
  assert.ok(!plus.visible && plus.material.opacity === 0, 'hidden to start with');
  assert.ok(plus.material.transparent && !plus.material.depthWrite, 'see-through, like the labels');
  assert.ok(MARKER_SIZE < 0.28, 'smaller than the old 0.28 m cross');
  // The sprite is bigger than the disc by its shadow's margin, and no bigger than twice it.
  assert.ok(plus.scale.x > MARKER_SIZE && plus.scale.x < MARKER_SIZE * 2 && plus.scale.x === plus.scale.y);
  // Every marker shares the one drawing.
  assert.equal(markerIn(vacancyMarker(1.25))!.material.map, plus.material.map);
  // A kiosk's vacancy (its waiting agent) or a meeting chair's has no "+".
  assert.equal(markerIn(new THREE.Group()), undefined);
});

test('the desk you look at is the one nearest the middle of your view, within reach of the eye', () => {
  const eye = { x: 0, y: 1.6, z: 0 };
  const ahead = { x: 0, y: 0, z: -1 };
  assert.ok(near(offView(eye, ahead, { x: 0, y: 1.6, z: -10 }), 0), 'dead ahead');
  assert.ok(offView(eye, ahead, { x: 0.5, y: 1.3, z: -8 }) < offView(eye, ahead, { x: 0.9, y: 1.3, z: -8 }), 'nearer the middle wins');
  assert.equal(offView(eye, ahead, { x: 0, y: 1.6, z: 5 }), Infinity, 'not behind you');
  assert.equal(offView(eye, ahead, { x: 0, y: 1.6, z: -(LOOK_FAR + 1) }), Infinity, 'not across the building');
  assert.equal(offView(eye, ahead, { x: LOOK_MISS + 0.2, y: 1.6, z: -6 }), Infinity, 'not off to the side');
  // Looking at a desk 17 m off, at the foot of its legs rather than the air over it where its "+" is.
  const atLegs = new THREE.Vector3(0, 0.15 - 1.4, -17).normalize();
  const plus = { x: 0, y: 1.33, z: -17 };
  assert.ok(offView({ x: 0, y: 1.4, z: 0 }, atLegs, plus) < 0.01, 'the desk under the "+" counts');
  assert.equal(offView({ x: 0, y: 1.4, z: 0 }, atLegs, plus, 0), Infinity, 'the "+" alone is over a meter above where you look');
  // Looking down at the floor a few steps ahead isn't looking at a desk further on that line.
  const down = new THREE.Vector3(0, -1.4, -3).normalize();
  assert.equal(offView({ x: 0, y: 1.4, z: 0 }, down, { x: 0, y: 1.33, z: -8 }), Infinity);
});

test('a "+" near you shows, and stays until you are a little further off', () => {
  assert.ok(nearYou(NEAR - 0.1, false));
  assert.ok(!nearYou(NEAR + 0.1, false));
  assert.ok(nearYou(NEAR + 0.1, true), 'no flicker on the edge');
  assert.ok(!nearYou(LEAVE + 0.1, true));
});

test('a "+" fades in and out over a moment, never past fully shown or gone', () => {
  let o = 0;
  for (let t = 0; t < FADE_IN - 1e-6; t += 0.05) o = fade(o, true, 0.05);
  assert.ok(o > 0.7 && o <= 1, `nearly in after ${FADE_IN}s: ${o}`);
  assert.equal(fade(o, true, 1), 1);
  o = 1;
  o = fade(o, false, FADE_OUT / 2);
  assert.ok(near(o, 0.5), 'halfway out halfway through');
  assert.equal(fade(o, false, 1), 0);
});

test('a "+" near you is its own small size; one far off grows a little to stay readable, only so far', () => {
  assert.equal(growAt(NEAR), 1);
  assert.equal(growAt(KEEP_FROM), 1);
  assert.ok(near(growAt(KEEP_FROM * 2), 2));
  assert.equal(growAt(200), MAX_GROW);
});

/** A bench of `n` free desks along x, 2.25 m apart, each with its "+", and the frame loop that fades them. */
function bench(n: number) {
  const scene = new THREE.Scene();
  const desks = new Map<string, DeskView>();
  for (let i = 0; i < n; i++) {
    const group = new THREE.Group();
    group.position.set(i * 2.25, 0, 0);
    const vacancy = vacancyMarker(1.33);
    group.add(vacancy);
    scene.add(group);
    desks.set(`desk-${i}`, { group, vacancy } as unknown as DeskView);
  }
  // A kiosk: its vacancy is the agent waiting there, never a "+".
  const kiosk = new THREE.Group();
  scene.add(kiosk);
  desks.set('station-queue', { group: kiosk, vacancy: kiosk } as unknown as DeskView);
  scene.updateMatrixWorld(true);
  const ticks = new Ticks();
  const activities = new Activities();
  let building = false;
  activities.add({ id: 'office-builder', active: () => building, stop: () => void (building = false) });
  const settings = { hud: { workers: false } };
  const camera = new THREE.PerspectiveCamera();
  const player = { pos: new THREE.Vector3() };
  createHireMarkers({ ticks, activities, settings, camera, player, world: () => ({ desks }) } as unknown as Ctx);
  /** Stands you at `x` (in front of the bench) looking at `look`, and lets a second go by. */
  const standAt = (x: number, look: THREE.Vector3Like) => {
    player.pos.set(x, 0, 2);
    camera.position.set(x, 1.6, 2);
    camera.lookAt(look.x, look.y, look.z);
    camera.updateMatrixWorld(true);
    for (let i = 0; i < 20; i++) ticks.run({ delta: 0.05, dt: 0.05, t: i * 0.05, now: i * 50 });
  };
  const shown = () => [...desks].filter(([, d]) => markerIn(d.vacancy)?.visible).map(([id]) => id);
  return { desks, standAt, shown, build: (on: boolean) => void (building = on), settings };
}

test('along a bench of a dozen empty desks, only the ones near you show their "+"', () => {
  const b = bench(12);
  // At the first desk, looking down at the floor: desks 0 to 2 (desk 2 is 4.9 m off), not desk 3 (7 m).
  b.standAt(0, new THREE.Vector3(0, 0, 3));
  assert.deepEqual(b.shown(), ['desk-0', 'desk-1', 'desk-2']);
  for (const id of ['desk-0', 'desk-1']) {
    const plus = markerIn(b.desks.get(id)!.vacancy)!;
    assert.equal(plus.material.opacity, 1, `${id} fully in`);
    assert.equal(plus.scale.x, markerIn(vacancyMarker(1))!.scale.x, `${id} its own size`);
  }
});

test('the desk you look at shows its "+" from across the room, and the rest stay quiet', () => {
  const b = bench(12);
  // Looking down the bench at desk 8, 18 m away: at the desk itself, not the air over it.
  b.standAt(0, new THREE.Vector3(18, 0.6, 0));
  assert.deepEqual(b.shown(), ['desk-0', 'desk-1', 'desk-2', 'desk-8']);
  const far = markerIn(b.desks.get('desk-8')!.vacancy)!;
  assert.ok(far.scale.x > markerIn(b.desks.get('desk-0')!.vacancy)!.scale.x * 2, 'grown to read from 18 m');
  // Look away and it fades out again.
  b.standAt(0, new THREE.Vector3(0, 0, 3));
  assert.ok(!b.shown().includes('desk-8'));
});

test('walking along, the "+"s come and go with you', () => {
  const b = bench(12);
  b.standAt(0, new THREE.Vector3(0, 0, 3));
  b.standAt(18, new THREE.Vector3(18, 0, 3));
  assert.deepEqual(b.shown(), ['desk-6', 'desk-7', 'desk-8', 'desk-9', 'desk-10']);
});

test('in the office builder or with the Workers list open, every free desk shows its "+"', () => {
  const b = bench(12);
  const all = [...b.desks.keys()].filter((id) => id.startsWith('desk-'));
  b.build(true);
  b.standAt(0, new THREE.Vector3(0, 0, 3));
  assert.deepEqual(b.shown(), all, 'building');
  b.build(false);
  b.standAt(0, new THREE.Vector3(0, 0, 3));
  assert.deepEqual(b.shown(), ['desk-0', 'desk-1', 'desk-2'], 'back to the ones near you');
  b.settings.hud.workers = true;
  b.standAt(0, new THREE.Vector3(0, 0, 3));
  assert.deepEqual(b.shown(), all, 'the Workers list open');
});

test("a desk someone's at shows no \"+\", and a desk freed near you fades its in", () => {
  const b = bench(4);
  const taken = b.desks.get('desk-1')!;
  taken.vacancy.visible = false;
  b.standAt(0, new THREE.Vector3(0, 0, 3));
  assert.deepEqual(b.shown(), ['desk-0', 'desk-2']);
  assert.ok(!markerIn(taken.vacancy)!.visible && markerIn(taken.vacancy)!.material.opacity === 0);
  taken.vacancy.visible = true;
  b.standAt(0, new THREE.Vector3(0, 0, 3));
  assert.deepEqual(b.shown(), ['desk-0', 'desk-1', 'desk-2']);
});
