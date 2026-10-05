// Friday One flying itself home, once its pilot has gone mid-flight (see server/heli/index.ts), a step
// at a time: first out from under anything over it (bar 2 overhangs the tower's west end from about 53
// to 81 m up), sliding away from the tower until nothing's overhead; then straight up to a height clear
// of everything; across to over its pad; and down, slowly for the last few meters. If anyone's on the
// pad it hovers there and waits for them to step off, and after a while sets down instead on the
// first clear spot it finds round the pad.
import { FLIGHT, bodyHit, groundUnder, wrapYaw, type FlyWorld } from '../../shared/heli.js';
import { PARK } from '../../shared/mainstreet.js';
import type { HeliPose } from '../../shared/protocol.js';

/**
 * How it flies home: climbing `climb` m/s; across at `cruise` m/s, no lower than `over` (the mast's top
 * is about 131 m up) and `clear` over the tower's top; edging out from under things at `away`; down at
 * `down` m/s, `slow` for the last `near` meters; turning `turn` rad/s; leaning `lean` into the crossing.
 * Over someone it waits `wait` s, then looks for somewhere `ring` meters round the pad.
 */
export const HOME = { climb: 5, cruise: 18, away: 6, over: 140, clear: 10, down: 3, slow: 1.2, near: 6, turn: 1.2, lean: 0.12, wait: 20, ring: [12, 20] } as const;

/** Where it's going: the spot it'll set down on (its pad, or a spot round it), the height it crosses at, whether it's crossing yet, and since when (ms) it's been waiting to set down. */
export interface Trip {
  to: { x: number; z: number; yaw: number; pad: boolean };
  cruise: number;
  across: boolean;
  waiting: number;
}

/** What it flies home through: the flight's world, who's underneath a spot, and how tall the tower stands with its mast. */
export interface HomeWorld extends FlyWorld {
  occupied(x: number, z: number, yaw: number): boolean;
  towerTop: number;
}

/** A trip home from `pose`. */
export function startTrip(pose: HeliPose, world: HomeWorld): Trip {
  const cruise = Math.min(FLIGHT.ceiling, Math.max(pose.h, HOME.over, world.towerTop + HOME.clear));
  return { to: { x: PARK.pad.x, z: PARK.pad.z, yaw: PARK.pad.yaw, pad: true }, cruise, across: false, waiting: 0 };
}

/** What a step did: it's still flying, it has just started waiting over someone, it's off to another spot to set down, or it's down. */
export type Leg = 'flying' | 'waiting' | 'moved' | 'landed';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Turns it toward `yaw`, no faster than it turns. */
function turnToward(p: HeliPose, yaw: number, dt: number) {
  p.yaw = wrapYaw(p.yaw + clamp(wrapYaw(yaw - p.yaw), -HOME.turn * dt, HOME.turn * dt));
}

/** Scratch, for trying where it's going next. */
const NEXT: HeliPose = { x: 0, h: 0, z: 0, yaw: 0, pitch: 0, roll: 0, spin: 0 };

/** Whether it can be at `q`: clear of everything, its skids over the ground there. */
const fitsAt = (q: HeliPose, world: HomeWorld) => !bodyHit(q, world.solids) && groundUnder(q, world) <= q.h - 1;

/** Slides it away from the tower, as it's turned, to get out from under whatever's over it. Already in something, it slides out freely. */
function edgeOut(p: HeliPose, dt: number, world: HomeWorld) {
  const d = Math.hypot(p.x, p.z);
  Object.assign(NEXT, p);
  NEXT.x = p.x + (d > 0.01 ? p.x / d : -1) * HOME.away * dt;
  NEXT.z = p.z + (d > 0.01 ? p.z / d : 0) * HOME.away * dt;
  if (bodyHit(p, world.solids) || fitsAt(NEXT, world)) {
    p.x = NEXT.x;
    p.z = NEXT.z;
  }
}

/** The first clear spot to set down on round its pad, from `ring[0]` out to `ring[1]` meters, that it can get to at height `h`; null if there's none. */
function spotByPad(yaw: number, h: number, world: HomeWorld): Trip['to'] | null {
  for (let r = HOME.ring[0]; r <= HOME.ring[1]; r += 2) {
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      NEXT.x = PARK.pad.x + Math.sin(a) * r;
      NEXT.z = PARK.pad.z + Math.cos(a) * r;
      NEXT.yaw = yaw;
      NEXT.h = h;
      if (world.whyNotLand(NEXT.x, NEXT.z, yaw) || world.occupied(NEXT.x, NEXT.z, yaw) || !fitsAt(NEXT, world)) continue;
      NEXT.h = groundUnder(NEXT, world);
      if (bodyHit(NEXT, world.solids, h - NEXT.h)) continue;
      return { x: NEXT.x, z: NEXT.z, yaw, pad: false };
    }
  }
  return null;
}

/** One step of the trip home, `dt` s long at `now` (ms): moves `pose` on, and says what happened. */
export function homeStep(pose: HeliPose, trip: Trip, dt: number, now: number, world: HomeWorld): Leg {
  pose.spin = Math.min(1, pose.spin + dt / FLIGHT.spoolUp);
  pose.roll = 0;
  const dx = trip.to.x - pose.x;
  const dz = trip.to.z - pose.z;
  const dist = Math.hypot(dx, dz);
  if (dist > 0.05) {
    pose.pitch = trip.across ? HOME.lean : 0;
    if (!trip.across) {
      // Nothing over it from here up to the height it crosses at, or it edges out from under first.
      if (bodyHit(pose, world.solids, trip.cruise - pose.h)) {
        edgeOut(pose, dt, world);
        return 'flying';
      }
      if (pose.h < trip.cruise) {
        pose.h = Math.min(trip.cruise, pose.h + HOME.climb * dt);
        return 'flying';
      }
      trip.across = true;
    }
    turnToward(pose, Math.atan2(dx, dz), dt);
    // Across town at speed; over to a spot by the pad, low and slow.
    const step = Math.min(dist, (trip.to.pad ? HOME.cruise : HOME.away) * dt);
    Object.assign(NEXT, pose);
    NEXT.x = pose.x + (dx / dist) * step;
    NEXT.z = pose.z + (dz / dist) * step;
    // Something ahead (the mountains, if that's where it was): up over it rather than into it.
    if (!fitsAt(NEXT, world)) {
      pose.h = Math.min(FLIGHT.ceiling, pose.h + HOME.climb * dt);
      trip.cruise = Math.max(trip.cruise, pose.h);
      return 'flying';
    }
    pose.x = NEXT.x;
    pose.z = NEXT.z;
    return 'flying';
  }
  // Over its spot: turned the way it parks, and down.
  pose.x = trip.to.x;
  pose.z = trip.to.z;
  pose.pitch = 0;
  turnToward(pose, trip.to.yaw, dt);
  const ground = groundUnder(pose, world);
  if (pose.h > ground + HOME.near + 1e-6) {
    pose.h = Math.max(ground + HOME.near, pose.h - HOME.down * dt);
    return 'flying';
  }
  // The last few meters, only with nobody underneath: else it holds where it is, and after a while
  // goes to set down by the pad instead (and if there's nowhere, waits a while again).
  if (world.occupied(pose.x, pose.z, pose.yaw)) {
    if (!trip.waiting) {
      trip.waiting = now;
      return 'waiting';
    }
    if (now - trip.waiting < HOME.wait * 1000) return 'flying';
    const spot = spotByPad(pose.yaw, pose.h, world);
    trip.waiting = now;
    if (!spot) return 'flying';
    trip.to = spot;
    trip.cruise = pose.h;
    trip.waiting = 0;
    return 'moved';
  }
  trip.waiting = 0;
  pose.h = Math.max(ground, pose.h - HOME.slow * dt);
  if (pose.h > ground + 1e-6) return 'flying';
  pose.h = ground;
  return 'landed';
}
