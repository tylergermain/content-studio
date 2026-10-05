// How high the ground is under Friday One, in the street frame (shared/mainstreet.ts): the mountains to
// the south, the green foothills in front of them, the spur the scenic loop's tunnel goes through and
// the shoulders of rock either side of its ends (shared/scenic.ts), and the heliport's deck in Friday
// Park. Everywhere else it's the street's own level, 0.
//
// The page draws each mountain as a lumpy cone (world/scenic/mountains.ts): every ring of it is set out
// up to 1.12 times as far as the cone's and up to 1.08 times as high, a hill's rings bulge (they shrink
// with a power of 0.7, a mountain's 1.1), and the peak wanders up to 0.085 of the radius off the
// middle. So the ground here is a cone over each that reaches as far and as high as any of that can,
// and a meter higher: never under the rock you see. The spur is the tunnel's profile across the road
// (world/scenic/tunnel.ts), drawn in toward its ends and lumped along its top, so here it's the highest
// that profile gets anywhere it could have been drawn in from, with the lumps on top. tests/heli.test.ts
// builds the page's own mountains and spur and holds the ground here over every bit of them.

import { PARK } from './mainstreet.js';
import { FOOTHILLS, MOUNTAINS, RIDGE, SPURS, TUNNEL } from './scenic.js';

/** How far out and up world/scenic/mountains.ts may jitter a cone's rings, how far its peak may wander, and how much higher the ground here stands. */
const JITTER = { out: 1.12, up: 1.08, peak: 0.085, over: 1 } as const;

/** A cone of ground: its middle, how high it gets, how far it reaches past `shift` from the middle, and how its side curves. */
interface Peak {
  x: number;
  z: number;
  top: number;
  reach: number;
  shift: number;
  power: number;
}

const peak = ([x, z, r, h]: readonly [number, number, number, number], hill: boolean): Peak => ({
  x,
  z,
  top: h * JITTER.up + JITTER.over,
  reach: r * JITTER.out,
  shift: r * JITTER.peak,
  // A ring k/6 of the way up is (1 - k/6)^1.1 of the radius out on a mountain, ^0.7 on a hill; the ground is the same curve the other way up.
  power: hill ? 1 / 0.7 : 1 / 1.1,
});

/** Every mountain, foothill and spur rock, as cones of ground. */
const PEAKS: readonly Peak[] = [...MOUNTAINS.map((m) => peak(m, false)), ...FOOTHILLS.map((f) => peak(f, true)), ...SPURS.map((s) => peak(s, false))];

/**
 * The spur's shape across the road as world/scenic/tunnel.ts draws it, before it's drawn in and
 * lumped: [u, height], u meters south of the road's middle.
 */
const SPUR: readonly (readonly [number, number])[] = [
  [-RIDGE.north, 0],
  [-24, 5],
  [-17, 11],
  [-10, 16],
  [-4, 19],
  [3, 23],
  [10, RIDGE.height - 1],
  [17, RIDGE.height],
  [24, 23],
  [31, 15],
  [36, 7],
  [RIDGE.south, 0],
];

/**
 * How tunnel.ts shapes the spur: it leaves `keep` either side of the road alone and draws the rest in
 * toward the tunnel's ends to as little as `squeeze` of its width, and lumps its top by up to `lumps`;
 * `slack` is how far either side of a point the ground here looks, for the triangles between its rows.
 */
const SHAPE = { keep: TUNNEL.width / 2 + 1.5, squeeze: 0.45, lumps: 3.4, slack: 0.5 } as const;

/** Where the ground starts to rise: there's nothing north of this but the pad. */
const NORTH = Math.min(...PEAKS.map((p) => p.z - p.reach - p.shift), TUNNEL.z - RIDGE.north - SHAPE.slack);

/** A cone's height `d` from its middle. */
function coneAt(p: Peak, d: number): number {
  const k = Math.max(0, d - p.shift) / p.reach;
  return k >= 1 ? 0 : p.top * (1 - Math.pow(k, p.power));
}

/** The spur's profile at u (0 off either side of it). */
function spurAt(u: number): number {
  if (u <= SPUR[0][0] || u >= SPUR[SPUR.length - 1][0]) return 0;
  for (let i = 1; i < SPUR.length; i++) {
    const [b, hb] = SPUR[i];
    if (u > b) continue;
    const [a, ha] = SPUR[i - 1];
    return ha + ((hb - ha) * (u - a)) / (b - a);
  }
  return 0;
}

/** The highest the profile gets from u0 to u1. */
function spurMax(u0: number, u1: number): number {
  let m = Math.max(spurAt(u0), spurAt(u1));
  for (const [u, h] of SPUR) if (u > u0 && u < u1 && h > m) m = h;
  return m;
}

/** Where a point drawn in to u could have come from, as far as the profile goes: u' with |u'| from |u| out to where the most it's drawn in brings it. */
const drawnFrom = (u: number): number => (Math.abs(u) <= SHAPE.keep ? u : Math.sign(u) * (SHAPE.keep + (Math.abs(u) - SHAPE.keep) / SHAPE.squeeze));

/** How high the spur can be anywhere from u0 to u1 across the road (u0 ≤ u1), along any of its length. */
function spurOver(u0: number, u1: number): number {
  const lo = Math.max(u0, -RIDGE.north - SHAPE.slack);
  const hi = Math.min(u1, RIDGE.south + SHAPE.slack);
  if (lo > hi) return 0;
  // Each side of the road reaches out as far as the most it could have been drawn in from; between them, as it is.
  const from = Math.min(drawnFrom(lo), lo) - SHAPE.slack;
  const to = Math.max(drawnFrom(hi), hi) + SHAPE.slack;
  const m = spurMax(from, to);
  return m > 0 ? m + SHAPE.lumps : 0;
}

/** How high the spur stands over the box, if the box is over it. */
function ridgeOver(minX: number, maxX: number, minZ: number, maxZ: number): number {
  if (maxX < TUNNEL.x1 - SHAPE.slack || minX > TUNNEL.x0 + SHAPE.slack) return 0;
  return spurOver(minZ - TUNNEL.z, maxZ - TUNNEL.z);
}

const PAD_R2 = PARK.pad.r * PARK.pad.r;

/** How high the ground is at (x, z) over the street: the deck on the heliport, the hills and mountains, the spur; 0 elsewhere. */
export function heliTerrain(x: number, z: number): number {
  let h = (x - PARK.pad.x) ** 2 + (z - PARK.pad.z) ** 2 <= PAD_R2 ? PARK.pad.deck : 0;
  if (z < NORTH) return h;
  h = Math.max(h, ridgeOver(x, x, z, z));
  for (const p of PEAKS) {
    const d = Math.hypot(x - p.x, z - p.z);
    if (d < p.reach + p.shift) h = Math.max(h, coneAt(p, d));
  }
  return h;
}

/**
 * The highest the ground gets anywhere in the box: for each cone the point of the box nearest its
 * middle, and the spur across the box's width. What Friday One can't come down through (see
 * groundUnder in shared/heli.ts).
 */
export function heliTerrainOver(minX: number, maxX: number, minZ: number, maxZ: number): number {
  const px = Math.min(Math.max(PARK.pad.x, minX), maxX);
  const pz = Math.min(Math.max(PARK.pad.z, minZ), maxZ);
  let h = (px - PARK.pad.x) ** 2 + (pz - PARK.pad.z) ** 2 <= PAD_R2 ? PARK.pad.deck : 0;
  if (maxZ < NORTH) return h;
  h = Math.max(h, ridgeOver(minX, maxX, minZ, maxZ));
  for (const p of PEAKS) {
    const d = Math.hypot(Math.min(Math.max(p.x, minX), maxX) - p.x, Math.min(Math.max(p.z, minZ), maxZ) - p.z);
    if (d < p.reach + p.shift) h = Math.max(h, coneAt(p, d));
  }
  return h;
}
