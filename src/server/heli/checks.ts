// What the office makes of a pose the pilot's page sends (heli.fly), before anyone else is told it:
// every number a number and in range, no further from the last pose it took than Friday One could
// have flown since, and not in anything solid or under the ground. Pure, so the tests can ask it.
import { FLIGHT, bodyHit, wrapYaw, type FlyWorld } from '../../shared/heli.js';
import { GROUNDS } from '../../shared/mainstreet.js';
import type { HeliPose } from '../../shared/protocol.js';

/**
 * The speed check's leeway: `slack` m over what it could have flown, for the network's noise; and the
 * most flying a pose is let have in hand (`gap` s: the time since the pose before, and any left over
 * from it), so poses the network held up and let through in a bunch, or that the throttle dropped,
 * don't make the next one seem too far, yet a pilot who goes quiet can't jump far when they speak again.
 */
export const STEP = { slack: 1.5, gap: 1.5 } as const;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The pose the page sent, every number checked: its lean and spin clamped and its heading wrapped; or why it won't do. */
export function cleanPose(raw: unknown): HeliPose | string {
  if (!raw || typeof raw !== 'object') return 'Lost track of it';
  const r = raw as Record<string, unknown>;
  const nums = [r.x, r.h, r.z, r.yaw, r.pitch, r.roll, r.spin];
  if (!nums.every((v) => typeof v === 'number' && Number.isFinite(v))) return 'Lost track of it';
  const [x, h, z, yaw, pitch, roll, spin] = nums as number[];
  if (Math.abs(x) > GROUNDS + 50 || Math.abs(z) > GROUNDS + 50) return "That's the edge of town";
  if (h < 0) return 'Mind the ground!';
  if (h > FLIGHT.ceiling + 10) return 'Too high';
  return { x, h, z, yaw: wrapYaw(yaw), pitch: clamp(pitch, -0.6, 0.6), roll: clamp(roll, -0.6, 0.6), spin: clamp(spin, 0, 1) };
}

/**
 * Why the step from `last` to `next`, with `seconds` of flying in hand (at most STEP.gap), won't do:
 * further than FLIGHT.maxSpeed could take it in that, into something solid (unless it was already in
 * it, when something went up round it, and it's on its way out), or down through the ground. Null if
 * it'll do.
 */
export function stepWhy(last: HeliPose, next: HeliPose, seconds: number, world: FlyWorld): string | null {
  const t = clamp(seconds, 0, STEP.gap);
  if (Math.hypot(next.x - last.x, next.h - last.h, next.z - last.z) > FLIGHT.maxSpeed * t + STEP.slack) return 'Too fast';
  if (bodyHit(next, world.solids) && !bodyHit(last, world.solids)) return 'Mind the building!';
  if (next.h < world.terrain(next.x, next.z) - 1) return 'Mind the ground!';
  return null;
}
