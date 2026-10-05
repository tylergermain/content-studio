// Friday One flying itself home, once its pilot has gone mid-flight (see server/heli/index.ts), a step
// at a time: first out from under anything over it (bar 2 overhangs the tower's west end from about 53
// to 81 m up, and a building site's crane slews its jib round 31 to 35 m up), a meter up off the ground
// first if it's lower and there's room, then sliding, at the height it's at and turned as it is, to the
// nearest spot with nothing over it; then straight up to a height clear of everything; across to over
// its pad; and down, slowly for the last few meters. If anyone's on the pad it hovers there and waits
// for them to step off, and after a while sets down instead on the first clear spot it finds round the
// pad. A trip that gets nowhere (not a meter on in HOME.stuck seconds, and nobody it's waiting for)
// says so, and the office sets it down where it is or puts it back on its pad.
import { FLIGHT, bodyHit, groundUnder, wrapYaw, type FlyWorld } from '../../shared/heli.js';
import { PARK, type Solid } from '../../shared/mainstreet.js';
import type { HeliPose } from '../../shared/protocol.js';

/**
 * How it flies home: climbing `climb` m/s; across at `cruise` m/s, no lower than `over` (the mast's top
 * is about 131 m up) and `clear` over the tower's top; edging out from under things at `away`, looking
 * up to `look` meters along `headings` headings for the nearest way out; down at `down` m/s, `slow` for
 * the last `near` meters; turning `turn` rad/s; leaning `lean` into the crossing. Over someone it waits
 * `wait` s, then looks for somewhere `ring` meters round the pad. Not a meter on in `stuck` s, it's
 * getting nowhere.
 */
export const HOME = { climb: 5, cruise: 18, away: 6, look: 60, headings: 16, over: 140, clear: 10, down: 3, slow: 1.2, near: 6, turn: 1.2, lean: 0.12, wait: 20, ring: [12, 20], stuck: 20 } as const;

/**
 * Where it's going: the spot it'll set down on (its pad, or a spot round it), the height it crosses at,
 * whether it's crossing yet, and since when (ms) it's been waiting to set down. Under something, where
 * it's edging out to, and when it last looked for that (ms), so with nowhere to go it looks again only
 * once a second; and where it was when it last got a meter on, and when (ms).
 */
export interface Trip {
  to: { x: number; z: number; yaw: number; pad: boolean };
  cruise: number;
  across: boolean;
  waiting: number;
  out: { x: number; z: number } | null;
  looked: number;
  mark: { x: number; h: number; z: number; at: number };
}

/** What it flies home through: the flight's world, who's underneath a spot, and how tall the tower stands with its mast. */
export interface HomeWorld extends FlyWorld {
  occupied(x: number, z: number, yaw: number): boolean;
  towerTop: number;
}

/** A trip home from `pose`, starting at `now` (ms). */
export function startTrip(pose: HeliPose, world: HomeWorld, now: number): Trip {
  const cruise = Math.min(FLIGHT.ceiling, Math.max(pose.h, HOME.over, world.towerTop + HOME.clear));
  return {
    to: { x: PARK.pad.x, z: PARK.pad.z, yaw: PARK.pad.yaw, pad: true },
    cruise,
    across: false,
    waiting: 0,
    out: null,
    looked: -Infinity,
    mark: { x: pose.x, h: pose.h, z: pose.z, at: now },
  };
}

/** What a step did: it's still flying, it has just started waiting over someone, it's off to another spot to set down, it's down, or it's getting nowhere. */
export type Leg = 'flying' | 'waiting' | 'moved' | 'landed' | 'stuck';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Turns it toward `yaw`, no faster than it turns. */
function turnToward(p: HeliPose, yaw: number, dt: number) {
  p.yaw = wrapYaw(p.yaw + clamp(wrapYaw(yaw - p.yaw), -HOME.turn * dt, HOME.turn * dt));
}

/** Scratch, for trying where it's going next. */
const NEXT: HeliPose = { x: 0, h: 0, z: 0, yaw: 0, pitch: 0, roll: 0, spin: 0 };

/** How far apart the spots it tries on its way out are (m): close enough that nothing solid slips between them. */
const OUT_STEP = FLIGHT.sub;

/** Whether it can be at `q`: clear of everything, and not into the ground. */
const clearAt = (q: HeliPose, world: HomeWorld) => !bodyHit(q, world.solids) && groundUnder(q, world) <= q.h + 1e-6;

/** Whether it can cross at `q`: clear of everything, its skids a meter over the ground. */
const fitsAt = (q: HeliPose, world: HomeWorld) => !bodyHit(q, world.solids) && groundUnder(q, world) <= q.h - 1;

/**
 * Where it edges out to from under `over`: the nearest spot it can slide to in a straight line as it is
 * (at its height, turned as it's turned), with nothing over it up to the height it crosses at. It looks
 * along HOME.headings headings, straight away from the middle of what's over it first and round from
 * there, so of two ways out as near, the one more away from it wins. Already in something (it went up
 * round it), it may slide through that until it's out. Null if there's no way out within HOME.look.
 */
function wayOut(p: HeliPose, over: Solid, trip: Trip, world: HomeWorld): { x: number; z: number } | null {
  const stuck = bodyHit(p, world.solids) !== null;
  const away = Math.atan2(p.x - (over.round ? over.round.x : (over.minX + over.maxX) / 2), p.z - (over.round ? over.round.z : (over.minZ + over.maxZ) / 2));
  let best: { x: number; z: number } | null = null;
  let far: number = HOME.look;
  Object.assign(NEXT, p);
  for (let k = 0; k < HOME.headings; k++) {
    // Straight away, then a heading either side of it, then two, and so on round to straight back.
    const a = away + (Math.ceil(k / 2) * (k % 2 ? 1 : -1) * 2 * Math.PI) / HOME.headings;
    const sx = Math.sin(a);
    const sz = Math.cos(a);
    let free = !stuck;
    for (let d = OUT_STEP; d < far; d += OUT_STEP) {
      NEXT.x = p.x + sx * d;
      NEXT.z = p.z + sz * d;
      if (!clearAt(NEXT, world)) {
        // Into something: no way out along here (unless it's still on its way out of what it was in).
        if (free) break;
        continue;
      }
      free = true;
      if (bodyHit(NEXT, world.solids, trip.cruise - NEXT.h)) continue;
      far = d;
      best = { x: NEXT.x, z: NEXT.z };
    }
  }
  return best;
}

/**
 * One step out from under `over`, something over it up to the height it crosses at: up toward a meter
 * off the ground if it's lower and there's room over it; else sliding at HOME.away toward its way out
 * (wayOut). Once it's there, or anything's in its way, it looks again; with nowhere to go, a second later.
 */
function edgeOut(p: HeliPose, over: Solid, trip: Trip, dt: number, now: number, world: HomeWorld) {
  const lift = groundUnder(p, world) + 1 - p.h;
  if (lift > 1e-6 && !bodyHit(p, world.solids, lift)) {
    p.h += Math.min(lift, HOME.climb * dt);
    trip.out = null;
    trip.looked = -Infinity;
    return;
  }
  if (!trip.out && now - trip.looked >= 1000) {
    trip.looked = now;
    trip.out = wayOut(p, over, trip, world);
  }
  const to = trip.out;
  if (!to) return;
  const dx = to.x - p.x;
  const dz = to.z - p.z;
  const d = Math.hypot(dx, dz);
  const step = Math.min(d, HOME.away * dt);
  Object.assign(NEXT, p);
  if (d > 1e-9) {
    NEXT.x = p.x + (dx / d) * step;
    NEXT.z = p.z + (dz / d) * step;
  }
  // Already in something it slides out freely; otherwise only where it fits.
  if (bodyHit(p, world.solids) === null && !clearAt(NEXT, world)) {
    trip.out = null;
    return;
  }
  p.x = NEXT.x;
  p.z = NEXT.z;
  if (d <= step) {
    trip.out = null;
    trip.looked = -Infinity;
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
  // A meter on (or waiting for someone to step out from under it) is getting somewhere.
  const m = trip.mark;
  if (trip.waiting || Math.hypot(pose.x - m.x, pose.h - m.h, pose.z - m.z) >= 1) {
    m.x = pose.x;
    m.h = pose.h;
    m.z = pose.z;
    m.at = now;
  } else if (now - m.at >= HOME.stuck * 1000) return 'stuck';
  pose.spin = Math.min(1, pose.spin + dt / FLIGHT.spoolUp);
  pose.roll = 0;
  const dx = trip.to.x - pose.x;
  const dz = trip.to.z - pose.z;
  const dist = Math.hypot(dx, dz);
  if (dist > 0.05) {
    pose.pitch = trip.across ? HOME.lean : 0;
    if (!trip.across) {
      // Nothing over it from here up to the height it crosses at, or it edges out from under first.
      const over = bodyHit(pose, world.solids, trip.cruise - pose.h);
      if (over) {
        edgeOut(pose, over, trip, dt, now, world);
        return 'flying';
      }
      trip.out = null;
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
