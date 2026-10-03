// How Marc holds himself: the numbers world.ts turns his parts by. He isn't rigged (see
// blender/scripts/build_goat.py): each part that moves is an object with its origin at its joint, and a
// pose is how far each is turned about its own x (positive tips a part's top forward, or swings a
// hanging leg's foot back), in radians. No three.js in here.

import { GOAT_BUTT, GOAT_DASH, type GoatAct } from '../../../shared/protocol';

/** What he's doing, as his poses have it: one of his acts, or on his way there at a walk or a dash. */
export type Doing = GoatAct | 'walk' | 'dash';

/** Meters a second from which he bounds rather than walks: the zoomies, not catching someone up (2.6). */
export const DASH_FROM = GOAT_DASH * 0.9;

/** His legs, in the order every list of four here is in: front left, front right, back left, back right. */
export const LEGS = ['fl', 'fr', 'bl', 'br'] as const;
type Four = [number, number, number, number];

export interface Pose {
  /** How far the whole of him is down toward the floor (lying), or up off it (a hop), in meters. */
  y: number;
  /** How far forward of where he stands (a lunge), in meters. */
  z: number;
  /** His body tipped nose-down. */
  pitch: number;
  neck: number;
  head: number;
  /** Each leg above its middle joint, and below it. */
  legs: Four;
  shins: Four;
  /** His tail, cocked up from how it sits (negative) or down. */
  tail: number;
  /** His ears lifted from their droop. */
  ears: number;
}

const REST: Pose = { y: 0, z: 0, pitch: 0, neck: 0, head: 0, legs: [0, 0, 0, 0], shins: [0, 0, 0, 0], tail: 0, ears: 0 };

/** How he holds himself once he's where he's going, by what he's doing there. */
export const POSES: Record<GoatAct, Pose> = {
  stand: REST,
  // Head up, ears up: something has his attention.
  look: { ...REST, neck: -0.16, head: -0.05, ears: 0.3 },
  // Head down to the rim of the pot (see grazing, which fits his neck to the pot).
  graze: { ...REST, neck: 0.35, head: 0.32 },
  // Down on his knees in front, his mouth on the floor.
  nibble: { ...REST, y: -0.06, pitch: 0.3, neck: 1.05, head: 0.35, legs: [-0.8, -0.8, -0.3, -0.3], shins: [1.6, 1.6, 0, 0] },
  // Legs folded under him, head up.
  lie: { ...REST, y: -0.27, neck: -0.15, legs: [-1.2, -1.2, -1, -1], shins: [2.3, 2.3, 2, 2], tail: 0.3 },
  // Pulled up after a dash, still full of it.
  zoom: { ...REST, neck: -0.2, tail: -0.5, ears: 0.4 },
  // Head down, horns first.
  butt: { ...REST, neck: 0.7, head: 0.6, tail: -0.3 },
  // Looking up at whoever's patting him.
  pet: { ...REST, neck: -0.28, head: -0.12, ears: 0.5, tail: -0.35 },
};

/** Where his neck turns, how far from there his nose is, and how far round from straight up, standing with his head level. */
const NECK_UP = 0.5;
const NOSE_OUT = 0.4;
const NOSE_ROUND = 1.08;

/**
 * Grazing at a pot whose rim is `rim` meters up: his head tipped down, and his neck lowered (or, at a
 * tall one, lifted) until his nose is just over the rim, as far as his neck goes.
 */
export function grazing(rim = 0.45): Pose {
  const up = Math.min(Math.max((rim + 0.06 - NECK_UP) / NOSE_OUT, -1), 1);
  // His head's own tilt brings his nose down a little too.
  const neck = Math.min(Math.max(Math.acos(up) - NOSE_ROUND - 0.12, -0.4), 0.6);
  return { ...POSES.graze, neck };
}

/** How far the top of him sinks in each pose, for his name tag to sink with it. */
export const DROP: Record<GoatAct, number> = { stand: 0, look: 0, graze: 0.14, nibble: 0.36, lie: 0.27, zoom: 0, butt: 0.22, pet: 0 };

/** How far he goes in one turn of his legs: a walk's two steps, a dash's one bound. */
export const STRIDE = { walk: 0.62, dash: 1.25 } as const;

/**
 * Him on the move, `phase` radians through a turn of his legs (see STRIDE). Walking, his legs go in
 * diagonal pairs, each knee lifting as its foot comes forward; dashing he bounds, both front legs
 * reaching out together and both back ones kicking off, up off the floor in between.
 */
export function gait(doing: 'walk' | 'dash', phase: number): Pose {
  if (doing === 'walk') {
    const swing = (at: number) => Math.sin(phase + at) * 0.42;
    // A foot comes forward while its leg's swing is on the way down.
    const lift = (at: number) => Math.max(0, -Math.cos(phase + at)) * 0.55;
    const at: Four = [0, Math.PI, Math.PI + 0.3, 0.3];
    return {
      ...REST,
      y: Math.abs(Math.sin(phase)) * 0.012,
      neck: 0.06 + Math.sin(phase * 2) * 0.04,
      legs: at.map(swing) as Four,
      shins: at.map(lift) as Four,
      tail: -0.1,
    };
  }
  const front = Math.sin(phase) * 0.8;
  const back = Math.sin(phase + 2.3) * 0.8;
  const tuck = (at: number) => Math.max(0, -Math.cos(phase + at)) * 0.9;
  return {
    ...REST,
    y: Math.max(0, Math.sin(phase + 0.6)) * 0.17,
    pitch: Math.sin(phase + 1.2) * 0.13,
    neck: -0.12 + Math.sin(phase + 1.2) * 0.1,
    legs: [front, front, back, back],
    shins: [tuck(0), tuck(0), tuck(2.3), tuck(2.3)],
    tail: -0.6,
    ears: 0.5,
  };
}

/**
 * The hop he pulls up with after a dash, `t` seconds after he gets there: up off the floor with his back
 * legs kicked out, for half a second. Nothing, after that.
 */
export function buck(t: number): { y: number; pitch: number; kick: number } {
  if (t < 0 || t > 0.5) return { y: 0, pitch: 0, kick: 0 };
  const k = Math.sin((t / 0.5) * Math.PI);
  return { y: k * 0.2, pitch: k * 0.3, kick: k * 0.9 };
}

/** How many times he butts the bag, and when the `i`th lands, in seconds after he gets to it. */
export const buttAt = (i: number) => GOAT_BUTT.first + i * GOAT_BUTT.every;

/** How many butts have landed `t` seconds after he got to the bag. */
export function buttsBy(t: number): number {
  if (t < GOAT_BUTT.first) return 0;
  return Math.min(GOAT_BUTT.times, Math.floor((t - GOAT_BUTT.first) / GOAT_BUTT.every) + 1);
}

/**
 * A butt, `t` seconds after he got to the bag: how far forward of where he stands he is (`z`: back a
 * little as he winds up, into it as it lands, and back to where he stood) and how far up on his hind
 * legs (`rear`, 0 to 1: up as he winds up, down once it has landed), the way a goat goes at things.
 */
export function lunge(t: number): { z: number; rear: number } {
  for (let i = 0; i < GOAT_BUTT.times; i++) {
    const d = t - buttAt(i);
    if (d < -0.5 || d > 0.45) continue;
    // Winding up, driving in, easing back.
    if (d < -0.14) {
      const k = Math.sin(((d + 0.5) / 0.36) * (Math.PI / 2));
      return { z: -0.1 * k, rear: k };
    }
    if (d < 0) return { z: -0.1 + 0.3 * ((d + 0.14) / 0.14), rear: 1 };
    return { z: 0.2 * (1 - d / 0.45), rear: 1 - d / 0.45 };
  }
  return { z: 0, rear: 0 };
}

/** How far back he tips, up on his hind legs (see lunge). */
export const REAR = 0.45;

/** Eases every number of `from` toward `to` by `k` (0 stays, 1 is there), in place. */
export function ease(from: Pose, to: Pose, k: number): Pose {
  from.y += (to.y - from.y) * k;
  from.z += (to.z - from.z) * k;
  from.pitch += (to.pitch - from.pitch) * k;
  from.neck += (to.neck - from.neck) * k;
  from.head += (to.head - from.head) * k;
  from.tail += (to.tail - from.tail) * k;
  from.ears += (to.ears - from.ears) * k;
  for (let i = 0; i < 4; i++) {
    from.legs[i] += (to.legs[i] - from.legs[i]) * k;
    from.shins[i] += (to.shins[i] - from.shins[i]) * k;
  }
  return from;
}

/** A pose of its own to ease, starting at rest. */
export const restPose = (): Pose => ({ ...REST, legs: [0, 0, 0, 0], shins: [0, 0, 0, 0] });
