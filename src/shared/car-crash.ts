import { CAR, type Box, type CarPose } from './garage.js';

// Cars running into things, and into each other (a driver's page, client/features/cars/physics.ts):
// where they touch, by separating axes (as overlaps in shared/garage.ts finds whether), with how far
// in they are and which way is out; and what the knock does to each, as two equal masses bounce: the
// body gives a little (it's no perfect bounce), it scrapes along whatever it hits, and a knock off its
// middle spins it round.

/** Where two things touch: the way out (a unit vector, from what was hit toward the car), how far in, and the point. */
export interface Contact {
  nx: number;
  nz: number;
  depth: number;
  x: number;
  z: number;
}

/** What a knock does to a car: its velocity changes by (x, z) m/s, its spin by `spin` radians a second. */
export interface Kick {
  x: number;
  z: number;
  spin: number;
}

/** How hard a car is to spin, for its mass: a box's, CAR long and wide (m²). */
const INERTIA = (CAR.length ** 2 + CAR.width ** 2) / 12;
/** How much of the speed it hit at comes back as a bounce. */
const BOUNCE = 0.3;
/** How much rubbing along what it hit slows it, at most, for the knock. */
const SCRAPE = 0.3;
/** How much of the spin a knock would give it, really: tyres on the ground hold some of it. */
const SPIN = 0.6;
/** The fastest a knock spins a car (radians a second). */
const MAX_SPIN = 6;
/** How far past touching a car's pushed out of what it ran into (m), so it's clear of it, not still a hair in. */
const SKIN = 1e-3;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** A rectangle on the ground: its middle, its two axes (unit vectors) and how far it goes along each. */
interface Rect {
  x: number;
  z: number;
  axes: [number, number][];
  half: [number, number];
}

/** A car's footprint: across it (its left) and along it (its nose). */
function carRect(p: { x: number; z: number; rotY: number }): Rect {
  const s = Math.sin(p.rotY);
  const c = Math.cos(p.rotY);
  return { x: p.x, z: p.z, axes: [[c, -s], [s, c]], half: [CAR.width / 2, CAR.length / 2] };
}

function boxRect(b: Box): Rect {
  return { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2, axes: [[1, 0], [0, 1]], half: [(b.maxX - b.minX) / 2, (b.maxZ - b.minZ) / 2] };
}

/** How far `r` reaches along the unit vector (ax, az) from its middle. */
const reach = (r: Rect, ax: number, az: number) => r.half[0] * Math.abs(r.axes[0][0] * ax + r.axes[0][1] * az) + r.half[1] * Math.abs(r.axes[1][0] * ax + r.axes[1][1] * az);

/**
 * The part of `r` furthest along (dx, dz): a corner, or the middle of a side when that side faces
 * that way square on (`side`).
 */
function furthest(r: Rect, dx: number, dz: number): { x: number; z: number; side: boolean } {
  let x = r.x, z = r.z, side = false;
  for (let i = 0; i < 2; i++) {
    const [ax, az] = r.axes[i];
    const dot = ax * dx + az * dz;
    // Nearly square to the way: the whole side's out there, so its middle.
    if (Math.abs(dot) < 0.15) {
      side = true;
      continue;
    }
    const k = Math.sign(dot) * r.half[i];
    x += ax * k;
    z += az * k;
  }
  return { x, z, side };
}

/** Where `a` and `b` touch, if they do: the way out is from `b` toward `a`. */
function touch(a: Rect, b: Rect): Contact | null {
  let depth = Infinity, nx = 0, nz = 0;
  for (const [ax, az] of [...a.axes, ...b.axes]) {
    const d = (a.x - b.x) * ax + (a.z - b.z) * az;
    const over = reach(a, ax, az) + reach(b, ax, az) - Math.abs(d);
    if (over <= 0) return null;
    if (over < depth) {
      const sign = d >= 0 ? 1 : -1;
      depth = over;
      nx = ax * sign;
      nz = az * sign;
    }
  }
  // Where they touch: the corner of the one poking into the other's side; side to side, halfway between the two.
  const pa = furthest(a, -nx, -nz);
  const pb = furthest(b, nx, nz);
  const at = pa.side === pb.side ? { x: (pa.x + pb.x) / 2, z: (pa.z + pb.z) / 2 } : pa.side ? pb : pa;
  return { nx, nz, depth, x: at.x, z: at.z };
}

/** Where car `p` touches the box `b`, if it does. */
export const hitsBox = (p: { x: number; z: number; rotY: number }, b: Box): Contact | null => touch(carRect(p), boxRect(b));

/** Where car `p` touches car `q`, if it does: the way out is from `q` toward `p`. */
export const hitsCar = (p: { x: number; z: number; rotY: number }, q: { x: number; z: number; rotY: number }): Contact | null => touch(carRect(p), carRect(q));

/** The car's velocity in the world (m/s): along its nose, and sliding sideways. */
export function velocity(p: CarPose): { x: number; z: number } {
  const s = Math.sin(p.rotY), c = Math.cos(p.rotY), slip = p.slip ?? 0;
  return { x: s * p.speed + c * slip, z: c * p.speed - s * slip };
}

/** `p` going at (vx, vz) in the world and spinning at `spin`: along its nose, and sideways. */
export function going(p: CarPose, vx: number, vz: number, spin: number): CarPose {
  const s = Math.sin(p.rotY), c = Math.cos(p.rotY);
  return { ...p, speed: vx * s + vz * c, slip: vx * c - vz * s, spin: clamp(spin, -MAX_SPIN, MAX_SPIN) };
}

/** Car `p` knocked: its velocity and spin changed by `k` (a crash its own page didn't see first). */
export function knock(p: CarPose, k: Kick): CarPose {
  const v = velocity(p);
  return going(p, v.x + k.x, v.z + k.z, (p.spin ?? 0) + k.spin);
}

/** The impulse along the way out and the scrape across it, for a closing speed `vn` and a sideways one `vt` at the touching point. */
function impulse(c: Contact, vn: number, vt: number, r: { x: number; z: number }[], masses: number): { x: number; z: number } {
  // Turning about its middle soaks up some of the knock: more, the further off its middle it's hit.
  const along = (ax: number, az: number) => r.reduce((sum, p) => sum + (p.z * ax - p.x * az) ** 2 / INERTIA, masses);
  const j = (-(1 + BOUNCE) * vn) / along(c.nx, c.nz);
  const tx = -c.nz, tz = c.nx;
  const jt = clamp(-vt / along(tx, tz), -SCRAPE * j, SCRAPE * j);
  return { x: c.nx * j + tx * jt, z: c.nz * j + tz * jt };
}

/**
 * Car `p` run into something that doesn't move (`c` from it toward the car): out of it, bounced off
 * it and scraped along it, and spun by where it hit. `hit` is how fast it was going into it (m/s).
 */
export function bounceOff(p: CarPose, c: Contact): { pose: CarPose; hit: number } {
  const out = { ...p, x: p.x + c.nx * (c.depth + SKIN), z: p.z + c.nz * (c.depth + SKIN) };
  const v = velocity(p);
  const spin = p.spin ?? 0;
  const r = { x: c.x - p.x, z: c.z - p.z };
  // The touching corner's velocity: the car's, and its spin's.
  const px = v.x + spin * r.z, pz = v.z - spin * r.x;
  const vn = px * c.nx + pz * c.nz;
  if (vn >= 0) return { pose: out, hit: 0 };
  const J = impulse(c, vn, px * -c.nz + pz * c.nx, [r], 1);
  return { pose: going(out, v.x + J.x, v.z + J.z, spin + ((r.z * J.x - r.x * J.z) / INERTIA) * SPIN), hit: -vn };
}

/**
 * Two cars run into each other (`c` from `b` toward `a`): out of each other half each, and the knock
 * between them as two equal masses. `kick` is what it did to `b` (for its driver's page, when that's
 * not this one), and `hit` how fast they closed (m/s).
 */
export function crash(a: CarPose, b: CarPose, c: Contact): { a: CarPose; b: CarPose; kick: Kick; hit: number } {
  const half = c.depth / 2 + SKIN;
  const a1 = { ...a, x: a.x + c.nx * half, z: a.z + c.nz * half };
  const b1 = { ...b, x: b.x - c.nx * half, z: b.z - c.nz * half };
  const va = velocity(a), vb = velocity(b);
  const wa = a.spin ?? 0, wb = b.spin ?? 0;
  const ra = { x: c.x - a.x, z: c.z - a.z };
  const rb = { x: c.x - b.x, z: c.z - b.z };
  const rx = va.x + wa * ra.z - (vb.x + wb * rb.z);
  const rz = va.z - wa * ra.x - (vb.z - wb * rb.x);
  const vn = rx * c.nx + rz * c.nz;
  if (vn >= 0) return { a: a1, b: b1, kick: { x: 0, z: 0, spin: 0 }, hit: 0 };
  const J = impulse(c, vn, rx * -c.nz + rz * c.nx, [ra, rb], 2);
  const kick = { x: -J.x, z: -J.z, spin: -((rb.z * J.x - rb.x * J.z) / INERTIA) * SPIN };
  return {
    a: going(a1, va.x + J.x, va.z + J.z, wa + ((ra.z * J.x - ra.x * J.z) / INERTIA) * SPIN),
    b: going(b1, vb.x + kick.x, vb.z + kick.z, wb + kick.spin),
    kick,
    hit: -vn,
  };
}

/**
 * Car `p` pushed out of car `q` without a knock (`c` from `q` toward `p`): `q`'s page has already
 * knocked them both, so all that's left is to stop going into it.
 */
export function standOff(p: CarPose, c: Contact): CarPose {
  const out = { ...p, x: p.x + c.nx * (c.depth + SKIN), z: p.z + c.nz * (c.depth + SKIN) };
  const v = velocity(p);
  const vn = v.x * c.nx + v.z * c.nz;
  return vn >= 0 ? out : going(out, v.x - vn * c.nx, v.z - vn * c.nz, p.spin ?? 0);
}
