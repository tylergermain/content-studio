// Friday One, the toon four-seat helicopter (protocol/heli.ts): its size, where its seats and doors
// are, what of it can hit something, and how it flies. It's a kinematic arcade model, not a
// simulation: the pilot's page flies it with `fly`, and the office checks what it says against the
// same solids and ground (heli-world.ts). Pure: both sides use it, and a step makes nothing new.
//
// Its own frame: the origin is on the ground between the skids under the rotor's hub, and its nose
// points down +z when its yaw is 0 (the way rotY goes). Turning left (+1) adds to its yaw.

import type { Box } from './garage.js';
import { GROUNDS, PARK, type Solid, type StreetPoint } from './mainstreet.js';
import type { HeliPose, HeliState } from './protocol/heli.js';
import { squareHits, turnedHits } from './heli-shapes.js';

/**
 * Its size (meters): the main rotor `rotor` round on its hub `hub` over the skids, the tail rotor, the
 * skids `skids` apart, the cabin (its middle `cabin.z` ahead of the hub), the tail boom, and how far
 * behind the hub the tail reaches (`tail`). The four seats (0 the pilot's, front right) and the two
 * doors in its own frame; you board within `reach` of a door; nobody within `clear` of the hub when it
 * sets down; the pilot's eye `eye` over the skids.
 */
export const HELI = {
  rotor: 3.9,
  hub: 2.9,
  tailRotor: 0.65,
  skids: 2.3,
  cabin: { width: 2.2, height: 2.3, length: 3.6, z: 0.4 },
  boom: 5,
  tail: 7.3,
  seats: [
    { x: -0.45, y: 0.95, z: 1.1 },
    { x: 0.45, y: 0.95, z: 1.1 },
    { x: -0.45, y: 0.95, z: -0.1 },
    { x: 0.45, y: 0.95, z: -0.1 },
  ],
  doors: [
    { x: -1.35, z: 0.6 },
    { x: 1.35, z: 0.6 },
  ],
  reach: 4,
  clear: 5,
  eye: 1.75,
} as const;

/**
 * How it flies: the rotor spools up in `spoolUp` s and down in `spoolDown`, and lifts from spin `lift`;
 * `forward` and `backward` m/s at most, speeding up at `accel` and slowing at `brake` m/s²; climbing
 * `climb` and sinking `sink` m/s, only `sinkNear` within `near` of the ground; turning `yaw` rad/s;
 * leaning `pitch` into speed and `bank` into turns. Steps of `step` s, moved `sub` m at most at a
 * time. No higher than `ceiling` over the street, nor further than GROUNDS from the tower. It sets down
 * slower than `land.across` along the ground and `land.down` down. The office won't take a pose that
 * got further than `maxSpeed` m/s from the last.
 */
export const FLIGHT = {
  spoolUp: 3,
  spoolDown: 6,
  lift: 0.85,
  forward: 28,
  backward: 8,
  accel: 7,
  brake: 9,
  climb: 7,
  sink: 5,
  sinkNear: 1.5,
  near: 4,
  yaw: 1.2,
  pitch: 0.22,
  bank: 0.3,
  step: 1 / 60,
  sub: 0.25,
  ceiling: 200,
  land: { across: 3, down: 2 },
  maxSpeed: 45,
} as const;

/**
 * What of it can hit something: the square round its rotor's disc, along the street's axes so it's the
 * same however it's turned, from `bottom` over the skids to `top`, just over the hub; and its tail, a
 * box `tail.half` either side of the boom from the back of the cabin (`tail.front`) to the tail's end
 * (`tail.back`), `tail.bottom` to `tail.top` over the skids, turned with it, so yawing beside a wall
 * can't swing it in. A step is clear when neither meets anything solid.
 */
export const BODY = {
  bottom: 0.3,
  top: HELI.hub + 0.3,
  tail: { front: HELI.cabin.z - HELI.cabin.length / 2, back: -HELI.tail, half: 0.8, bottom: 0.8, top: 3 },
} as const;

/** The ground its skids stand on, in its own frame: `half` either side, from `back` to `front`. */
export const SKIDS = { half: HELI.skids / 2 + 0.15, back: -1.6, front: 2 } as const;

/** Over a spot it may not set down on, it won't come lower than this over the ground: it holds a hover there. */
export const LAND_HOLD = 3;

/** How much of the speed it hit something at it bounces back with. */
export const BOUNCE = 0.3;

/**
 * The rotor's downwash: someone on the ground within `reach` of the hub is pushed out at up to `push`
 * m/s, less the further out and the higher it is, while it's flying no more than `below` over the
 * ground and its rotor's past `spin`. Only someone whose feet are within `feet` of the ground there.
 */
export const WASH = { reach: 7, push: 1.5, below: 10, feet: 1, spin: 0.5 } as const;

/** Where it lives: on its pad in Friday Park, nose to the tower. */
export const homePose = (): HeliPose => ({ x: PARK.pad.x, h: PARK.pad.deck, z: PARK.pad.z, yaw: PARK.pad.yaw, pitch: 0, roll: 0, spin: 0 });
/** Friday One as it is with no heli.json: parked at home, nobody aboard. */
export const parkedHeli = (): HeliState => ({ pose: homePose(), landed: true, stage: 'parked', pad: 'park', crew: [] });

/** A heading in -π..π. */
export const wrapYaw = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** A point in its own frame (x, y up from the skids, z), in the street frame; into `out` when given. */
export function heliToStreet(pose: HeliPose, p: { x: number; y: number; z: number }, out: StreetPoint = { x: 0, h: 0, z: 0 }): StreetPoint {
  const c = Math.cos(pose.yaw);
  const s = Math.sin(pose.yaw);
  out.x = pose.x + p.x * c + p.z * s;
  out.z = pose.z - p.x * s + p.z * c;
  out.h = pose.h + p.y;
  return out;
}

/** The ground it takes up, as it stands: the box round its rotor's disc and its tail, at its yaw. */
export function heliFootprint(pose: HeliPose): Box {
  const tx = pose.x - Math.sin(pose.yaw) * HELI.tail;
  const tz = pose.z - Math.cos(pose.yaw) * HELI.tail;
  const r = HELI.rotor;
  return { minX: Math.min(pose.x - r, tx - 1), maxX: Math.max(pose.x + r, tx + 1), minZ: Math.min(pose.z - r, tz - 1), maxZ: Math.max(pose.z + r, tz + 1) };
}

/** How far (x, z) is from the nearer of its two doors, along the ground. */
export function doorDistance(pose: HeliPose, at: { x: number; z: number }): number {
  const c = Math.cos(pose.yaw);
  const s = Math.sin(pose.yaw);
  let best = Infinity;
  for (const d of HELI.doors) best = Math.min(best, Math.hypot(pose.x + d.x * c + d.z * s - at.x, pose.z - d.x * s + d.z * c - at.z));
  return best;
}

/** Half the tail box's length, and its middle, along it. */
const TAIL_HL = (BODY.tail.front - BODY.tail.back) / 2;
const TAIL_MID = (BODY.tail.front + BODY.tail.back) / 2;

/** Its tail's box in the street frame, into `out`: its middle, and the sine and cosine of its heading. */
export function tailOf(p: { x: number; z: number; yaw: number }, out: { x: number; z: number; s: number; c: number }): { x: number; z: number; s: number; c: number } {
  out.s = Math.sin(p.yaw);
  out.c = Math.cos(p.yaw);
  out.x = p.x + TAIL_MID * out.s;
  out.z = p.z + TAIL_MID * out.c;
  return out;
}
const TAIL = { x: 0, z: 0, s: 0, c: 1 };

/**
 * The first of `solids` its body meets at `p`, or null: the rotor's square and the tail. With `rise`,
 * the body reaches that much higher, so it's the column over it up to there (flying home asks whether
 * it can climb straight up).
 */
export function bodyHit(p: HeliPose, solids: readonly Solid[], rise = 0): Solid | null {
  const bottom = p.h + BODY.bottom;
  const top = p.h + BODY.top + rise;
  const tb = p.h + BODY.tail.bottom;
  const tt = p.h + BODY.tail.top + rise;
  const t = tailOf(p, TAIL);
  for (const o of solids) {
    if (o.bottom < top && o.top > bottom && squareHits(o, p.x, p.z, HELI.rotor)) return o;
    if (o.bottom < tt && o.top > tb && turnedHits(o, t.x, t.z, t.s, t.c, BODY.tail.half, TAIL_HL)) return o;
  }
  return null;
}

/** The highest the ground gets in a box, by the world's own measure or, without one, at a grid of points in it. */
function groundIn(world: FlyWorld, minX: number, maxX: number, minZ: number, maxZ: number): number {
  if (world.terrainOver) return world.terrainOver(minX, maxX, minZ, maxZ);
  let h = -Infinity;
  for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) h = Math.max(h, world.terrain(minX + ((maxX - minX) * i) / 4, minZ + ((maxZ - minZ) * j) / 4));
  return h;
}

/**
 * How low it can be at (x, z) turned `yaw`: its skids on the highest ground under them, with the
 * body's bottom over the ground under its rotor and its tail.
 */
export function groundUnder(p: { x: number; z: number; yaw: number }, world: FlyWorld): number {
  const r = HELI.rotor;
  const t = tailOf(p, TAIL);
  const as = Math.abs(t.s);
  const ac = Math.abs(t.c);
  // The boxes round the tail and round the skids, as they're turned.
  const tx = BODY.tail.half * ac + TAIL_HL * as;
  const tz = BODY.tail.half * as + TAIL_HL * ac;
  const sl = (SKIDS.front - SKIDS.back) / 2;
  const sm = (SKIDS.front + SKIDS.back) / 2;
  const sx = p.x + sm * t.s;
  const sz = p.z + sm * t.c;
  const kx = SKIDS.half * ac + sl * as;
  const kz = SKIDS.half * as + sl * ac;
  return Math.max(
    groundIn(world, p.x - r, p.x + r, p.z - r, p.z + r) - BODY.bottom,
    groundIn(world, t.x - tx, t.x + tx, t.z - tz, t.z + tz) - BODY.tail.bottom,
    groundIn(world, sx - kx, sx + kx, sz - kz, sz + kz),
  );
}

/**
 * The push its downwash gives someone standing at `at` (m/s along the ground, into `out`), with the
 * ground under them `ground` over the street. None while it's down or spinning down (so anyone can walk
 * up to a door and get in), none when it's more than WASH.below over that ground, none for anyone not
 * on the ground under it (up on a balcony, say), and none past WASH.reach; less the further out and
 * the higher it is. The page moves its own player by it, as walking does, never through anything.
 */
export function rotorWash(pose: HeliPose, landed: boolean, at: StreetPoint, out: { x: number; z: number } = { x: 0, z: 0 }, ground = 0): { x: number; z: number } {
  out.x = 0;
  out.z = 0;
  if (landed || pose.spin < WASH.spin) return out;
  const above = pose.h - ground;
  if (above < -1 || above > WASH.below || Math.abs(at.h - ground) > WASH.feet) return out;
  const dx = at.x - pose.x;
  const dz = at.z - pose.z;
  const d = Math.hypot(dx, dz);
  if (d >= WASH.reach) return out;
  const k = WASH.push * (1 - d / WASH.reach) * Math.min(1, (pose.spin - WASH.spin) / (1 - WASH.spin)) * (1 - (0.5 * Math.max(0, above)) / WASH.below);
  // Right under the hub there's no way out but off to its side.
  if (d < 1e-3) {
    out.x = Math.cos(pose.yaw) * k;
    out.z = -Math.sin(pose.yaw) * k;
    return out;
  }
  out.x = (dx / d) * k;
  out.z = (dz / d) * k;
  return out;
}

/** What the pilot's holding: forward (+1) or back (-1), turning left (+1) or right (-1), up (+1) or down (-1), and whether the engine's on. */
export interface HeliInput {
  forward: number;
  turn: number;
  lift: number;
  engine: boolean;
}

/** The pilot's page's helicopter: its pose, how fast it's going in the street frame (m/s), and whether it's down. */
export interface Flight {
  pose: HeliPose;
  vx: number;
  vz: number;
  vh: number;
  landed: boolean;
}

/**
 * What it flies in: what's solid (heliSolids in heli-world.ts, and whatever the caller adds), how high
 * the ground is, and why it may not set down at (x, z) turned `yaw` (null where it may). Given
 * `terrainOver` (heliTerrainOver), the highest the ground gets in a box is measured rather than looked
 * at point by point, which is quicker and never misses a peak.
 */
export interface FlyWorld {
  solids: readonly Solid[];
  terrain(x: number, z: number): number;
  whyNotLand(x: number, z: number, yaw: number): string | null;
  terrainOver?(minX: number, maxX: number, minZ: number, maxZ: number): number;
}

/**
 * What happened in a step: the speed it hit something at (0: nothing), touching down or lifting off,
 * why it won't come down here (it's holding a hover), and whether it's at the edge of town.
 */
export interface Flown {
  bump: number;
  touchdown: boolean;
  liftoff: boolean;
  refused: string | null;
  edge?: boolean;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const toward = (v: number, target: number, rate: number) => v + clamp(target - v, -rate, rate);

/** How quickly it changes how fast it's going up or down (m/s²), how quickly it leans over, and how hard the edge of town draws it back (m/s at most). */
const VERTICAL = 12;
const LEAN = 3;
const EDGE = 5;

/** Why it may not set down at `p`: the world's say, or ground too uneven under it. */
function landingWhy(p: HeliPose, world: FlyWorld): string | null {
  const why = world.whyNotLand(p.x, p.z, p.yaw);
  if (why) return why;
  const r = HELI.rotor;
  return groundIn(world, p.x - r, p.x + r, p.z - r, p.z + r) > 0.3 ? 'Too steep to land' : null;
}

/** Its pitch and roll easing toward leaning into `along` m/s and turning `turn`. */
function lean(p: HeliPose, along: number, turn: number, dt: number) {
  const k = 1 - Math.exp(-LEAN * dt);
  const pitch = FLIGHT.pitch * clamp(along / (along >= 0 ? FLIGHT.forward : FLIGHT.backward), -1, 1);
  const roll = FLIGHT.bank * turn * clamp(0.35 + Math.abs(along) / FLIGHT.forward, 0, 1);
  p.pitch += (pitch - p.pitch) * k;
  p.roll += (roll - p.roll) * k;
}

/** Whether it fits at `q`: clear of the solids (or already in one, flying out) and not under the ground. */
function fits(q: HeliPose, world: FlyWorld, stuck: boolean): boolean {
  return (stuck || bodyHit(q, world.solids) === null) && q.h >= groundUnder(q, world) - 1e-6;
}

/** Scratch, for trying a move before making it. */
const TRY: HeliPose = { x: 0, h: 0, z: 0, yaw: 0, pitch: 0, roll: 0, spin: 0 };

/**
 * Moves it on by `k` seconds of its speed and turns it `dyaw`, as far as it can go: the turn first,
 * stopped short if it would swing the tail into something; then across the ground, sliding along
 * whatever it meets and bouncing off it; then up or down, never into the ground. Whatever it was
 * already in (something went up round it) it flies out of freely. Hands back how fast it was coming
 * down when it met the ground, or -1.
 */
function moveBy(f: Flight, k: number, dyaw: number, world: FlyWorld, out: Flown): number {
  const p = f.pose;
  const stuck = bodyHit(p, world.solids) !== null;
  Object.assign(TRY, p);
  if (dyaw !== 0) {
    TRY.yaw = p.yaw + dyaw;
    if (fits(TRY, world, stuck)) p.yaw = TRY.yaw;
    else TRY.yaw = p.yaw;
  }
  let hit = 0;
  const dx = f.vx * k;
  const dz = f.vz * k;
  if (dx !== 0 || dz !== 0) {
    TRY.x = p.x + dx;
    TRY.z = p.z + dz;
    if (fits(TRY, world, stuck)) {
      p.x = TRY.x;
      p.z = TRY.z;
    } else {
      // Blocked: slide along whichever way is still clear, and bounce off the other.
      TRY.z = p.z;
      const alongX = dx !== 0 && fits(TRY, world, stuck);
      TRY.x = p.x;
      TRY.z = p.z + dz;
      const alongZ = dz !== 0 && fits(TRY, world, stuck);
      if (alongX && !alongZ) {
        p.x += dx;
        hit += f.vz * f.vz;
        f.vz *= -BOUNCE;
      } else if (alongZ && !alongX) {
        p.z += dz;
        hit += f.vx * f.vx;
        f.vx *= -BOUNCE;
      } else {
        hit += f.vx * f.vx + f.vz * f.vz;
        f.vx *= -BOUNCE;
        f.vz *= -BOUNCE;
      }
    }
    TRY.x = p.x;
    TRY.z = p.z;
  }
  let met = -1;
  const dh = f.vh * k;
  if (dh !== 0) {
    const ground = groundUnder(p, world);
    TRY.h = Math.min(FLIGHT.ceiling, Math.max(ground, p.h + dh));
    if (stuck || bodyHit(TRY, world.solids) === null) {
      if (TRY.h <= ground && f.vh < 0) {
        met = -f.vh;
        f.vh = 0;
      }
      p.h = TRY.h;
    } else {
      // Up into something it bounces off; down onto something (a roof) it stops, and hovers on it.
      hit += f.vh * f.vh;
      f.vh = f.vh > 0 ? -BOUNCE * f.vh : 0;
    }
  }
  if (hit > 0) out.bump = Math.max(out.bump, Math.sqrt(hit));
  return met;
}

/** One step of flight, at most FLIGHT.step long. */
function flyStep(f: Flight, input: HeliInput, dt: number, world: FlyWorld, out: Flown) {
  const p = f.pose;
  p.spin = input.engine ? Math.min(1, p.spin + dt / FLIGHT.spoolUp) : Math.max(0, p.spin - dt / FLIGHT.spoolDown);
  const lifting = p.spin >= FLIGHT.lift;
  const forward = clamp(input.forward || 0, -1, 1);
  const turn = clamp(input.turn || 0, -1, 1);
  const lift = clamp(input.lift || 0, -1, 1);
  if (f.landed) {
    f.vx = f.vz = f.vh = 0;
    lean(p, 0, 0, dt);
    if (!lifting || lift <= 0) return;
    f.landed = false;
    out.liftoff = true;
  }
  // Along the nose toward what the pilot wants, quicker to slow than to speed up; drift sideways (off a bump) dies away.
  const s = Math.sin(p.yaw);
  const c = Math.cos(p.yaw);
  const want = forward >= 0 ? forward * FLIGHT.forward : forward * FLIGHT.backward;
  let along = f.vx * s + f.vz * c;
  const speeding = Math.abs(want) > Math.abs(along) && want * along >= 0;
  along = toward(along, want, (speeding ? FLIGHT.accel : FLIGHT.brake) * dt);
  const across = toward(f.vx * c - f.vz * s, 0, FLIGHT.brake * dt);
  f.vx = along * s + across * c;
  f.vz = along * c - across * s;
  // Up and down: climbing or sinking as the pilot asks, holding its height when they don't, and gently near the ground.
  const above = p.h - groundUnder(p, world);
  const sink = above < FLIGHT.near ? FLIGHT.sinkNear : FLIGHT.sink;
  f.vh = toward(f.vh, lifting ? (lift > 0 ? lift * FLIGHT.climb : lift * sink) : -sink, VERTICAL * dt);
  if (above < FLIGHT.near) f.vh = Math.max(f.vh, -FLIGHT.sinkNear);
  // Coming down over somewhere it may not land, it holds its height instead, LAND_HOLD up at most.
  if (f.vh < 0 && above < LAND_HOLD + 0.01) {
    const why = landingWhy(p, world);
    if (why) {
      out.refused = why;
      f.vh = 0;
    }
  }
  if (p.h >= FLIGHT.ceiling && f.vh > 0) f.vh = 0;
  // The edge of town: no further out, and drawn gently back in.
  const d = Math.hypot(p.x, p.z);
  if (d > GROUNDS) {
    const ox = p.x / d;
    const oz = p.z / d;
    const back = Math.max(0, f.vx * ox + f.vz * oz) + Math.min(EDGE, (d - GROUNDS) * 2);
    f.vx -= ox * back;
    f.vz -= oz * back;
    out.edge = true;
  }
  // A substep at a time, none moving any of it further than FLIGHT.sub (the tail's end swings furthest in a turn).
  const dyaw = turn * FLIGHT.yaw * dt;
  const reach = Math.hypot(f.vx, f.vh, f.vz) * dt + Math.abs(dyaw) * HELI.tail;
  const n = Math.max(1, Math.ceil(reach / FLIGHT.sub));
  let met = -1;
  for (let i = 0; i < n; i++) met = Math.max(met, moveBy(f, dt / n, dyaw / n, world, out));
  if (Math.abs(p.yaw) > Math.PI) p.yaw = wrapYaw(p.yaw);
  lean(p, f.vx * Math.sin(p.yaw) + f.vz * Math.cos(p.yaw), turn, dt);
  // On the ground: down, if it's slow and level and may land here; else it skims along over it.
  const ground = groundUnder(p, world);
  if (p.h > ground + 0.02 || f.vh > 0) return;
  const why = landingWhy(p, world);
  if (why) {
    out.refused = why;
    return;
  }
  if (met >= FLIGHT.land.down) out.bump = Math.max(out.bump, met);
  if (Math.hypot(f.vx, f.vz) >= FLIGHT.land.across || met >= FLIGHT.land.down) return;
  p.h = ground;
  f.landed = true;
  f.vx = f.vz = f.vh = 0;
  out.touchdown = true;
}

/**
 * Flies `f` on by `dt` seconds (a quarter of a second at most) with the pilot holding `input`, in
 * `world`, a FLIGHT.step at a time. The rotor spools up while the engine's on and lifts from
 * FLIGHT.lift; with no keys held it slows to a hover, holds its height and levels out; it bumps off
 * whatever's solid, can't come down through the ground, and sets down only slowly where `world` lets
 * it. What happened goes into `out` when given, so a frame makes nothing new.
 */
export function fly(f: Flight, input: HeliInput, dt: number, world: FlyWorld, out: Flown = { bump: 0, touchdown: false, liftoff: false, refused: null, edge: false }): Flown {
  out.bump = 0;
  out.touchdown = false;
  out.liftoff = false;
  out.refused = null;
  out.edge = false;
  let left = clamp(dt, 0, 0.25);
  while (left > 1e-9) {
    const step = Math.min(left, FLIGHT.step);
    flyStep(f, input, step, world, out);
    left -= step;
  }
  return out;
}
