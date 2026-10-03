/**
 * Where the glasses go in a toast (see people.ts, and index.ts for your own in first person): near
 * enough (CLINK.touch), everyone's glass reaches in to meet the others' between them, rims touching at
 * the same height, each a little to its holder's right of where they meet; further apart, each glass
 * is raised toward the others from where its holder stands. And how a toast goes, second by second:
 * out, the clink (CLINK_AT), a moment held there, and back. Pure: no three.js, no DOM. Positions are
 * metres on the floor, y up, as the office has them.
 */
import { CLINK } from '../../../shared/whisky';

/** Someone in a toast, as this page sees them: where they stand (their feet), and how wide the glass in their hand is (its radius). */
export interface Toaster {
  id: string;
  x: number;
  y: number;
  z: number;
  r: number;
}

/** Where someone's glass goes in a toast. */
export interface Raised {
  id: string;
  /** The glass's middle. */
  x: number;
  y: number;
  z: number;
  /** It meets the others' (true), or it's raised toward them from a distance. */
  touch: boolean;
  /** Which way it leans as it meets the other (a unit vector across the floor, toward the glass it meets), and where its holder turns to face. */
  tx: number;
  tz: number;
  faceX: number;
  faceZ: number;
}

/**
 * The glasses' heights over their holders' feet: where they meet (higher the nearer people stand, as
 * near as `close`, lower as far as CLINK.touch), and raised from a distance; how far out in front a
 * glass raised from a distance is, and how far to the holder's right; and how far round from straight
 * between them glasses meet, each to its holder's right (radians).
 */
export const TOAST_AT = { high: 1.2, low: 1.1, close: 0.75, raised: 1.18, out: 0.42, right: 0.2, round: 0.7 } as const;
/**
 * Seen through your own eyes (your glass in your left hand, see world/hands.ts), glasses meet higher
 * (up to `up` over your feet), no further under where you look straight ahead than `below` (the
 * tangent of the angle), so the other's comes up into view to meet yours rather than down under the
 * bottom of the screen; off to your left by `side`, where your hand is and their right hand reaches, so
 * their face stays clear; and the other way round (`round`), yours on your left of where they meet and
 * theirs on your right, so your hand round yours doesn't hide theirs.
 */
export const IN_VIEW = { up: 1.3, below: 0.32, side: 0.12, round: -1.0, out: 0.45 } as const;

/** A toast, start to finish (seconds), and when in it the glasses meet. */
export const TOAST_SECONDS = 1.4;
export const CLINK_AT = 0.45;

/**
 * How far a toast has gone at `t` seconds in: `k` how far out the glass is (0 down, 1 there), `gap`
 * how far short of meeting it still is (metres), `lift` how far it's lifted over where it goes (a
 * little "cheers" from a distance), and `tilt` how far it leans toward the glass it meets (radians).
 */
export function toastStep(t: number, touch: boolean): { k: number; gap: number; lift: number; tilt: number } {
  const s = (a: number, b: number) => {
    const u = Math.min(1, Math.max(0, (t - a) / (b - a)));
    return u * u * (3 - 2 * u);
  };
  const k = s(0, 0.36) * (1 - s(0.95, TOAST_SECONDS));
  if (!touch) {
    // Up toward them, with a little lift as the others' go up too, and down.
    return { k, gap: 0, lift: 0.035 * Math.sin(Math.PI * s(0.36, 0.7)), tilt: 0.12 * k };
  }
  // In a little short, then in to meet with a tap, a hair back from it, and away, leaning in to it as it meets.
  const gap = 0.03 * (1 - s(0.3, CLINK_AT)) + 0.008 * s(CLINK_AT, 0.56);
  return { k, gap, lift: 0, tilt: 0.2 * s(0.2, CLINK_AT) * (1 - s(0.7, 1.05)) };
}

/**
 * Where each glass in a toast goes (see Raised), for `people` (at least two) as they stand now. Those
 * near enough to the middle of them all reach in to meet there; anyone further out raises theirs toward
 * it. `eyes`: someone in it seeing it through their own eyes, how high their eyes are over their feet.
 */
export function toastPoses(people: readonly Toaster[], eyes?: { id: string; height: number }): Raised[] {
  const n = people.length;
  if (n < 2) return [];
  let cx = 0;
  let cz = 0;
  let cy = 0;
  for (const p of people) {
    cx += p.x / n;
    cz += p.z / n;
    cy += p.y / n;
  }
  const reach = CLINK.touch / 2;
  // How far out the furthest of those who reach in is: the nearer they all are, the higher the glasses meet.
  let far = 0;
  for (const p of people) {
    const d = Math.hypot(p.x - cx, p.z - cz);
    if (d <= reach) far = Math.max(far, d);
  }
  const k = Math.min(1, Math.max(0, (far - TOAST_AT.close / 2) / (reach - TOAST_AT.close / 2)));
  let meet = cy + TOAST_AT.high + (TOAST_AT.low - TOAST_AT.high) * k;
  // Where they meet: the middle of them all, or seen through your own eyes, off to your left of it.
  let mx = cx;
  let mz = cz;
  let turn: number = TOAST_AT.round;
  const seer = eyes && people.find((p) => p.id === eyes.id);
  const ahead = seer ? Math.hypot(seer.x - cx, seer.z - cz) : Infinity;
  if (seer && ahead <= reach) {
    // Up toward where you look, as far as arms go.
    meet = Math.max(meet, Math.min(cy + IN_VIEW.up, seer.y + eyes.height - ahead * IN_VIEW.below));
    if (ahead > 1e-6) {
      // Facing the middle, your left is (-dz, dx) of the way from it to you.
      mx += (-(seer.z - cz) / ahead) * IN_VIEW.side;
      mz += ((seer.x - cx) / ahead) * IN_VIEW.side;
    }
    turn = IN_VIEW.round;
  }
  // Round the middle, so many glasses touch round it (two meet either side of it).
  const ring = (r: number) => (n === 2 ? r : r / Math.sin(Math.PI / n));
  return people.map((p) => {
    let dx = p.x - cx;
    let dz = p.z - cz;
    const d = Math.hypot(dx, dz);
    if (d < 1e-6) {
      dx = 0;
      dz = 1;
    } else {
      dx /= d;
      dz /= d;
    }
    // Facing the middle (-dx, -dz), their right is (dz, -dx): forward is +z and a person's right arm is on -x.
    const rx = dz;
    const rz = -dx;
    if (d <= reach) {
      const r = ring(p.r);
      const ox = r * (Math.cos(turn) * dx + Math.sin(turn) * rx);
      const oz = r * (Math.cos(turn) * dz + Math.sin(turn) * rz);
      const len = Math.hypot(ox, oz);
      return { id: p.id, x: mx + ox, y: meet, z: mz + oz, touch: true, tx: -ox / len, tz: -oz / len, faceX: mx, faceZ: mz };
    }
    // Raised from where they stand, out in front toward the others and in their right hand, clear of
    // their face; seen through your own eyes, yours is up in front of you a little to your left.
    const mine = p === seer;
    const out = mine ? IN_VIEW.out : TOAST_AT.out;
    const side = mine ? -IN_VIEW.side : TOAST_AT.right;
    return {
      id: p.id,
      x: p.x - dx * out + rx * side,
      y: mine ? Math.min(p.y + IN_VIEW.up, p.y + eyes!.height - out * IN_VIEW.below) : p.y + TOAST_AT.raised,
      z: p.z - dz * out + rz * side,
      touch: false,
      tx: -dx,
      tz: -dz,
      faceX: cx,
      faceZ: cz,
    };
  });
}
