// VR presence's numbers (protocol/vr.ts), shared by the page in the headset that sends a pose, the
// office that passes it on and the pages that show it: cleaning a pose up, putting a point in
// someone's body frame, when a pose has moved enough to send again, and how an arm turns to reach
// for a hand. Plain numbers, no three.js, so the server can use it too.

import type { VrPoint, VrPose } from './protocol/vr.js';

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export interface Q4 {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** How far a head turns from the body, looks up or down, and tilts (radians): any further is held there. */
export const HEAD_LIMITS = { yaw: 1.75, pitch: 1.45, roll: 0.9 } as const;
/** How far from between the eyes a hand can be (metres): an arm's length and some. */
export const HAND_REACH = 1.3;
/**
 * Where a real shoulder is from between the eyes, in the body frame, each side: what someone's arms
 * are aimed from when they're in VR, whatever their character's own build (see armAim).
 */
export const SHOULDER: Readonly<Record<'left' | 'right', V3>> = {
  left: { x: 0.18, y: -0.25, z: -0.07 },
  right: { x: -0.18, y: -0.25, z: -0.07 },
};
/** A pose goes out again once the head has turned about this far (radians: 2°)... */
export const TURN_STEP = (2 * Math.PI) / 180;
/** ...or a hand has moved this far (metres)... */
export const HAND_STEP = 0.015;
/** ...but no more often than this (ms), and at least this often while nothing moves (ms). */
export const POSE_EVERY_MS = 100;
export const POSE_HEARTBEAT_MS = 1000;
/** A pose older than this (ms) is let go of: they've stopped sending (gone, or a lost connection). */
export const POSE_STALE_MS = 2500;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (v: number, lim: number) => Math.max(-lim, Math.min(lim, v));
/** To the thousandth: a millimetre, or a twentieth of a degree. */
const round = (v: number) => Math.round(v * 1000) / 1000 || 0;

/** An angle brought round to -π..π. */
export const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** A point within reach of the eyes (pulled in along its line if it's further), to the millimetre; undefined if it isn't a point. */
function cleanPoint(raw: unknown): VrPoint | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const { x, y, z } = raw as Record<string, unknown>;
  if (!finite(x) || !finite(y) || !finite(z)) return undefined;
  const len = Math.hypot(x, y, z);
  const k = len > HAND_REACH ? HAND_REACH / len : 1;
  return { x: round(x * k), y: round(y * k), z: round(z * k) };
}

/**
 * `raw` as a pose the office passes on: its angles within HEAD_LIMITS, each hand within reach (a
 * hand that isn't a point is left out), rounded; null if it isn't a pose at all.
 */
export function cleanPose(raw: unknown): VrPose | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!finite(r.yaw) || !finite(r.pitch) || !finite(r.roll)) return null;
  const pose: VrPose = {
    yaw: round(clamp(wrap(r.yaw), HEAD_LIMITS.yaw)),
    pitch: round(clamp(r.pitch, HEAD_LIMITS.pitch)),
    roll: round(clamp(r.roll, HEAD_LIMITS.roll)),
  };
  const left = cleanPoint(r.left);
  const right = cleanPoint(r.right);
  if (left) pose.left = left;
  if (right) pose.right = right;
  return pose;
}

/**
 * `p` in the frame of a body standing at `origin` facing `facing` (a rotY: its front is +z turned
 * that far about the vertical): x to its left, y up, z ahead.
 */
export function bodyFrame(p: V3, origin: V3, facing: number): V3 {
  const dx = p.x - origin.x;
  const dz = p.z - origin.z;
  const c = Math.cos(facing);
  const s = Math.sin(facing);
  return { x: dx * c - dz * s, y: p.y - origin.y, z: dx * s + dz * c };
}

/** Where the head is and which way it looks, as the office's camera has it (yaw as camYaw, pitch + up, roll + toward the left shoulder). */
export interface HeadNow {
  position: V3;
  yaw: number;
  pitch: number;
  roll: number;
}

/**
 * The pose to send for a head and hands (world positions; null for a hand that isn't tracked) on a
 * body facing `facing`: the head's turn from the body (a camera looking along camYaw faces camYaw + π),
 * and each hand from between the eyes, in the body frame.
 */
export function poseOf(head: HeadNow, facing: number, hands: { left?: V3 | null; right?: V3 | null }): VrPose {
  const raw: Record<string, unknown> = { yaw: wrap(head.yaw + Math.PI - facing), pitch: head.pitch, roll: head.roll };
  if (hands.left) raw.left = bodyFrame(hands.left, head.position, facing);
  if (hands.right) raw.right = bodyFrame(hands.right, head.position, facing);
  return cleanPose(raw)!;
}

const turned = (a: number, b: number) => Math.abs(wrap(a - b)) > TURN_STEP;
const moved = (a: VrPoint | undefined, b: VrPoint | undefined) => !a !== !b || (!!a && !!b && Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) > HAND_STEP);

/** Whether `now` is different enough from `last` (what was sent last, if anything) to be worth sending. */
export function poseMoved(last: VrPose | null, now: VrPose): boolean {
  if (!last) return true;
  return turned(last.yaw, now.yaw) || turned(last.pitch, now.pitch) || turned(last.roll, now.roll) || moved(last.left, now.left) || moved(last.right, now.right);
}

/**
 * The turn (Euler angles, order YXZ) that puts a character's head where `pose` says: its front is +z,
 * so looking up is a turn the other way about x than a camera's, and so is a tilt about z.
 */
export function headEuler(pose: VrPose): V3 {
  return { x: -pose.pitch, y: pose.yaw, z: -pose.roll };
}

/**
 * `d` (a unit vector) with its component `axis` set to `value` and the other two scaled to keep it a
 * unit vector (or, if they were nothing, `fallback` taking all of what's left).
 */
function pin(d: V3, axis: 'x' | 'z', value: number, fallback: 'y' | 'z'): V3 {
  const others = (['x', 'y', 'z'] as const).filter((a) => a !== axis);
  const rest = Math.sqrt(Math.max(0, 1 - value * value));
  const len = Math.hypot(d[others[0]], d[others[1]]);
  const out = { ...d, [axis]: value };
  if (len < 1e-6) {
    for (const a of others) out[a] = 0;
    out[fallback] = fallback === 'y' ? -rest : rest;
  } else for (const a of others) out[a] = (d[a] / len) * rest;
  return out;
}

/**
 * How an arm that hangs straight down (along -y) from `shoulder` turns to point at `hand` (both in the
 * body frame): never further across the chest than a little past the middle, nor far behind the back.
 */
export function armAim(shoulder: V3, hand: V3): Q4 {
  const len = Math.hypot(hand.x - shoulder.x, hand.y - shoulder.y, hand.z - shoulder.z);
  if (len < 1e-4) return { x: 0, y: 0, z: 0, w: 1 };
  let d: V3 = { x: (hand.x - shoulder.x) / len, y: (hand.y - shoulder.y) / len, z: (hand.z - shoulder.z) / len };
  // Across the chest: the hand on the shoulder's own side, or a little past the middle (then ahead).
  const side = shoulder.x < 0 ? -1 : 1;
  if (d.x * side < -0.5) d = pin(d, 'x', -0.5 * side, 'z');
  // Behind the back: only so far (then down).
  if (d.z < -0.7) d = pin(d, 'z', -0.7, 'y');
  // From (0, -1, 0) to d: about down × d, by the angle between them (as three's setFromUnitVectors).
  const w = 1 - d.y;
  if (w < 1e-6) return { x: 0, y: 0, z: 1, w: 0 };
  const n = Math.hypot(d.z, d.x, w);
  return { x: -d.z / n, y: 0, z: d.x / n, w: w / n };
}
