import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { ServerMsg, VrPose } from '../src/shared/protocol.js';
import { HAND_REACH, HEAD_LIMITS, POSE_STALE_MS, SHOULDER, TURN_STEP, armAim, bodyFrame, cleanPose, headEuler, poseMoved, poseOf } from '../src/shared/vr-pose.js';
import { VR_POSE_EVERY_MS, vrHandlers } from '../src/server/ws/handlers/vr.js';
import { peerPose } from '../src/client/features/vr/remote.js';
import type { Client } from '../src/server/office/client.js';
import type { Ctx as ServerCtx } from '../src/server/office/context.js';
import type { Ctx } from '../src/client/core/context.js';
import type { Parts } from '../src/client/core/parts.js';

// VR presence (protocol/vr.ts, shared/vr-pose.ts, ws/handlers/vr.ts, features/vr/presence.ts and
// remote.ts): what someone in a headset sends of their head and hands, what the office lets through,
// and how everyone else's page turns their character's head and arms to match.

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;
const v = (x: number, y: number, z: number) => ({ x, y, z });

test('a pose is cleaned up: angles held within a head\'s reach, hands within an arm\'s, to the millimetre', () => {
  assert.deepEqual(cleanPose({ yaw: 0.1234567, pitch: -0.2, roll: 0 }), { yaw: 0.123, pitch: -0.2, roll: 0 });
  assert.equal(cleanPose({ yaw: 7, pitch: 0, roll: 0 })!.yaw, 0.717, 'a turn the long way round is brought back');
  assert.deepEqual(cleanPose({ yaw: 3, pitch: 5, roll: -5 }), { yaw: HEAD_LIMITS.yaw, pitch: HEAD_LIMITS.pitch, roll: -HEAD_LIMITS.roll });
  for (const bad of [null, undefined, 'hi', 3, {}, { yaw: 0, pitch: 0 }, { yaw: NaN, pitch: 0, roll: 0 }, { yaw: '1', pitch: 0, roll: 0 }, { yaw: Infinity, pitch: 0, roll: 0 }]) {
    assert.equal(cleanPose(bad), null, JSON.stringify(bad));
  }
  const far = cleanPose({ yaw: 0, pitch: 0, roll: 0, left: v(30, 0, 40), right: v(0.2, -0.5, 0.3) })!;
  assert.ok(near(Math.hypot(far.left!.x, far.left!.y, far.left!.z), HAND_REACH, 2e-3), 'a hand miles off is pulled in to arm\'s length, along its line');
  assert.ok(near(far.left!.x / far.left!.z, 0.75, 1e-2));
  assert.deepEqual(far.right, v(0.2, -0.5, 0.3));
  const junk = cleanPose({ yaw: 0, pitch: 0, roll: 0, left: { x: 1, y: 'no', z: 0 }, right: [1, 2, 3], extra: 'dropped' })!;
  assert.deepEqual(junk, { yaw: 0, pitch: 0, roll: 0 }, 'a hand that isn\'t a point is left out, and nothing else comes along');
});

test('points go into the body\'s frame: x to its left, z ahead, whichever way it faces', () => {
  const at = v(5, 0, 5);
  // Facing +z (rotY 0): ahead is +z, its left is +x.
  assert.deepEqual(bodyFrame(v(5, 1, 6), at, 0), v(0, 1, 1));
  assert.deepEqual(bodyFrame(v(6, 0, 5), at, 0), v(1, 0, 0));
  // Turned a quarter (rotY π/2): ahead is +x, its left is -z.
  const ahead = bodyFrame(v(6, 0, 5), at, Math.PI / 2);
  assert.ok(near(ahead.x, 0) && near(ahead.z, 1), JSON.stringify(ahead));
  const left = bodyFrame(v(5, 0, 4), at, Math.PI / 2);
  assert.ok(near(left.x, 1) && near(left.z, 0), JSON.stringify(left));
});

test('the pose sent is the head\'s turn from the body, and the hands from the eyes', () => {
  // A camera looking along camYaw faces camYaw + π: looking the way the body faces is no turn at all.
  const facing = 0.4;
  const straight = poseOf({ position: v(0, 1.7, 0), yaw: facing - Math.PI, pitch: 0.1, roll: -0.05 }, facing, {});
  assert.ok(near(straight.yaw, 0, 1e-3) && near(straight.pitch, 0.1) && near(straight.roll, -0.05), JSON.stringify(straight));
  assert.equal(straight.left, undefined);
  // Head turned 30° to the left (camYaw up by that much).
  const turned = poseOf({ position: v(0, 1.7, 0), yaw: facing - Math.PI + Math.PI / 6, pitch: 0, roll: 0 }, facing, {});
  assert.ok(near(turned.yaw, Math.PI / 6, 1e-3), `${turned.yaw}`);
  // Hands: the right one out in front at chest height, the left hanging by the side.
  const eyes = v(2, 1.7, 3);
  const pose = poseOf({ position: eyes, yaw: -Math.PI, pitch: 0, roll: 0 }, 0, { right: v(1.8, 1.3, 3.4), left: v(2.25, 0.9, 3), });
  assert.deepEqual(pose.right, v(-0.2, -0.4, 0.4));
  assert.deepEqual(pose.left, v(0.25, -0.8, 0));
});

test('a pose goes out again once the head turns about 2° or a hand moves a centimetre and a half', () => {
  const base: VrPose = { yaw: 0, pitch: 0, roll: 0, right: v(0, -0.4, 0.3) };
  assert.equal(poseMoved(null, base), true, 'the first one always does');
  assert.equal(poseMoved(base, { ...base, yaw: TURN_STEP * 0.9 }), false);
  assert.equal(poseMoved(base, { ...base, pitch: TURN_STEP * 1.1 }), true);
  assert.equal(poseMoved(base, { ...base, roll: -TURN_STEP * 1.1 }), true);
  assert.equal(poseMoved(base, { ...base, right: v(0, -0.4, 0.31) }), false);
  assert.equal(poseMoved(base, { ...base, right: v(0, -0.4, 0.32) }), true);
  assert.equal(poseMoved(base, { yaw: 0, pitch: 0, roll: 0 }), true, 'a hand gone out of sight');
  assert.equal(poseMoved(base, { ...base, left: v(0, 0, 0) }), true, 'or come into it');
  assert.equal(poseMoved({ ...base, yaw: Math.PI - 0.01 }, { ...base, yaw: -Math.PI + 0.01 }), false, 'across the back is a small turn');
});

test('a character\'s head turns the way the pose says, its front being +z', () => {
  const head = new THREE.Object3D();
  const look = (pose: VrPose) => {
    const e = headEuler(pose);
    head.rotation.set(e.x, e.y, e.z, 'YXZ');
    head.updateMatrixWorld(true);
    return new THREE.Vector3(0, 0, 1).applyQuaternion(head.quaternion);
  };
  const up = look({ yaw: 0, pitch: 0.5, roll: 0 });
  assert.ok(up.y > 0.4, `looking up raises its front: ${up.toArray()}`);
  const left = look({ yaw: 0.5, pitch: 0, roll: 0 });
  assert.ok(left.x > 0.4, `turning left (+yaw) swings its front to +x, its left: ${left.toArray()}`);
  look({ yaw: 0, pitch: 0, roll: 0.4 });
  const ear = new THREE.Vector3(1, 0, 0).applyQuaternion(head.quaternion);
  assert.ok(ear.y < -0.3, `tilting toward its left shoulder drops its left (+x) side: ${ear.toArray()}`);
});

test('an arm turns from hanging down to point at the hand, never far across the chest', () => {
  const point = (shoulder: { x: number; y: number; z: number }, hand: { x: number; y: number; z: number }) => {
    const q = armAim(shoulder, hand);
    return new THREE.Vector3(0, -1, 0).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w));
  };
  const s = SHOULDER.right;
  const down = point(s, v(s.x, s.y - 0.5, s.z));
  assert.ok(near(down.y, -1, 1e-6), 'straight down: no turn');
  const ahead = point(s, v(s.x, s.y, s.z + 0.5));
  assert.ok(near(ahead.z, 1, 1e-6), `straight ahead: ${ahead.toArray()}`);
  const up = point(s, v(s.x, s.y + 0.5, s.z));
  assert.ok(near(up.y, 1, 1e-6), `straight up (a hand raised): ${up.toArray()}`);
  const aimed = point(s, v(s.x - 0.3, s.y + 0.1, s.z + 0.4));
  const want = new THREE.Vector3(-0.3, 0.1, 0.4).normalize();
  assert.ok(aimed.distanceTo(want) < 1e-6, `at the hand: ${aimed.toArray()}`);
  // The right shoulder is on -x: reaching far over to +x is held a little past the middle.
  const across = point(s, v(s.x + 1, s.y, s.z + 0.05));
  assert.ok(across.x <= 0.51 && across.x > 0.3, `${across.toArray()}`);
  assert.deepEqual(armAim(s, s), { x: 0, y: 0, z: 0, w: 1 }, 'a hand on the shoulder: nothing to aim at');
});

/** The office's side, with somebody on a floor and whoever's near them listening. */
function office() {
  const sent: { msg: ServerMsg; droppable?: boolean }[] = [];
  const ctx = { toNeighbors: (_c: Client, msg: ServerMsg, droppable?: boolean) => sent.push({ msg, droppable }) } as unknown as ServerCtx;
  const c = { id: 'vr', throttles: new Map<string, number>() } as unknown as Client;
  return { ctx, c, sent };
}

test('the office passes a clean pose on to the floor, twenty a second at most, and always the last one', () => {
  const { ctx, c, sent } = office();
  vrHandlers['vr.pose'](ctx, c, { t: 'vr.pose', pose: { yaw: 0.25, pitch: 0, roll: 0, right: v(0, -0.4, 0.3) } });
  assert.deepEqual(sent, [{ msg: { t: 'peer.vr', id: 'vr', pose: { yaw: 0.25, pitch: 0, roll: 0, right: v(0, -0.4, 0.3) } }, droppable: true }]);
  vrHandlers['vr.pose'](ctx, c, { t: 'vr.pose', pose: { yaw: 0.3, pitch: 0, roll: 0 } });
  assert.equal(sent.length, 1, `again within ${VR_POSE_EVERY_MS} ms is too soon`);
  vrHandlers['vr.pose'](ctx, c, { t: 'vr.pose', pose: null });
  assert.deepEqual(sent[1], { msg: { t: 'peer.vr', id: 'vr', pose: null }, droppable: undefined }, 'leaving VR always goes, and is never dropped');
  c.throttles.clear();
  vrHandlers['vr.pose'](ctx, c, { t: 'vr.pose', pose: { yaw: 'left' } as unknown as VrPose });
  vrHandlers['vr.pose'](ctx, c, { t: 'vr.pose' } as unknown as { t: 'vr.pose'; pose: VrPose });
  assert.equal(sent.length, 2, 'nor is anything that isn\'t a pose passed on');
  vrHandlers['vr.pose'](ctx, c, { t: 'vr.pose', pose: { yaw: 0, pitch: 0, roll: 0 } });
  assert.equal(sent.length, 3, 'which used none of their twenty');
});

test('everyone else sees a headset on their face, their head turned, and their arms reaching', () => {
  // A character as Person.wear builds one: the head, and the right arm (on -x) and the left (+x).
  const root = new THREE.Group();
  const head = new THREE.Group();
  const armL = new THREE.Group();
  const armR = new THREE.Group();
  root.add(head, armL, armR);
  const person = { wear: (o: THREE.Object3D, on: string) => (on === 'head' ? head : on === 'hand' ? armL : armR).add(o) };
  const remotes = new Map<string, { person: typeof person; grip: string | null }>([['vr', { person, grip: null }]]);
  let tick: ((f: { dt: number; now: number }) => void) | null = null;
  const ctx = { ticks: { add: (phase: string, fn: typeof tick) => (assert.equal(phase, 'others'), (tick = fn)) } } as unknown as Ctx;
  const parts = { peers: { remotes } } as unknown as Pick<Parts, 'peers'>;
  const run = (dt = 1) => {
    // The people's own tick first: it puts the head straight and swings the arms.
    head.rotation.set(0, 0, 0);
    armL.rotation.set(0.3, 0, 0);
    armR.rotation.set(-0.3, 0, 0);
    tick!({ dt, now: performance.now() });
  };

  peerPose(ctx, parts, { t: 'peer.vr', id: 'vr', pose: { yaw: 0.6, pitch: 0.2, roll: 0, right: v(-0.18, -0.25, 0.6) } });
  assert.ok(tick, 'the first pose starts the tick');
  run();
  assert.equal(head.children.length, 1, 'a headset on');
  assert.equal(head.children[0].name, 'vr-visor');
  const turned = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.2, 0.6, 0, 'YXZ'));
  assert.ok(head.quaternion.angleTo(turned) < 1e-3, `turned 0.6 to their left and looking 0.2 up: ${head.rotation.toArray()}`);
  const hand = new THREE.Vector3(0, -1, 0).applyQuaternion(armL.quaternion);
  assert.ok(hand.z > 0.95, `the right arm (on -x) reaches straight out ahead: ${hand.toArray()}`);
  assert.ok(near(armR.rotation.x, -0.3), 'the left arm, with no hand tracked, swings as it was');
  run();
  assert.equal(head.children.length, 1, 'one headset, however many frames');

  // On the ladder their arms are the climb's.
  remotes.get('vr')!.grip = 'ladder';
  run();
  assert.ok(near(armL.rotation.x, 0.3), 'on the ladder, the climb keeps the arms');
  remotes.get('vr')!.grip = null;

  peerPose(ctx, parts, { t: 'peer.vr', id: 'vr', pose: null });
  run();
  assert.equal(head.children.length, 0, 'out of VR: the headset comes off');
  assert.equal(armL.children.length + armR.children.length, 0);
  assert.equal(head.rotation.y, 0);

  // A pose that stops coming is let go of.
  peerPose(ctx, parts, { t: 'peer.vr', id: 'vr', pose: { yaw: 0, pitch: 0, roll: 0 } });
  run();
  assert.equal(head.children.length, 1);
  tick!({ dt: 0.016, now: performance.now() + POSE_STALE_MS + 100 });
  assert.equal(head.children.length, 0, 'gone quiet: as they were');
});
