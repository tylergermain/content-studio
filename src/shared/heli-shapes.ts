// Friday One's shapes seen from above, against what's solid out on the street (Solid in
// shared/mainstreet.ts) and the places it may not set down: the square round its rotor's disc, the
// disc itself, and its tail, a box turned with it. Plain arithmetic that makes nothing, so the flight
// model can ask it every step (shared/heli.ts) and the office every pose (server/heli).
//
// A box turned with the helicopter has its own axes: across it is (cos yaw, -sin yaw) in the street
// frame and along it, toward the nose, (sin yaw, cos yaw), as heliToStreet turns its own frame.

import type { Box } from './garage.js';
import type { Solid } from './mainstreet.js';

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Whether the square `r` either side of (x, z), along the street's axes, overlaps `o`'s footprint (its circle, if it's round). */
export function squareHits(o: Solid, x: number, z: number, r: number): boolean {
  if (o.round) {
    const dx = Math.max(0, Math.abs(o.round.x - x) - r);
    const dz = Math.max(0, Math.abs(o.round.z - z) - r);
    return dx * dx + dz * dz < o.round.r * o.round.r;
  }
  return o.minX < x + r && o.maxX > x - r && o.minZ < z + r && o.maxZ > z - r;
}

/**
 * Whether a turned box overlaps box `b`: the box `hw` either side of (cx, cz) across and `hl` along,
 * turned by a heading with sine `s` and cosine `c` (separating axes: the street's two, and its own two).
 */
export function turnedHitsBox(b: Box, cx: number, cz: number, s: number, c: number, hw: number, hl: number): boolean {
  const ex = (b.maxX - b.minX) / 2;
  const ez = (b.maxZ - b.minZ) / 2;
  const dx = (b.minX + b.maxX) / 2 - cx;
  const dz = (b.minZ + b.maxZ) / 2 - cz;
  const as = Math.abs(s);
  const ac = Math.abs(c);
  if (Math.abs(dx) >= ex + hw * ac + hl * as) return false;
  if (Math.abs(dz) >= ez + hw * as + hl * ac) return false;
  if (Math.abs(dx * c - dz * s) >= hw + ex * ac + ez * as) return false;
  if (Math.abs(dx * s + dz * c) >= hl + ex * as + ez * ac) return false;
  return true;
}

/** Whether the same turned box overlaps the circle `r` round (x, z): the nearest point of the box to it, in the box's own axes. */
export function turnedHitsCircle(x: number, z: number, r: number, cx: number, cz: number, s: number, c: number, hw: number, hl: number): boolean {
  const dx = x - cx;
  const dz = z - cz;
  const u = dx * c - dz * s;
  const v = dx * s + dz * c;
  const du = u - clamp(u, -hw, hw);
  const dv = v - clamp(v, -hl, hl);
  return du * du + dv * dv < r * r;
}

/** Whether the same turned box overlaps `o`'s footprint, round or square. */
export function turnedHits(o: Solid, cx: number, cz: number, s: number, c: number, hw: number, hl: number): boolean {
  return o.round ? turnedHitsCircle(o.round.x, o.round.z, o.round.r, cx, cz, s, c, hw, hl) : turnedHitsBox(o, cx, cz, s, c, hw, hl);
}

/** Whether the disc `r` round (x, z) overlaps box `b`. */
export function discHitsBox(b: Box, x: number, z: number, r: number): boolean {
  const dx = x - clamp(x, b.minX, b.maxX);
  const dz = z - clamp(z, b.minZ, b.maxZ);
  return dx * dx + dz * dz < r * r;
}

/** Whether the disc `r` round (x, z) overlaps the circle `cr` round (cx, cz). */
export function discHitsCircle(x: number, z: number, r: number, cx: number, cz: number, cr: number): boolean {
  return (x - cx) ** 2 + (z - cz) ** 2 < (r + cr) ** 2;
}
