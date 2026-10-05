import * as THREE from 'three';
import { heightAt } from '../../../shared/minigolf/physics';
import type { Hole, XZ } from '../../../shared/minigolf/types';

// The shapes Putt Street's holes are made of, built straight from the holes' numbers (shared/minigolf/):
// a patch of felt at the height it has at each corner, its sides down to the ground, a wall along a
// line of points that follows the felt up a slope, and the felt's height under something that stands
// on it. Everything is in the street frame, y 0 the street.

/** A triangle soup (x, y, z three at a time) as a geometry with its faces' normals. */
export function soup(points: number[]): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  geo.computeVertexNormals();
  return geo;
}

/** Adds the triangle a, b, c to `out`, turned so it faces the way `up` says (its normal's y up, or down). */
function tri(out: number[], a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, faceUp = true) {
  const ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
  if (ny >= 0 === faceUp) out.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  else out.push(a.x, a.y, a.z, c.x, c.y, c.z, b.x, b.y, b.z);
}

/** Adds the quad a, b, c, d (in order round it) to `out`, facing away from `inside`. */
function quad(out: number[], a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, inside: XZ) {
  // Its normal, from its first three corners: flipped when it points at the inside.
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const uz = b.z - a.z;
  const vx = c.x - a.x;
  const vy = c.y - a.y;
  const vz = c.z - a.z;
  const nx = uy * vz - uz * vy;
  const nz = ux * vy - uy * vx;
  const out1 = nx * (a.x - inside.x) + nz * (a.z - inside.z) >= 0;
  const order = out1 ? [a, b, c, a, c, d] : [a, c, b, a, d, c];
  for (const p of order) out.push(p.x, p.y, p.z);
}

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** The middle of a polygon's corners. */
export function middleOf(poly: readonly XZ[]): XZ {
  let x = 0;
  let z = 0;
  for (const p of poly) {
    x += p.x;
    z += p.z;
  }
  return { x: x / poly.length, z: z / poly.length };
}

/** A convex polygon's top, each corner at `height(x, z)` (a slope is a plane, so that's all of it), facing up. */
export function topGeometry(poly: readonly XZ[], height: (x: number, z: number) => number, lift = 0): THREE.BufferGeometry {
  const out: number[] = [];
  const at = poly.map((p) => v(p.x, height(p.x, p.z) + lift, p.z));
  for (let i = 1; i + 1 < at.length; i++) tri(out, at[0], at[i], at[i + 1]);
  return soup(out);
}

/** A convex polygon's sides, from its top edge (`height`) down to `bottom`, facing out. */
export function sideGeometry(poly: readonly XZ[], height: (x: number, z: number) => number, bottom = 0): THREE.BufferGeometry {
  const out: number[] = [];
  const mid = middleOf(poly);
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ha = height(a.x, a.z);
    const hb = height(b.x, b.z);
    if (ha <= bottom + 0.001 && hb <= bottom + 0.001) continue;
    quad(out, v(a.x, ha, a.z), v(b.x, hb, b.z), v(b.x, bottom, b.z), v(a.x, bottom, a.z), mid);
  }
  return soup(out);
}

/**
 * A wall `thick` thick along `pts`, standing from `bottom` (a height, or one at each point) up to
 * `top(x, z)` at each end of each stretch (so it follows the felt up a ramp), each stretch run on half
 * its thickness past its ends so the corners close.
 */
export function stripGeometry(pts: readonly XZ[], top: (x: number, z: number) => number, thick: number, bottom: number | ((x: number, z: number) => number) = 0): THREE.BufferGeometry {
  const out: number[] = [];
  const h = thick / 2;
  const foot = typeof bottom === 'number' ? () => bottom : bottom;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 1e-4) continue;
    const dx = (b.x - a.x) / len;
    const dz = (b.z - a.z) / len;
    // Across the wall, and its ends run on a little.
    const nx = -dz * h;
    const nz = dx * h;
    const ax = a.x - dx * h;
    const az = a.z - dz * h;
    const bx = b.x + dx * h;
    const bz = b.z + dz * h;
    const ta = top(a.x, a.z);
    const tb = top(b.x, b.z);
    const fa = foot(a.x, a.z);
    const fb = foot(b.x, b.z);
    const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
    const L0 = v(ax + nx, fa, az + nz);
    const L1 = v(bx + nx, fb, bz + nz);
    const R0 = v(ax - nx, fa, az - nz);
    const R1 = v(bx - nx, fb, bz - nz);
    const L0t = v(ax + nx, ta, az + nz);
    const L1t = v(bx + nx, tb, bz + nz);
    const R0t = v(ax - nx, ta, az - nz);
    const R1t = v(bx - nx, tb, bz - nz);
    tri(out, L0t, L1t, R1t);
    tri(out, L0t, R1t, R0t);
    quad(out, L0, L1, L1t, L0t, mid);
    quad(out, R0, R1, R1t, R0t, mid);
    quad(out, L0, R0, R0t, L0t, mid);
    quad(out, L1, R1, R1t, L1t, mid);
  }
  return soup(out);
}

/**
 * The felt's height under (x, z) on `hole`, or under the spots a little round it when (x, z) is just
 * off it (a wall along its edge): what something standing there stands on. 0, the street, off the felt.
 */
export function feltUnder(hole: Hole, x: number, z: number, round = 0.08): number {
  let best = heightAt(hole, x, z);
  if (best !== null) return best;
  for (const [dx, dz] of [
    [round, 0],
    [-round, 0],
    [0, round],
    [0, -round],
  ]) {
    const h = heightAt(hole, x + dx, z + dz);
    if (h !== null) best = Math.max(best ?? -Infinity, h);
  }
  return best ?? 0;
}

/** Whether nothing of `hole` is within `clear` of (x, z): no felt, and no wall or hill. */
export function clearOf(hole: Hole, x: number, z: number, clear: number): boolean {
  for (let a = 0; a < 8; a++) {
    const px = x + Math.cos((a * Math.PI) / 4) * clear;
    const pz = z + Math.sin((a * Math.PI) / 4) * clear;
    if (heightAt(hole, px, pz) !== null) return false;
  }
  if (heightAt(hole, x, z) !== null) return false;
  for (const w of hole.walls) for (let i = 0; i + 1 < w.pts.length; i++) if (segmentDistance(w.pts[i], w.pts[i + 1], x, z) < clear) return false;
  for (const hl of hole.hills ?? []) if (((x - hl.x) / (hl.rx + clear)) ** 2 + ((z - hl.z) / (hl.rz + clear)) ** 2 < 1) return false;
  for (const w of hole.water ?? []) if (insidePoly(w.poly, x, z, clear)) return false;
  if (hole.mill && Math.hypot(hole.mill.x - x, hole.mill.z - z) < hole.mill.base + clear + 1.6) return false;
  return true;
}

/** Whether (x, z) is inside convex polygon `poly`, or within `margin` of it. */
export function insidePoly(poly: readonly XZ[], x: number, z: number, margin = 0): boolean {
  let sign = 0;
  let inside = true;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const cross = (b.x - a.x) * (z - a.z) - (b.z - a.z) * (x - a.x);
    if (cross === 0) continue;
    const s = cross > 0 ? 1 : -1;
    if (sign && s !== sign) inside = false;
    sign ||= s;
  }
  if (inside || !margin) return inside;
  for (let i = 0; i < poly.length; i++) if (segmentDistance(poly[i], poly[(i + 1) % poly.length], x, z) < margin) return true;
  return false;
}

/** How far (x, z) is from the stretch a..b. */
export function segmentDistance(a: XZ, b: XZ, x: number, z: number): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  const t = len2 ? Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / len2)) : 0;
  return Math.hypot(a.x + dx * t - x, a.z + dz * t - z);
}

/** A box round the square `size` across at (x, z), turned `yaw`: what an axis-aligned collider makes of it. */
export function turnedBox(x: number, z: number, size: number, yaw: number) {
  const r = (size / 2) * (Math.abs(Math.cos(yaw)) + Math.abs(Math.sin(yaw)));
  return { minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r };
}
