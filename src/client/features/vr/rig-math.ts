/**
 * The rig's numbers (see rig.ts), pure so they run under node in the tests (tests/vr-rig.test.ts).
 *
 * The headset reports where your head is in its own room: the session's 'local-floor' space, with
 * the floor at y = 0 and its origin where the headset started. The rig, O, is where that room's
 * origin and heading sit in the office: a point and a turn about the vertical. A pose in the room
 * is in the office at `O + R(O.yaw)·local` (see headWorld); the headset is handed the inverse of
 * that as an offset reference space (offsetOf), so three.js reads the head and the controllers in
 * the office's own coordinates. Walking about the room moves your head; the stick, a seat, a car or
 * the elevator moves O, carrying the room along with you.
 *
 * Yaw is camYaw's convention throughout: you look along (-sin, -cos) of it (see player/pointer.ts),
 * and your body faces yaw + π (PlayerController.facing).
 */
import * as THREE from 'three';

/** Where the headset's room is in the office: its origin, and how far it's turned about the vertical. */
export interface Rig {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
}

/** A head (or anything else) in the headset's room, or in the office: where it is and which way it faces. */
export interface Pose {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Which way it looks, in camYaw's convention. */
  readonly yaw: number;
}

/** A point on the floor plan. */
export interface Flat {
  readonly x: number;
  readonly z: number;
}

/** The angle `a` brought into (-π, π]. */
export function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** (x, z) turned by `yaw` about the vertical, as three.js turns things (Object3D.rotation.y). */
export function turnFlat(x: number, z: number, yaw: number): Flat {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return { x: c * x + s * z, z: -s * x + c * z };
}

/**
 * The offset reference space for rig `O`, as an XRRigidTransform's position and orientation: the
 * inverse of putting the room at O (a pose read through it is O + R(O.yaw)·local).
 */
export function offsetOf(o: Rig): { position: { x: number; y: number; z: number }; orientation: { x: number; y: number; z: number; w: number } } {
  const p = turnFlat(-o.x, -o.z, -o.yaw);
  return { position: { x: p.x, y: -o.y, z: p.z }, orientation: { x: 0, y: Math.sin(-o.yaw / 2), z: 0, w: Math.cos(-o.yaw / 2) } };
}

/** Where a pose in the headset's room is in the office, with rig `O`. */
export function headWorld(o: Rig, local: Pose): Pose {
  const p = turnFlat(local.x, local.z, o.yaw);
  return { x: o.x + p.x, y: o.y + local.y, z: o.z + p.z, yaw: wrap(o.yaw + local.yaw) };
}

/** The same, for a whole quaternion: the room's turn, then the pose's own. */
export function quatWorld(o: Rig, local: THREE.Quaternion, out = new THREE.Quaternion()): THREE.Quaternion {
  return out.setFromAxisAngle(UP, o.yaw).multiply(local);
}
const UP = new THREE.Vector3(0, 1, 0);

/**
 * The rig that puts a head at `local` in the room over `at` in the office, looking along `yaw`,
 * with the room's floor at height `y`: where you're placed (entering VR, recentring, a turn).
 */
export function placeHead(local: Pose, at: Flat, yaw: number, y: number): Rig {
  const turn = wrap(yaw - local.yaw);
  const p = turnFlat(local.x, local.z, turn);
  return { x: at.x - p.x, y, z: at.z - p.z, yaw: turn };
}

/** The rig turned by `a` about the head at `local`: the head stays where it is in the office, and looks `a` further round. */
export function turnAbout(o: Rig, local: Pose, a: number): Rig {
  const head = headWorld(o, local);
  return placeHead(local, head, head.yaw + a, o.y);
}

/** The rig moved along by your feet having moved `d` (the stick, a seat, a car, the elevator). */
export function carry(o: Rig, d: Flat): Rig {
  return { ...o, x: o.x + d.x, z: o.z + d.z };
}

/**
 * Walking about the room, your head wanted to be at `wanted` and your feet only got to `got` (a wall
 * was in the way): your head may lean `slack` past your feet, and for the rest the room moves back,
 * so your head stays out of the wall.
 */
export function pushBack(o: Rig, wanted: Flat, got: Flat, slack = 0): Rig {
  const dx = wanted.x - got.x;
  const dz = wanted.z - got.z;
  const len = Math.hypot(dx, dz);
  if (len <= slack) return o;
  const k = (len - slack) / len;
  return { ...o, x: o.x - dx * k, z: o.z - dz * k };
}

/** Whether two rigs are far enough apart to be worth a new reference space: a millimetre, or a twentieth of a degree. */
export function rigMoved(a: Rig, b: Rig): boolean {
  return Math.abs(a.x - b.x) > 1e-3 || Math.abs(a.y - b.y) > 1e-3 || Math.abs(a.z - b.z) > 1e-3 || Math.abs(wrap(a.yaw - b.yaw)) > 1e-3;
}

/** A head's yaw (camYaw's convention) and pitch (lookPitch's: up +) from its quaternion. */
export function yawPitch(q: THREE.Quaternion): { yaw: number; pitch: number } {
  const e = EULER.setFromQuaternion(q, 'YXZ');
  return { yaw: e.y, pitch: e.x };
}
const EULER = new THREE.Euler();

/** How far your head can look round before your body turns to follow it, and how near it comes. */
export const BODY_SLACK = THREE.MathUtils.degToRad(50);
export const BODY_SETTLED = THREE.MathUtils.degToRad(4);

/** Your body's facing (PlayerController.facing), and whether it's turning to catch up with your head. */
export interface Body {
  readonly yaw: number;
  readonly turning: boolean;
}

/**
 * Your body turning after your head (`head` is the facing it looks along, yaw + π): not at all
 * while you only look about, but once you look past BODY_SLACK it comes round to face the same way,
 * and while you walk it keeps up. So everyone else sees you turn your head before you turn round.
 */
export function bodyYaw(prev: Body, head: number, moving: boolean, dt: number): Body {
  const d = wrap(head - prev.yaw);
  const turning = moving || Math.abs(d) > BODY_SLACK || (prev.turning && Math.abs(d) > BODY_SETTLED);
  if (!turning) return { yaw: prev.yaw, turning: false };
  const k = 1 - Math.exp(-dt * (moving ? 12 : 6));
  return { yaw: wrap(prev.yaw + d * k), turning };
}
