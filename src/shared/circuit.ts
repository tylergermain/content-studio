import { LOOP, LOOP_LENGTH, STREET_END, STREET_Z, nearLoop } from './scenic.js';

// The race circuit (shared/race.ts): the street and the scenic loop all the way round, from the line in
// front of the office (x 0) east along the street, round the loop and back along the street from its
// west end. Where a car is round it (s, meters from the line), points along it for the bots to aim at
// (client/features/cars/bots.ts), how sharply it bends ahead, the gates a racer has to go through, and
// the grid behind the line.

/** Once round, from the line back to it (m). */
export const CIRCUIT = 2 * STREET_END + LOOP_LENGTH;

/** A point on the circuit's middle line: how far round, where, and the way round from there. */
export interface CircuitPoint {
  s: number;
  x: number;
  z: number;
  tx: number;
  tz: number;
}

const mod = (s: number) => ((s % CIRCUIT) + CIRCUIT) % CIRCUIT;
/** How far apart the loop's points are. */
const STEP = LOOP[1].d - LOOP[0].d;

/** The point `s` meters round the circuit. */
export function pointAt(s: number): CircuitPoint {
  s = mod(s);
  if (s <= STREET_END) return { s, x: s, z: STREET_Z, tx: 1, tz: 0 };
  if (s >= STREET_END + LOOP_LENGTH) return { s, x: s - CIRCUIT, z: STREET_Z, tx: 1, tz: 0 };
  const d = s - STREET_END;
  // The loop's points are evenly apart (the last one wherever it falls).
  const i = Math.min(LOOP.length - 2, Math.max(0, Math.floor(d / STEP)));
  const a = LOOP[i], b = LOOP[i + 1];
  const k = Math.max(0, Math.min(1, (d - a.d) / (b.d - a.d || 1)));
  const tx = a.tx + (b.tx - a.tx) * k, tz = a.tz + (b.tz - a.tz) * k;
  const len = Math.hypot(tx, tz) || 1;
  return { s, x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, tx: tx / len, tz: tz / len };
}

/** Where (x, z) is round the circuit, by the nearer of the street and the loop, and how far off its middle; null when it's nowhere near either. */
export function circuitAt(x: number, z: number): { s: number; off: number } | null {
  const street = Math.abs(x) <= STREET_END ? { s: x >= 0 ? x : CIRCUIT + x, off: Math.abs(z - STREET_Z) } : null;
  const near = nearLoop(x, z);
  const loop = near ? { s: STREET_END + Math.max(0, Math.min(LOOP_LENGTH, near.d)), off: near.off } : null;
  if (street && loop) return street.off <= loop.off ? street : loop;
  return street ?? loop;
}

/** How sharply the circuit bends at each step of BEND_STEP round it: the radius of the bend there (m). */
const BEND_STEP = 4;
const RADII: number[] = (() => {
  const out: number[] = [];
  for (let s = 0; s < CIRCUIT; s += BEND_STEP) {
    const a = pointAt(s - 12), b = pointAt(s + 12);
    const turn = Math.abs(Math.atan2(a.tx * b.tz - a.tz * b.tx, a.tx * b.tx + a.tz * b.tz));
    out.push(turn > 1e-4 ? 24 / turn : Infinity);
  }
  return out;
})();

/** The tightest bend in the `ahead` meters round from `s` (m). */
export function sharpestAhead(s: number, ahead: number): number {
  let r = Infinity;
  for (let d = 0; d <= ahead; d += BEND_STEP) r = Math.min(r, RADII[Math.floor(mod(s + d) / BEND_STEP) % RADII.length]);
  return r;
}

/** The gates round the circuit a racer has to go through in turn before the line counts (s of each), evenly round it. */
export const GATES: readonly number[] = Array.from({ length: 15 }, (_, k) => ((k + 1) * CIRCUIT) / 16);
/** How near a gate's point round the circuit a car has to come, and how far off the road it may be then. */
export const GATE = { half: 30, off: 40 } as const;

/** Where racer `k` lines up: two by two behind the line, on the street, facing east the way round. */
export function gridSlot(k: number): { x: number; z: number; rotY: number } {
  const row = Math.floor(k / 2);
  const lane = k % 2;
  return { x: -9 - row * 7.5 - lane * 3.5, z: STREET_Z + (lane ? 2.2 : -2.2), rotY: Math.PI / 2 };
}
