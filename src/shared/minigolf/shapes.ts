// The plain shapes Putt Street's holes (course.ts) are put together from: patches of felt with their
// corners' heights, kerbs round them, arcs for the bends and ovals for the hill and the volcano's
// keep-off. Pure data, made once when the course is.

import type { Felt, Wall, XZ } from './types.js';

/** How high the felt stands over the street, and the kerbs over the felt. */
export const FELT_H = 0.04;
export const KERB = 0.15;
/** The rails at the back of a green, which a ball comes off softer than a kerb. */
export const RAIL = { height: 0.3, bounce: 0.55 } as const;

export const p = (x: number, z: number): XZ => ({ x, z });

/** Level felt (or `h` high) over the box x0..x1, z0..z1. */
export function rect(x0: number, z0: number, x1: number, z1: number, h = FELT_H): Felt {
  return { poly: [p(x0, z0), p(x1, z0), p(x1, z1), p(x0, z1)], h };
}

/**
 * Felt over `poly` (convex), tilted to pass through its first three corners at the heights `hs`: a
 * twisted strip is two of these, so neighbours always meet at the same height along their edge.
 */
export function plane(poly: XZ[], hs: readonly [number, number, number], lips?: number[]): Felt {
  const [a, b, c] = poly;
  const ux = b.x - a.x;
  const uz = b.z - a.z;
  const vx = c.x - a.x;
  const vz = c.z - a.z;
  const det = ux * vz - uz * vx;
  const du = hs[1] - hs[0];
  const dv = hs[2] - hs[0];
  const slope = { x: (du * vz - dv * uz) / det, z: (ux * dv - vx * du) / det };
  const flat = Math.abs(slope.x) < 1e-12 && Math.abs(slope.z) < 1e-12;
  return { poly, h: hs[0], ...(flat ? {} : { slope }), ...(lips ? { lips } : {}) };
}

/** Felt over x0..x1, z0..z1 rising from `h0` at z0 to `h1` at z1 (a ramp, a hump), with `lips` if it launches the ball. */
export function rampZ(x0: number, x1: number, z0: number, z1: number, h0: number, h1: number, lips?: number[]): Felt {
  return { poly: [p(x0, z0), p(x1, z0), p(x1, z1), p(x0, z1)], h: h0, slope: { x: 0, z: (h1 - h0) / (z1 - z0) }, ...(lips ? { lips } : {}) };
}

/** A kerb along `pts`. */
export const kerb = (pts: XZ[], height = KERB, bounce?: number): Wall => ({ pts, height, look: 'kerb', ...(bounce !== undefined ? { bounce } : {}) });
/** The rail at the back of a green. */
export const rail = (pts: XZ[]): Wall => ({ pts, height: RAIL.height, bounce: RAIL.bounce, look: 'rail' });
/** A stone wall, taller than a kerb, that nothing gets over. */
export const stone = (pts: XZ[], height: number): Wall => ({ pts, height, look: 'stone' });

/** `pts` and back to the first: a kerb all the way round. */
export const closed = (pts: XZ[]): XZ[] => [...pts, pts[0]];

/** `n` + 1 points on the circle `r` round `c`, from angle `a0` to `a1` (angle 0 is +x, π/2 is +z). */
export function arc(c: XZ, r: number, a0: number, a1: number, n: number): XZ[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / n;
    return p(c.x + r * Math.cos(a), c.z + r * Math.sin(a));
  });
}

/** An oval `rx` by `rz` round `c`, as `n` corners. */
export function oval(c: XZ, rx: number, rz: number, n: number): XZ[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (Math.PI * 2 * i) / n;
    return p(c.x + rx * Math.cos(a), c.z + rz * Math.sin(a));
  });
}

/**
 * A banked bend: felt between the arcs `inner` and `outer` (as many points each, in step), its outer
 * edge `bank` higher than its inner, `h` high: two flat triangles between each pair of spokes.
 */
export function bend(inner: XZ[], outer: XZ[], h: number, bank: number): Felt[] {
  const out: Felt[] = [];
  for (let i = 0; i + 1 < inner.length; i++) {
    out.push(plane([inner[i], outer[i], outer[i + 1]], [h, h + bank, h + bank]));
    out.push(plane([inner[i], outer[i + 1], inner[i + 1]], [h, h + bank, h]));
  }
  return out;
}

/**
 * A strip of lane whose corners stand at different heights (where a level straight leans into a banked
 * bend): a, b, c, d in order round it at the heights `hs`, as two flat triangles that meet along a–c.
 */
export function twist(a: XZ, b: XZ, c: XZ, d: XZ, hs: readonly [number, number, number, number]): Felt[] {
  return [plane([a, b, c], [hs[0], hs[1], hs[2]]), plane([a, c, d], [hs[0], hs[2], hs[3]])];
}
