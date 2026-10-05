// Main Street: the street Friday Tower stands on (ROAD, z 23..31), and the six plots either side of it,
// which are the roof city's 44 m blocks (world/city.ts: block (i, j) is x 56i-22..56i+22, z 56j-23..56j+21),
// so the roof and the floors agree on it. Friday Tower is P1; P2, P3 and P7 are for lease; P5 is Friday
// Park (golf's hole 1 and Friday One's heliport) and P6 is Putt Street, the mini golf course.
//
// Everything here is in the street frame: x and z as in Friday's bottom floor's frame (+z south, toward
// the street), and h, how high above the street. A building on a plot has a frame of its own, as Friday
// Tower does: its plate's centre at its origin and its street side at +z. Going between the two is a
// shift and a turn of 0 or π (Frame, toStreet, fromStreet). Pure: no three.js, nothing of Node's.

import type { Box } from './garage.js';
import { STREET_Y } from './layout.js';
import type { BusinessCard } from './protocol/street.js';

export type PlotId = 'P1' | 'P2' | 'P3' | 'P5' | 'P6' | 'P7';
/** The plots a business can claim. */
export type Claimable = 'P2' | 'P3' | 'P7';
export type PlotUse = 'friday' | 'park' | 'course' | 'open';
/** Which way a building on a plot is turned: 0 as Friday Tower (its street face south), 1 half round (π), its street face north. */
export type Turn = 0 | 1;

/** Where a building's plate stands on a plot (its centre), and which way it's turned. */
export interface Plate {
  x: number;
  z: number;
  turn: Turn;
}

export interface Plot {
  id: PlotId;
  /** What it's called on the boards and in the Main Street window. */
  name: string;
  /** The roof city's block it is (world/city.ts blockAt). */
  block: readonly [i: number, j: number];
  /** Its ground, edge to edge. */
  box: Box;
  use: PlotUse;
  /** Where a building stands on it: Friday Tower's, and the claimable plots'. */
  plate?: Plate;
  /** Its FOR LEASE board, by the sidewalk, facing the street (rotY: 0 looks down +z): the claimable plots'. */
  board?: { x: number; z: number; rotY: number };
}

/** Block (i, j) of the roof city. */
const block = (i: number, j: number): Box => ({ minX: 56 * i - 22, maxX: 56 * i + 22, minZ: 56 * j - 23, maxZ: 56 * j + 21 });

/**
 * The plots. Every plate's centre is 27 m from Main Street's middle, as Friday's is, so in any
 * building's own frame Main Street lies at z 23..31 with the same forecourt in front of it.
 */
export const PLOTS: Readonly<Record<PlotId, Plot>> = {
  P1: { id: 'P1', name: 'Friday Tower', block: [0, 0], box: block(0, 0), use: 'friday', plate: { x: 0, z: 0, turn: 0 } },
  P2: { id: 'P2', name: 'Plot 2', block: [-1, 0], box: block(-1, 0), use: 'open', plate: { x: -56, z: 0, turn: 0 }, board: { x: -56, z: 19.5, rotY: 0 } },
  P3: { id: 'P3', name: 'Plot 3', block: [1, 0], box: block(1, 0), use: 'open', plate: { x: 56, z: 0, turn: 0 }, board: { x: 56, z: 19.5, rotY: 0 } },
  P5: { id: 'P5', name: 'Friday Park', block: [0, 1], box: block(0, 1), use: 'park' },
  P6: { id: 'P6', name: 'Putt Street', block: [-1, 1], box: block(-1, 1), use: 'course' },
  P7: { id: 'P7', name: 'Plot 7', block: [1, 1], box: block(1, 1), use: 'open', plate: { x: 56, z: 54, turn: 1 }, board: { x: 56, z: 34.5, rotY: Math.PI } },
};
export const PLOT_IDS: readonly PlotId[] = ['P1', 'P2', 'P3', 'P5', 'P6', 'P7'];
export const CLAIMABLE: readonly Claimable[] = ['P2', 'P3', 'P7'];
export const isClaimable = (v: unknown): v is Claimable => typeof v === 'string' && (CLAIMABLE as readonly string[]).includes(v);

/** A plate's half-size, walls included: Friday's (x -18.3..18.3, z -13.3..13.3), and every building's. */
export const PLATE = { halfX: 18.3, halfZ: 13.3 } as const;

/** How far from the tower anyone may be: the arrival spot the office takes (server/office/input.ts), and Friday One's soft wall. */
export const GROUNDS = 450;

/**
 * A shell, the tower a business has claimed before it has floors: a garage level, `storey` per storey
 * (1..maxStoreys of them), and a parapet. At most 61.6 m, so Friday Tower stays the landmark.
 */
export const SHELL = { garage: 3.6, storey: 7.1, parapet: 1.2, maxStoreys: 8 } as const;
/** How tall a shell of `storeys` stands, parapet included. */
export const shellTop = (storeys: number): number => SHELL.garage + SHELL.storey * Math.max(1, Math.min(SHELL.maxStoreys, Math.round(storeys))) + SHELL.parapet;

/** A building site: a hoarding `height` high, `out` outside the plate, with its gate toward the street. */
export const HOARDING = { height: 2.4, out: 1 } as const;

/**
 * A building site's tower crane: its mast `mast` high at the back of the plot, in the corner away from
 * Friday Tower (`set` in from the plot's sides), and a jib `jib` long at `jibY` that slews round once
 * every `period` seconds (on the office's clock), with its counter-jib `counter` long behind it.
 */
export const CRANE = { mast: 34, jibY: 32.6, jib: 26, counter: 8, period: 90, set: 6 } as const;

/** Where plot `plot`'s crane's mast stands, in the street frame. */
export function craneAt(plot: Claimable): { x: number; z: number } {
  const p = PLOTS[plot];
  const west = p.box.maxX < 0;
  const back = p.plate!.turn === 0 ? p.box.minZ + CRANE.set : p.box.maxZ - CRANE.set;
  return { x: west ? p.box.minX + CRANE.set : p.box.maxX - CRANE.set, z: back };
}

/**
 * Friday Park (P5): golf's hole 1 as it has always been (GOLF_HOLE), Friday One's heliport `pad` at
 * (13, 68), `deck` high (under a step, so people walk onto it), kept clear `clear` round, where it
 * parks nose to the tower (`yaw`); its windsock, the gravel path in from the sidewalk at `path.x`,
 * two benches, the floodlight over the pad, and the Main Street map board facing the street.
 */
export const PARK = {
  pad: { x: 13, z: 68, r: 5, deck: 0.25, clear: 6.5, yaw: Math.PI },
  windsock: { x: 20, z: 75, pole: 5 },
  path: { x: 11.5, width: 1.6 },
  benches: [
    { x: 16, z: 45 },
    { x: 16, z: 52 },
  ],
  flood: { x: 17, z: 72, reach: 12 },
  board: { x: -17, z: 34.6, rotY: Math.PI, width: 3, height: 2 },
} as const;
export const PARK_PAD = PARK.pad;

/**
 * Putt Street (P6), the nine-hole mini golf course: a picket fence `fence.height` high round the plot
 * with its gate on the street side, the kiosk (the putter rack at `rack`, and the live scorecard), the
 * record board facing the street, and nine `cell`-meter cells on a 3 × 3 grid (`cols` and `rows` are
 * their middles), with gravel paths between and two lamps where the paths cross.
 */
export const PUTT = {
  fence: { minX: -77.7, maxX: -34.3, minZ: 33.3, maxZ: 76.7, height: 0.9 },
  gate: { minX: -60, maxX: -54 },
  kiosk: { minX: -50, maxX: -42, minZ: 33.6, maxZ: 36.8 },
  rack: { x: -46, z: 37.3 },
  record: { x: -66, z: 35.5, rotY: Math.PI },
  cell: 10,
  cols: [-69, -56, -43],
  rows: [43, 56, 69],
  lamps: [
    { x: -62.5, z: 49.5 },
    { x: -49.5, z: 62.5 },
  ],
  felt: '#3fa34d',
  gravel: '#e9dcc9',
} as const;

/** Each hole's cell (its middle), 1 to 9, snaking back from the kiosk: the windmill's (2) front and centre. */
export const PUTT_CELLS: readonly { n: number; x: number; z: number }[] = [
  { n: 1, x: -43, z: 43 },
  { n: 2, x: -56, z: 43 },
  { n: 3, x: -69, z: 43 },
  { n: 4, x: -69, z: 56 },
  { n: 5, x: -56, z: 56 },
  { n: 6, x: -43, z: 56 },
  { n: 7, x: -43, z: 69 },
  { n: 8, x: -56, z: 69 },
  { n: 9, x: -69, z: 69 },
];

/** Hole `n`'s cell (1..9), edge to edge. */
export function puttCell(n: number): Box {
  const c = PUTT_CELLS[n - 1];
  const half = PUTT.cell / 2;
  return { minX: c.x - half, maxX: c.x + half, minZ: c.z - half, maxZ: c.z + half };
}

// ---- Where things are ---------------------------------------------------------------------------

const inBox = (b: Box, x: number, z: number, margin = 0) => x >= b.minX - margin && x <= b.maxX + margin && z >= b.minZ - margin && z <= b.maxZ + margin;

/** The plot (x, z) is on, if any. */
export function plotAt(x: number, z: number): PlotId | null {
  for (const id of PLOT_IDS) if (inBox(PLOTS[id].box, x, z)) return id;
  return null;
}

/** Whether (x, z) is on one of the plots, or within `margin` of one. */
export function inPlots(x: number, z: number, margin = 0): boolean {
  return PLOT_IDS.some((id) => inBox(PLOTS[id].box, x, z, margin));
}

/** Whether the roof city's block (i, j) is one of Main Street's: the roof leaves those to Main Street (features/mainstreet/roof.ts). */
export function onMain(i: number, j: number): boolean {
  return i >= -1 && i <= 1 && j >= 0 && j <= 1;
}

/** Plot `plot`'s plate, walls included, in the street frame. */
export function plateBox(plot: PlotId): Box {
  const p = PLOTS[plot].plate;
  if (!p) throw new Error(`${plot} has no plate`);
  return { minX: p.x - PLATE.halfX, maxX: p.x + PLATE.halfX, minZ: p.z - PLATE.halfZ, maxZ: p.z + PLATE.halfZ };
}

/** What stands on a claimed plot takes up this much ground: its plate, and a site's hoarding round it. */
export function claimedBox(plot: Claimable): Box {
  const b = plateBox(plot);
  const o = HOARDING.out;
  return { minX: b.minX - o, maxX: b.maxX + o, minZ: b.minZ - o, maxZ: b.maxZ + o };
}

// ---- Frames ---------------------------------------------------------------------------------------

/**
 * A building's frame: where its plate's centre is in the street frame (x, z), which way it's turned,
 * and how far below the floor you're on the street is (`street`, streetBelow(i) for floor i).
 */
export interface Frame {
  x: number;
  z: number;
  turn: Turn;
  street: number;
}

/** A point out on the street, in the street frame: x and z as on Friday's bottom floor, h above the street. */
export interface StreetPoint {
  x: number;
  h: number;
  z: number;
}

/** Friday Tower's frame, from a floor `street` above the street (STREET_Y from the bottom floor). */
export const fridayFrame = (street: number = STREET_Y): Frame => ({ x: 0, z: 0, turn: 0, street });

/** The frame of the building on `plot` (Friday Tower's, or a claimable plot's), from a floor `street` above the street. */
export function frameOf(plot: PlotId, street: number = STREET_Y): Frame {
  const p = PLOTS[plot].plate;
  if (!p) throw new Error(`${plot} has no building`);
  return { x: p.x, z: p.z, turn: p.turn, street };
}

/** A point in frame `f` (y up from that floor) in the street frame; into `out` when given, so a frame's work makes nothing new. */
export function toStreet(f: Frame, p: { x: number; y: number; z: number }, out: StreetPoint = { x: 0, h: 0, z: 0 }): StreetPoint {
  const s = f.turn ? -1 : 1;
  out.x = f.x + s * p.x;
  out.z = f.z + s * p.z;
  out.h = p.y - f.street;
  return out;
}

/** A street-frame point in frame `f`; into `out` when given. */
export function fromStreet(f: Frame, s: StreetPoint, out: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 }): { x: number; y: number; z: number } {
  const k = f.turn ? -1 : 1;
  out.x = k * (s.x - f.x);
  out.z = k * (s.z - f.z);
  out.y = s.h + f.street;
  return out;
}

/** A heading (rotation round y, 0 looking down +z) in frame `f`, as the street frame has it; and back. */
export const headingToStreet = (f: Frame, rotY: number): number => (f.turn ? rotY + Math.PI : rotY);
export const headingFromStreet = (f: Frame, rotY: number): number => (f.turn ? rotY - Math.PI : rotY);

/** A box in frame `f` in the street frame: under a turn, its min and max swap. */
export function boxToStreet(f: Frame, b: Box): Box {
  return f.turn
    ? { minX: f.x - b.maxX, maxX: f.x - b.minX, minZ: f.z - b.maxZ, maxZ: f.z - b.minZ }
    : { minX: f.x + b.minX, maxX: f.x + b.maxX, minZ: f.z + b.minZ, maxZ: f.z + b.maxZ };
}

/** A street-frame box in frame `f`. */
export function boxFromStreet(f: Frame, b: Box): Box {
  return f.turn
    ? { minX: f.x - b.maxX, maxX: f.x - b.minX, minZ: f.z - b.maxZ, maxZ: f.z - b.minZ }
    : { minX: b.minX - f.x, maxX: b.maxX - f.x, minZ: b.minZ - f.z, maxZ: b.maxZ - f.z };
}

// ---- What's solid -------------------------------------------------------------------------------

/**
 * Something solid out on the street, in the street frame: its footprint, from `bottom` up to `top`
 * above the street. A round one (`round`) is that cylinder, and its box is the box round it.
 */
export interface Solid extends Box {
  bottom: number;
  top: number;
  round?: { x: number; z: number; r: number };
}

/** A round solid `r` round (x, z), from `bottom` up to `top`. */
export const roundSolid = (x: number, z: number, r: number, bottom: number, top: number): Solid => ({ minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r, bottom, top, round: { x, z, r } });

/**
 * What the businesses' plots have standing on them, for golf flight, Friday One and the office's
 * checks: a site's hoarding, its crane's mast and the whole circle its jib sweeps; a shell's tower.
 */
export function businessBoxes(cards: readonly BusinessCard[]): Solid[] {
  const out: Solid[] = [];
  for (const card of cards) {
    if (!isClaimable(card.plot)) continue;
    if (card.stage === 'shell') {
      out.push({ ...plateBox(card.plot), bottom: 0, top: shellTop(card.storeys.length) });
      continue;
    }
    out.push({ ...claimedBox(card.plot), bottom: 0, top: HOARDING.height });
    const mast = craneAt(card.plot);
    out.push({ minX: mast.x - 1.2, maxX: mast.x + 1.2, minZ: mast.z - 1.2, maxZ: mast.z + 1.2, bottom: 0, top: CRANE.mast + 1 });
    out.push(roundSolid(mast.x, mast.z, CRANE.jib + 0.5, CRANE.jibY - 1.5, CRANE.mast + 1.5));
  }
  return out;
}
