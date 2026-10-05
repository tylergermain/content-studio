// Where everything on Main Street stands, worked out from shared/mainstreet.ts, with no three.js in
// it, so the tests measure the very numbers the street is built from (the rest of world/mainstreet/).
// It's all in the street frame: x and z as on Friday's bottom floor, heights over the street. What
// stands on a claimed plot is laid out in its building's own frame (its plate's middle at the origin,
// its street side at +z) and brought round onto the plot with toStreet, which is how Plot 7 comes to
// face the street.

import type { Box } from '../../../shared/garage';
import { ROAD } from '../../../shared/layout';
import { CRANE, HOARDING, PARK, PLATE, PLOTS, boxToStreet, craneAt, frameOf, isClaimable, plateBox, shellTop, toStreet, type Claimable } from '../../../shared/mainstreet';
import type { BusinessCard, BusinessStage } from '../../../shared/protocol';

/** Something in the way out on the street: its footprint, and from `bottom` to `top` over the street. */
export interface StreetSolid extends Box {
  bottom: number;
  top: number;
  /** Only there to keep people out: nothing to land on (see Collider.fence). */
  fence?: boolean;
}

/** A box out on the street a golf ball bounces off (see StreetBox in world/outside.ts): its footprint and its top. */
export interface GolfBox extends Box {
  top: number;
}

/** The top of a wall up into the sky, as the office's walls have: nobody climbs over it or stands on it. */
export const WALL = 99;

/**
 * How far over the roof city's ground Main Street is drawn from the roof bar (features/mainstreet/roof.ts):
 * from up there the two would flicker through each other if they were level, and the street's grass is a
 * few centimeters under its own 0. Friday One's roof copy (features/heli) is drawn as far up, so it sits
 * on its pad's deck there too.
 */
export const ROOF_LIFT = 0.06;

/** The kerb round a plot that's for lease or built on: low enough to step over. */
export const KERB = { height: 0.12, width: 0.25 } as const;

/** A plot's FOR LEASE board: `width` across on two posts `posts` either side of its middle, its face from `low` to `high`. */
export const LEASE_BOARD = { width: 4, low: 1.05, high: 2.75, posts: 1.6 } as const;

/** A building site's gate, in the middle of its hoarding's street side, and where its hoarding's street side is (its building's frame). */
export const GATE = { width: 6, front: PLATE.halfZ + HOARDING.out } as const;

/**
 * A shell's lobby, on its street face (its building's frame): the glazed front from `glass[0]` to
 * `glass[1]` along it, the doors `width` across round `x`, `height` high, and the canopy over them.
 */
export const LOBBY = { x: 4.5, width: 3, height: 2.7, glass: [-0.5, 9.5], canopy: { out: 1.8, y: 2.95, depth: 0.6 } } as const;

/** The traffic cones in front of a site's gate (its building's frame): x along the hoarding. */
const CONES = [-3.6, -1.2, 1.2, 3.6];
const CONE_Z = GATE.front + 0.9;

/** The fenced square round a crane's foot: this far either way from its mast. */
export const CRANE_YARD = 2.2;

/** The floodlight over Friday One's pad: how tall its pole is. Its lamp leans out toward the pad. */
export const FLOOD = { height: 6.5, lean: 0.7 } as const;

/** A park bench: along z (they face west, toward the path and the green), the seat `seat` up. */
export const BENCH = { length: 1.8, depth: 0.62, seat: 0.45, back: 0.9 } as const;

/**
 * The gravel path from the far sidewalk to Friday One's pad: `width` wide down x = PARK.path.x, from
 * the sidewalk's edge to under the pad's deck.
 */
export const PATH = { minX: PARK.path.x - PARK.path.width / 2, maxX: PARK.path.x + PARK.path.width / 2, minZ: ROAD.maxZ + 2, maxZ: PARK.pad.z - 4.4 } as const;

/** A point (x, z) in plot `plot`'s building's frame, in the street frame. */
export function onPlot(plot: Claimable, x: number, z: number): { x: number; z: number } {
  const s = toStreet(frameOf(plot, 0), { x, y: 0, z });
  return { x: s.x, z: s.z };
}

/** A box in plot `plot`'s building's frame, from `bottom` to `top`, in the street frame. */
function solidOn(plot: Claimable, b: Box, bottom: number, top: number): StreetSolid {
  return { ...boxToStreet(frameOf(plot, 0), b), bottom, top };
}

/** The kerb round plot `plot`, a box along each edge. */
export function kerbSolids(plot: Claimable): StreetSolid[] {
  const b = PLOTS[plot].box;
  const w = KERB.width;
  const top = KERB.height;
  return [
    { minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.minZ + w, bottom: 0, top },
    { minX: b.minX, maxX: b.maxX, minZ: b.maxZ - w, maxZ: b.maxZ, bottom: 0, top },
    { minX: b.minX, maxX: b.minX + w, minZ: b.minZ + w, maxZ: b.maxZ - w, bottom: 0, top },
    { minX: b.maxX - w, maxX: b.maxX, minZ: b.minZ + w, maxZ: b.maxZ - w, bottom: 0, top },
  ];
}

/** Plot `plot`'s FOR LEASE board, posts and all (it runs along x: the street does). */
export function leaseBoardSolid(plot: Claimable): StreetSolid {
  const { x, z } = PLOTS[plot].board!;
  const half = LEASE_BOARD.width / 2 + 0.05;
  return { minX: x - half, maxX: x + half, minZ: z - 0.12, maxZ: z + 0.12, bottom: 0, top: LEASE_BOARD.high + 0.1 };
}

/** A site's hoarding, a wall along each side of what it takes up (claimedBox), `t` thick: in its building's frame. */
export function hoardingWalls(t = 0.15): Box[] {
  const hx = PLATE.halfX + HOARDING.out;
  const hz = GATE.front;
  return [
    { minX: -hx, maxX: hx, minZ: hz - t, maxZ: hz },
    { minX: -hx, maxX: hx, minZ: -hz, maxZ: -hz + t },
    { minX: -hx, maxX: -hx + t, minZ: -hz + t, maxZ: hz - t },
    { minX: hx - t, maxX: hx, minZ: -hz + t, maxZ: hz - t },
  ];
}

/** Where a site's cones stand, in front of its gate (the street frame). */
export function conesOf(plot: Claimable): { x: number; z: number }[] {
  return CONES.map((x) => onPlot(plot, x, CONE_Z));
}

/**
 * What's in the way on a claimed plot: a site's hoarding (walls into the sky: nobody climbs in), the
 * yard round its crane's foot and the cones by its gate; a shell's whole plate. What isn't claimed
 * has its FOR LEASE board.
 */
export function plotSolids(plot: Claimable, stage: BusinessStage | null): StreetSolid[] {
  if (!stage) return [leaseBoardSolid(plot)];
  if (stage === 'shell') return [{ ...plateBox(plot), bottom: 0, top: WALL }];
  const at = craneAt(plot);
  return [
    ...hoardingWalls().map((b) => solidOn(plot, b, 0, WALL)),
    { minX: at.x - CRANE_YARD, maxX: at.x + CRANE_YARD, minZ: at.z - CRANE_YARD, maxZ: at.z + CRANE_YARD, bottom: 0, top: WALL },
    ...conesOf(plot).map(({ x, z }) => ({ minX: x - 0.2, maxX: x + 0.2, minZ: z - 0.2, maxZ: z + 0.2, bottom: 0, top: 0.7 })),
  ];
}

/**
 * Where you stand to use a plot's sign, which opens the Main Street window on it (see
 * features/mainstreet): in front of its FOR LEASE board while it's free, at a site's gate, or at a
 * shell's lobby doors.
 */
export function signSpot(plot: Claimable, stage: BusinessStage | null): { x: number; z: number } {
  if (!stage) {
    const b = PLOTS[plot].board!;
    return { x: b.x + Math.sin(b.rotY) * 1.3, z: b.z + Math.cos(b.rotY) * 1.3 };
  }
  return stage === 'site' ? onPlot(plot, 0, GATE.front + 1.4) : onPlot(plot, LOBBY.x, PLATE.halfZ + 1.4);
}

/**
 * What a golf ball off the balcony bounces off on the plots (see obstacleBoxes in world/outside.ts):
 * a site's hoarding, wall by wall so a ball can drop in behind it, and its crane's mast; a shell's
 * tower. Not the jib: it's up in the sky, and swinging.
 */
export function golfBoxes(cards: readonly BusinessCard[]): GolfBox[] {
  const out: GolfBox[] = [];
  for (const card of cards) {
    if (!isClaimable(card.plot)) continue;
    if (card.stage === 'shell') {
      out.push({ ...plateBox(card.plot), top: shellTop(card.storeys.length) });
      continue;
    }
    for (const w of hoardingWalls()) out.push({ ...boxToStreet(frameOf(card.plot, 0), w), top: HOARDING.height });
    const at = craneAt(card.plot);
    out.push({ minX: at.x - 1.2, maxX: at.x + 1.2, minZ: at.z - 1.2, maxZ: at.z + 1.2, top: CRANE.mast + 1 });
  }
  return out;
}

/** Each plot's crane starts its round somewhere else, so they don't all swing together. */
const CRANE_PHASE: Record<Claimable, number> = { P2: 0, P3: 0.37, P7: 0.71 };

/** Where a crane is in its round: its jib slewed round (radians), its trolley out along the jib and its hook down from it (m). */
export interface CraneMotion {
  slew: number;
  trolley: number;
  hook: number;
}

const smooth = (k: number) => {
  const c = Math.min(1, Math.max(0, k));
  return c * c * (3 - 2 * c);
};

/**
 * Where plot `plot`'s crane is at office time `ms` (store.officeNow), the same on every page: once
 * round every CRANE.period seconds, a quarter turn at a time with a pause after each, its trolley
 * running out and back along the jib and its hook going down and up as it goes. Into `out`.
 */
export function craneMotion(plot: Claimable, ms: number, out: CraneMotion = { slew: 0, trolley: 0, hook: 0 }): CraneMotion {
  const round = (((ms / 1000 / CRANE.period + CRANE_PHASE[plot]) % 1) + 1) % 1;
  const quarter = Math.floor(round * 4);
  const into = round * 4 - quarter;
  out.slew = ((quarter + smooth(into / 0.65)) * Math.PI) / 2;
  out.trolley = 8 + 13 * (0.5 - 0.5 * Math.cos(round * Math.PI * 6));
  out.hook = 6 + 14 * (0.5 - 0.5 * Math.cos(round * Math.PI * 8 + 1));
  return out;
}

/**
 * Friday One's pad, as what you walk on: its deck in slices a meter deep across it, each as wide as
 * the circle is at its middle, so you step up onto it wherever you walk in from.
 */
export function padSolids(): StreetSolid[] {
  const { x, z, r, deck } = PARK.pad;
  const out: StreetSolid[] = [];
  for (let k = 0; k < 2 * r; k++) {
    const mid = -r + k + 0.5;
    const half = Math.sqrt(r * r - mid * mid);
    out.push({ minX: x - half, maxX: x + half, minZ: z + mid - 0.5, maxZ: z + mid + 0.5, bottom: 0, top: deck });
  }
  return out;
}

/** What's in the way in Friday Park that Main Street put there: the pad, the benches, the floodlight's and the windsock's poles, and the map board. */
export function parkSolids(): StreetSolid[] {
  const { flood, windsock, board } = PARK;
  const benches = PARK.benches.map(({ x, z }) => ({ minX: x - BENCH.depth / 2, maxX: x + BENCH.depth / 2, minZ: z - BENCH.length / 2, maxZ: z + BENCH.length / 2, bottom: 0, top: BENCH.seat + 0.05 }));
  return [
    ...padSolids(),
    ...benches,
    { minX: flood.x - 0.16, maxX: flood.x + 0.16, minZ: flood.z - 0.16, maxZ: flood.z + 0.16, bottom: 0, top: FLOOD.height },
    { minX: windsock.x - 0.1, maxX: windsock.x + 0.1, minZ: windsock.z - 0.1, maxZ: windsock.z + 0.1, bottom: 0, top: windsock.pole },
    { minX: board.x - board.width / 2 - 0.1, maxX: board.x + board.width / 2 + 0.1, minZ: board.z - 0.12, maxZ: board.z + 0.12, bottom: 0, top: board.height + 1 },
  ];
}

/** Where you stand to read the map board: in front of it, on the sidewalk side. */
export function boardSpot(): { x: number; z: number } {
  const { x, z, rotY } = PARK.board;
  return { x: x + Math.sin(rotY) * 1.2, z: z + Math.cos(rotY) * 1.2 };
}

/** Where the floodlight's lamp is: up its pole and leaning out toward the pad. */
export function floodLamp(): { x: number; h: number; z: number } {
  const { flood, pad } = PARK;
  const d = Math.hypot(pad.x - flood.x, pad.z - flood.z);
  return { x: flood.x + ((pad.x - flood.x) / d) * FLOOD.lean, h: FLOOD.height - 0.3, z: flood.z + ((pad.z - flood.z) / d) * FLOOD.lean };
}
