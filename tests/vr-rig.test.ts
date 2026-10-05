// VR's rig (features/vr/rig.ts and rig-math.ts): the headset's room placed in the office, so your
// head is where you see from, walking about the room walks you about the office (but not through its
// walls), and the stick, a seat or a turn taken for you carry the room along. Also the thumbstick's
// seam in PlayerController, and the VR prefs.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BODY_SETTLED, BODY_SLACK, type Body, type Pose, type Rig, bodyYaw, carry, headWorld, offsetOf, placeHead, pushBack, quatWorld, rigMoved, turnAbout, wrap, yawPitch } from '../src/client/features/vr/rig-math.js';
import { startRig } from '../src/client/features/vr/rig.js';
import { MAX_LIFT, VR_DEFAULTS, cleanVrPrefs, loadVrPrefs, saveVrPrefs } from '../src/client/features/vr/prefs.js';
import type { VrSession } from '../src/client/features/vr/types.js';
import type { Ctx } from '../src/client/core/context.js';
import type { Frame } from '../src/client/core/registry.js';
import { PlayerController } from '../src/client/player/index.js';
import type { Collider } from '../src/client/world/types.js';
import { FLOOR, SEATING_BY_ID, SLAB, seatPlace } from '../src/shared/layout.js';

const near = (a: number, b: number, eps = 1e-6, what = '') => assert.ok(Math.abs(a - b) <= eps, `${what} ${a} is not ${b} (±${eps})`);
const angleNear = (a: number, b: number, eps = 1e-6, what = '') => near(wrap(a - b), 0, eps, `${what} angle ${a} vs ${b}:`);

// ---- The numbers ---------------------------------------------------------------------------------

const rigs: Rig[] = [
  { x: 0, y: 0, z: 0, yaw: 0 },
  { x: 3.2, y: -1.5, z: -7, yaw: 0.9 },
  { x: -12, y: 4.1, z: 2.5, yaw: -2.6 },
];
const poses: Pose[] = [
  { x: 0, y: 1.6, z: 0, yaw: 0 },
  { x: 0.7, y: 1.2, z: -0.4, yaw: 1.3 },
  { x: -1.1, y: 1.8, z: 0.9, yaw: -2.9 },
];

test('the offset space is the inverse of placing the room: a pose read through it is O + R(yaw)·local', () => {
  for (const o of rigs) {
    const { position, orientation } = offsetOf(o);
    const offset = new THREE.Matrix4().compose(new THREE.Vector3(position.x, position.y, position.z), new THREE.Quaternion(orientation.x, orientation.y, orientation.z, orientation.w), new THREE.Vector3(1, 1, 1));
    // XR: a pose in the offset space is inverse(originOffset) · the pose in the base space.
    const placing = offset.clone().invert();
    for (const p of poses) {
      const v = new THREE.Vector3(p.x, p.y, p.z).applyMatrix4(placing);
      const w = headWorld(o, p);
      near(v.x, w.x, 1e-9, 'x');
      near(v.y, w.y, 1e-9, 'y');
      near(v.z, w.z, 1e-9, 'z');
    }
  }
});

test("a head's yaw in the office is the room's turn plus its own, and its quaternion agrees", () => {
  for (const o of rigs) {
    for (const p of poses) {
      const local = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, p.yaw, 0.1, 'YXZ'));
      const world = yawPitch(quatWorld(o, local));
      angleNear(world.yaw, o.yaw + p.yaw, 1e-9, 'yaw');
      near(world.pitch, 0.3, 1e-9, 'pitch');
      angleNear(headWorld(o, p).yaw, o.yaw + p.yaw, 1e-12);
    }
  }
});

test('yawPitch reads camYaw and lookPitch back from a camera that was aimed with them', () => {
  const cam = new THREE.PerspectiveCamera();
  cam.rotation.order = 'YXZ';
  for (const [pitch, yaw] of [[0, 0], [-0.08, 1], [1.2, -2.5], [-1.3, 3]]) {
    cam.rotation.set(pitch, yaw, 0);
    const got = yawPitch(cam.quaternion);
    angleNear(got.yaw, yaw, 1e-9);
    near(got.pitch, pitch, 1e-9);
  }
});

test('placing a head puts it over the spot, looking the way asked, with the floor where asked', () => {
  for (const p of poses) {
    const o = placeHead(p, { x: 4, z: -9 }, 2.2, 0.75);
    const h = headWorld(o, p);
    near(h.x, 4, 1e-9);
    near(h.z, -9, 1e-9);
    near(h.y, 0.75 + p.y, 1e-9);
    angleNear(h.yaw, 2.2, 1e-9);
  }
});

test('turning about your head leaves it where it is, looking further round', () => {
  for (const o of rigs) {
    for (const p of poses) {
      const before = headWorld(o, p);
      const after = headWorld(turnAbout(o, p, 0.52), p);
      near(after.x, before.x, 1e-9);
      near(after.y, before.y, 1e-9);
      near(after.z, before.z, 1e-9);
      angleNear(after.yaw, before.yaw + 0.52, 1e-9);
    }
  }
});

test('carrying moves the room with your feet; pushing back gives up what a wall refused, past the lean', () => {
  const o = rigs[1];
  const c = carry(o, { x: 1.5, z: -2 });
  assert.deepEqual([c.x, c.y, c.z, c.yaw], [o.x + 1.5, o.y, o.z - 2, o.yaw]);
  // Got everywhere it wanted: nothing to give back.
  assert.equal(pushBack(o, { x: 1, z: 1 }, { x: 1, z: 1 }, 0.28), o);
  // Within the lean: nothing either.
  assert.equal(pushBack(o, { x: 1, z: 1.2 }, { x: 1, z: 1 }, 0.28), o);
  // Past it: the room goes back by the rest, so the head ends up the lean from the feet.
  const p = pushBack(o, { x: 1, z: 1.5 }, { x: 1, z: 1 }, 0.28);
  near(p.z - o.z, -(0.5 - 0.28), 1e-12);
  near(p.x, o.x, 1e-12);
  const all = pushBack(o, { x: 2, z: 0 }, { x: 1, z: 0 });
  near(all.x - o.x, -1, 1e-12);
});

test('a new reference space only for a millimetre or a twentieth of a degree', () => {
  const o = rigs[1];
  assert.equal(rigMoved(o, { ...o, x: o.x + 0.0005 }), false);
  assert.equal(rigMoved(o, { ...o, z: o.z + 0.002 }), true);
  assert.equal(rigMoved(o, { ...o, yaw: o.yaw + 0.0005 }), false);
  assert.equal(rigMoved(o, { ...o, yaw: o.yaw + 0.01 }), true);
  assert.equal(rigMoved(o, { ...o, yaw: o.yaw + 2 * Math.PI }), false);
});

test('your body stays put while you look about, comes round past the slack, and keeps up while you walk', () => {
  let b: Body = { yaw: 0, turning: false };
  const step = (head: number, moving: boolean, n: number) => {
    for (let i = 0; i < n; i++) b = bodyYaw(b, head, moving, 1 / 72);
  };
  step(BODY_SLACK * 0.8, false, 200);
  assert.equal(b.yaw, 0, 'a glance over the shoulder turns the head, not the body');
  step(BODY_SLACK * 1.3, false, 400);
  assert.ok(Math.abs(wrap(BODY_SLACK * 1.3 - b.yaw)) <= BODY_SETTLED, `came round to ${b.yaw}`);
  assert.equal(b.turning, false, 'and settled');
  // Walking, it follows even a small look.
  const from = b.yaw;
  step(from + 0.2, true, 72);
  near(b.yaw, from + 0.2, 1e-3);
  // Round the back, the short way.
  b = { yaw: 3, turning: false };
  step(-3, true, 72);
  angleNear(b.yaw, -3, 1e-3);
});

// ---- The rig, frame by frame --------------------------------------------------------------------

/** The office floor: upstairs, over the garage. */
const officeFloor: Collider = { ...FLOOR, bottom: -SLAB, top: 0 };

/** You, with window and document stood in for (see tests/player.test.ts). */
function makePlayer(t: TestContext, colliders: Collider[] = []) {
  for (const [name, value] of [['window', new EventTarget()], ['document', new EventTarget()]] as const) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
  return new PlayerController(new THREE.PerspectiveCamera(), new EventTarget() as unknown as HTMLElement, [officeFloor, ...colliders]);
}

/**
 * A headset that isn't there: a room whose head you put where you like, and the session's ticks run
 * by hand, with the move phase between steer and moved (player.update, as the office's loop runs it).
 */
function headset(t: TestContext, colliders: Collider[] = []) {
  const player = makePlayer(t, colliders);
  player.camYaw = 0;
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'XRRigidTransform');
  class Rigid {
    constructor(
      readonly position: DOMPointInit,
      readonly orientation: DOMPointInit,
    ) {}
  }
  Object.defineProperty(globalThis, 'XRRigidTransform', { configurable: true, value: Rigid });
  t.after(() => (previous ? Object.defineProperty(globalThis, 'XRRigidTransform', previous) : Reflect.deleteProperty(globalThis, 'XRRigidTransform')));

  const head = { position: { x: 0, y: 1.7, z: 0, w: 1 }, orientation: { x: 0, y: 0, z: 0, w: 1 } };
  const resets = new Set<() => void>();
  const base = {
    getOffsetReferenceSpace: (offset: Rigid) => ({ offset }),
    addEventListener: (_: string, fn: () => void) => resets.add(fn),
    removeEventListener: (_: string, fn: () => void) => resets.delete(fn),
  };
  let space: unknown = base;
  const frame = { getViewerPose: (s: unknown) => (s === base ? { transform: head } : null) };
  const ticks: Record<string, ((f: Frame) => void)[]> = {};
  const afters: (() => void)[] = [];
  const ends: (() => void)[] = [];
  const s = {
    prefs: { ...VR_DEFAULTS },
    head: { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), yaw: 0, pitch: 0, height: 0 },
    frame: () => frame,
    tick: (phase: string, fn: (f: Frame) => void) => void (ticks[phase] ??= []).push(fn),
    onEnd: (fn: () => void) => void ends.push(fn),
    around: (h: { after?(): void }) => void (h.after && afters.push(h.after)),
  } as unknown as VrSession;
  const camera = new THREE.PerspectiveCamera();
  const renderer = { xr: { getReferenceSpace: () => space, setReferenceSpace: (sp: unknown) => void (space = sp) } };
  const ctx = { player, camera, renderer } as unknown as Ctx;
  const rig = startRig(ctx, s);

  /** Frames of the headset's: steer, the move, moved, and after (a new room, if it moved). */
  function frames(n = 1, dt = 1 / 72) {
    const f: Frame = { delta: dt, dt, t: 0, now: 0 };
    for (let i = 0; i < n; i++) {
      for (const fn of ticks.steer ?? []) fn(f);
      player.update(dt);
      for (const fn of ticks.moved ?? []) fn(f);
      for (const fn of afters) fn();
    }
  }
  /** Puts your head at (x, y, z) in the room, looking along `yaw`. */
  function look(x: number, y: number, z: number, yaw = 0, pitch = 0) {
    Object.assign(head.position, { x, y, z });
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
    Object.assign(head.orientation, { x: q.x, y: q.y, z: q.z, w: q.w });
  }
  /** Your head as drawn, on the floor plan. */
  const seen = () => ({ x: s.head.position.x, y: s.head.position.y, z: s.head.position.z, yaw: s.head.yaw });
  return { player, s, rig, camera, frames, look, seen, space: () => space as { offset?: Rigid }, recentre: () => resets.forEach((fn) => fn()), end: () => ends.forEach((fn) => fn()), resets };
}

test('in VR your head is over your feet at your real height, looking the way you were', (t) => {
  const h = headset(t);
  h.player.pos.set(2, 0, 3);
  h.player.camYaw = 1;
  h.look(0.4, 1.65, -0.2, 0.3);
  h.frames(2);
  const head = h.seen();
  near(head.x, 2, 1e-6, 'x');
  near(head.z, 3, 1e-6, 'z');
  near(head.y, 1.65, 1e-6, 'y');
  angleNear(head.yaw, 1, 1e-6);
  angleNear(h.player.camYaw, 1, 1e-6);
  near(h.s.head.height, 1.65, 1e-6, 'height');
  assert.ok(h.space().offset, 'three.js has the offset space');
  // The camera is where the head is drawn, for everything after 'moved'.
  near(h.camera.position.distanceTo(h.s.head.position), 0, 1e-9);
  assert.deepEqual(h.player.pos.toArray(), [2, 0, 3], 'standing still, your feet stay put');
});

test('walking about the room walks you about the office', (t) => {
  const h = headset(t);
  h.frames(2);
  // Half a metre forward (-z), a little at a time as feet do.
  for (let i = 1; i <= 10; i++) {
    h.look(0, 1.7, -0.05 * i);
    h.frames();
  }
  assert.equal(h.player.moving, true, 'walking, to everyone who sees you');
  h.frames(36);
  near(h.player.pos.z, -0.5, 1e-6, 'feet');
  near(h.seen().z, -0.5, 1e-6, 'head');
  assert.equal(h.player.moving, false, 'and standing again');
});

test('a wall stops your feet, and the room is pushed back so your head stays out of it', (t) => {
  const wall: Collider = { minX: -5, maxX: 5, minZ: -1.1, maxZ: -0.9, top: 6 };
  const h = headset(t, [wall]);
  h.frames(2);
  for (let i = 1; i <= 40; i++) {
    h.look(0, 1.7, -0.05 * i);
    h.frames();
  }
  h.frames();
  assert.ok(h.player.pos.z > -0.9 + 0.31, `feet in the wall at z=${h.player.pos.z}`);
  assert.ok(h.seen().z > -0.9, `head in the wall at z=${h.seen().z}`);
  // Stepping back out, the room doesn't spring back: you walk straight away from it.
  const z = h.seen().z;
  h.look(0, 1.7, -2 + 0.3);
  h.frames(2);
  near(h.seen().z - z, 0.3, 1e-6, 'stepped back');
});

test('the stick walks you the way you look, as fast as it is pushed, and the room comes along', (t) => {
  const h = headset(t);
  h.frames(2);
  h.player.stick.z = -1;
  h.frames(72);
  near(h.player.pos.z, -4.6, 0.02, 'a second at a walk');
  // Drawn a frame behind, at most.
  near(h.seen().z, h.player.pos.z, 4.6 / 72 + 1e-6, 'head with the feet');
  near(h.seen().x, 0, 1e-6);
  h.player.stick.z = -0.5;
  const from = h.player.pos.z;
  h.frames(72);
  near(h.player.pos.z - from, -2.3, 0.02, 'half a push, half a walk');
  // Looking round to the left (camYaw + π/2), forward is -x.
  h.player.stick.z = 0;
  h.look(0, 1.7, 0, Math.PI / 2);
  h.frames(2);
  h.player.stick.z = -1;
  const x = h.player.pos.x;
  h.frames(36);
  near(h.player.pos.x - x, -2.3, 0.05, 'went where you looked');
});

test('moved by something else between frames (the elevator, a seat), the room goes with you', (t) => {
  const h = headset(t);
  h.look(0.3, 1.7, 0.2);
  h.frames(2);
  h.player.pos.set(10, 0, -4);
  h.frames(2);
  near(h.seen().x, 10, 1e-6);
  near(h.seen().z, -4, 1e-6);
  assert.deepEqual(h.player.pos.toArray(), [10, 0, -4], 'and your feet stay where they were put');
});

test('turned by something else (arriving at someone, a bend in a car), the room turns about your head', (t) => {
  const h = headset(t);
  h.look(0.3, 1.7, 0.2, 0.4);
  h.frames(2);
  const before = h.seen();
  h.player.camYaw += 0.8;
  h.frames(2);
  const after = h.seen();
  angleNear(after.yaw, before.yaw + 0.8, 1e-6);
  near(after.x, before.x, 1e-6);
  near(after.z, before.z, 1e-6);
  angleNear(h.player.camYaw, before.yaw + 0.8, 1e-6);
});

test("a nudge toward somewhere (the walk over to someone, a pole) never turns the world against your head; a car's bends do", (t) => {
  const h = headset(t);
  h.look(0, 1.7, 0, 0.6);
  h.frames(2);
  const before = h.seen().yaw;
  for (let i = 0; i < 30; i++) {
    // As followPath and the pole ease camYaw toward where they go, a bit each frame.
    h.player.camYaw += wrap(0 - h.player.camYaw) * 0.1;
    h.frames();
  }
  angleNear(h.seen().yaw, before, 1e-6, 'your head stays yours');
  h.player.riding = true;
  for (let i = 0; i < 30; i++) {
    h.player.camYaw += 0.01;
    h.frames();
  }
  h.frames();
  angleNear(h.seen().yaw, before + 0.3, 1e-6, 'round the bend with the car');
});

test('a snap turn turns you about your head, and the stick goes the new way at once', (t) => {
  const h = headset(t);
  h.frames(2);
  const before = h.seen();
  h.rig.turn(-Math.PI / 6);
  angleNear(h.player.camYaw, -Math.PI / 6, 1e-9, 'camYaw');
  h.frames(2);
  angleNear(h.seen().yaw, -Math.PI / 6, 1e-6, 'drawn');
  near(h.seen().x, before.x, 1e-6);
  near(h.seen().z, before.z, 1e-6);
});

test('sitting down faces you the way the seat does; sat, you lean freely, and the stick gets you up', (t) => {
  const h = headset(t);
  h.frames(2);
  const place = seatPlace(SEATING_BY_ID.get('couch')!, 2);
  h.player.sit(place);
  h.frames(2);
  near(h.seen().x, place.x, 1e-6);
  near(h.seen().z, place.z, 1e-6);
  angleNear(h.seen().yaw, place.rotY - Math.PI, 1e-6, 'looking out from the seat');
  h.look(0.4, 1.2, -0.3);
  h.frames(2);
  assert.deepEqual([h.player.pos.x, h.player.pos.z], [place.x, place.z], 'leaning, you stay sat');
  assert.equal(h.player.facing, place.rotY);
  h.player.stick.z = -0.4;
  h.frames();
  assert.ok(h.player.seat, 'a nudge of the stick');
  h.player.stick.z = -0.6;
  h.frames();
  assert.equal(h.player.seat, null, 'pushed past half way, you get up');
});

test('the height pref lifts the room, and the headset recentring puts it back under you', (t) => {
  const h = headset(t);
  h.frames(2);
  h.s.prefs.heightOffset = 0.3;
  h.frames(2);
  near(h.seen().y, 2.0, 1e-6, 'lifted');
  const before = h.seen();
  // The headset recentres: its room's origin jumps to where you are now, facing where you look.
  h.look(0, 1.7, 0, 0);
  h.player.camYaw = before.yaw;
  h.player.pos.set(1, 0, 1);
  h.recentre();
  h.frames(2);
  near(h.seen().x, 1, 1e-6);
  near(h.seen().z, 1, 1e-6);
  angleNear(h.seen().yaw, before.yaw, 1e-6);
  h.end();
  assert.equal(h.resets.size, 0, 'leaving stops listening for it');
});

test('your body turns after your head while you stand, and with it while you walk', (t) => {
  const h = headset(t);
  h.frames(2);
  const facing = h.player.facing;
  h.look(0, 1.7, 0, 0.5);
  h.frames(72);
  angleNear(h.player.facing, facing, 1e-9, 'a look aside');
  h.look(0, 1.7, 0, 1.4);
  h.frames(144);
  angleNear(h.player.facing, h.player.camYaw + Math.PI, BODY_SETTLED, 'past the slack');
});

// ---- The thumbstick's seam ----------------------------------------------------------------------

function walker(t: TestContext) {
  const player = makePlayer(t);
  player.camYaw = 0;
  const run = (seconds: number) => {
    for (let i = 0; i < seconds * 60; i++) player.update(1 / 60);
  };
  const press = (...codes: string[]) => {
    player.clearKeys();
    for (const code of codes) {
      const e = new Event('keydown');
      Object.defineProperty(e, 'code', { value: code });
      (globalThis.window as unknown as EventTarget).dispatchEvent(e);
    }
  };
  return { player, run, press };
}

test('the stick walks as far as it is pushed; two keys at once are still no faster than one', (t) => {
  const { player, run, press } = walker(t);
  player.stick.z = -0.5;
  run(1);
  near(player.pos.z, -2.3, 0.01, 'half pushed');
  assert.equal(player.moving, true);
  player.stick.z = 0;
  player.pos.set(0, 0, 0);
  press('KeyW', 'KeyD');
  run(1);
  near(Math.hypot(player.pos.x, player.pos.z), 4.6, 0.01, 'diagonal on the keys');
  player.pos.set(0, 0, 0);
  press('KeyW');
  player.stick.z = -1;
  run(1);
  near(player.pos.z, -4.6, 0.01, 'key and stick together');
  press();
  player.stick.z = 0;
  player.pos.set(0, 0, 0);
  player.stick.x = 1;
  player.stick.run = true;
  run(1);
  near(player.pos.x, 7.5, 0.01, 'clicked in, at a run');
  assert.equal(player.running, true);
});

test('with the controls taken (a window open) the stick does nothing', (t) => {
  const { player, run } = walker(t);
  player.enabled = false;
  player.stick.z = -1;
  run(1);
  assert.deepEqual(player.pos.toArray(), [0, 0, 0]);
  assert.equal(player.moving, false);
});

// ---- The prefs ----------------------------------------------------------------------------------

test('VR prefs keep what makes sense and default the rest', () => {
  assert.deepEqual(cleanVrPrefs(null), VR_DEFAULTS);
  assert.deepEqual(cleanVrPrefs({ snapDeg: 90, vignette: 'yes', heightOffset: 'tall', dominant: 'both', scale: 'big', perf: 1 }), VR_DEFAULTS);
  assert.deepEqual(cleanVrPrefs({ snapDeg: 45, vignette: true, heightOffset: 0.25, dominant: 'left', scale: 0.7, perf: true }), { snapDeg: 45, vignette: true, heightOffset: 0.25, dominant: 'left', scale: 0.7, perf: true });
  assert.equal(cleanVrPrefs({ heightOffset: 5 }).heightOffset, MAX_LIFT);
  assert.equal(cleanVrPrefs({ heightOffset: -5 }).heightOffset, -MAX_LIFT);
  assert.equal(cleanVrPrefs({ scale: 2 }).scale, 1);
  assert.equal(cleanVrPrefs({ scale: 0.1 }).scale, 0.5);
  assert.equal(cleanVrPrefs({ heightOffset: Number.NaN }).heightOffset, 0);
});

test('VR prefs are kept between visits, and storage that refuses gives the defaults', (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  t.after(() => (previous ? Object.defineProperty(globalThis, 'localStorage', previous) : Reflect.deleteProperty(globalThis, 'localStorage')));
  const kept = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v) } });
  saveVrPrefs({ snapDeg: 45 });
  saveVrPrefs({ heightOffset: 0.2 });
  assert.deepEqual(loadVrPrefs(), { ...VR_DEFAULTS, snapDeg: 45, heightOffset: 0.2 });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new Error('blocked');
    },
  });
  assert.deepEqual(loadVrPrefs(), VR_DEFAULTS);
  assert.doesNotThrow(() => saveVrPrefs({ vignette: true }));
});
