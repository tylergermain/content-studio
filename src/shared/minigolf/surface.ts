// How the felt lies under a point of a hole: how high it is and which way it slopes, from the hole's
// felt patches and cones (types.ts), looked up through a grid made once a hole so the roll can ask
// it every step. heightAt in physics.ts is this for the page.

import type { Cone, Felt, Hole, XZ } from './types.js';

/** The felt under a point: its height, its slope (rise per meter along x and z), and the patch it is (-1: a cone). */
export interface Lie {
  h: number;
  gx: number;
  gz: number;
  felt: number;
}

export const newLie = (): Lie => ({ h: 0, gx: 0, gz: 0, felt: -1 });

/** Whether (x, z) is inside convex polygon `poly`, or on its edge. */
export function inside(poly: readonly XZ[], x: number, z: number): boolean {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const cross = (b.x - a.x) * (z - a.z) - (b.z - a.z) * (x - a.x);
    if (cross === 0) continue;
    const s = cross > 0 ? 1 : -1;
    if (sign && s !== sign) return false;
    sign = s;
  }
  return true;
}

/** Whether (x, z) is inside `poly`, convex or not (counting crossings). */
export function within(poly: readonly XZ[], x: number, z: number): boolean {
  let odd = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) odd = !odd;
  }
  return odd;
}

const feltHeight = (f: Felt, x: number, z: number) => f.h + (f.slope ? f.slope.x * (x - f.poly[0].x) + f.slope.z * (z - f.poly[0].z) : 0);

/**
 * A cone's height at `d` from its middle, and how steeply it rises outward there (negative: it falls
 * outward): straight up from its foot to its top or its crater's rim, then down into the crater.
 */
function coneAt(c: Cone, d: number): { h: number; rise: number } {
  const rim = c.crater ? c.crater.r : 0;
  if (c.crater && d < rim) return { h: c.h + c.height - c.crater.depth * (1 - d / rim), rise: c.crater.depth / rim };
  const run = c.r - rim;
  return { h: c.h + (c.height * (c.r - d)) / run, rise: -c.height / run };
}

/** The grid a hole's felt is looked up through: which patches might be under each square of it. */
export interface FeltGrid {
  x0: number;
  z0: number;
  size: number;
  nx: number;
  nz: number;
  cells: number[][];
}

/** How big a square of the lookup grids is (m). */
export const GRID = 0.5;

/** The grid over the box `b` (grown by a meter), its squares empty. */
export function emptyGrid(b: { minX: number; maxX: number; minZ: number; maxZ: number }): FeltGrid {
  const x0 = b.minX - 1;
  const z0 = b.minZ - 1;
  const nx = Math.ceil((b.maxX - b.minX + 2) / GRID);
  const nz = Math.ceil((b.maxZ - b.minZ + 2) / GRID);
  return { x0, z0, size: GRID, nx, nz, cells: Array.from({ length: nx * nz }, () => []) };
}

/** Puts `item` in every square the box (grown by `margin`) touches. */
export function addToGrid(g: FeltGrid, item: number, minX: number, minZ: number, maxX: number, maxZ: number, margin: number) {
  const i0 = Math.max(0, Math.floor((minX - margin - g.x0) / g.size));
  const i1 = Math.min(g.nx - 1, Math.floor((maxX + margin - g.x0) / g.size));
  const j0 = Math.max(0, Math.floor((minZ - margin - g.z0) / g.size));
  const j1 = Math.min(g.nz - 1, Math.floor((maxZ + margin - g.z0) / g.size));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) g.cells[j * g.nx + i].push(item);
}

/** What's in the square (x, z) is in; nothing off the grid. */
export function gridAt(g: FeltGrid, x: number, z: number): readonly number[] {
  const i = Math.floor((x - g.x0) / g.size);
  const j = Math.floor((z - g.z0) / g.size);
  if (i < 0 || j < 0 || i >= g.nx || j >= g.nz) return NONE;
  return g.cells[j * g.nx + i];
}
const NONE: readonly number[] = [];

/** The box round everything a hole has: its felt, cones and hills. */
export function holeBox(hole: Hole) {
  const b = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  const take = (x: number, z: number) => {
    b.minX = Math.min(b.minX, x);
    b.maxX = Math.max(b.maxX, x);
    b.minZ = Math.min(b.minZ, z);
    b.maxZ = Math.max(b.maxZ, z);
  };
  for (const f of hole.felt) for (const q of f.poly) take(q.x, q.z);
  for (const c of hole.cones ?? []) {
    take(c.x - c.r, c.z - c.r);
    take(c.x + c.r, c.z + c.r);
  }
  for (const h of hole.hills ?? []) {
    take(h.x - h.rx, h.z - h.rz);
    take(h.x + h.rx, h.z + h.rz);
  }
  for (const w of hole.walls) for (const q of w.pts) take(q.x, q.z);
  return b;
}

/** The grid of a hole's felt patches. */
export function feltGrid(hole: Hole): FeltGrid {
  const g = emptyGrid(holeBox(hole));
  hole.felt.forEach((f, i) => {
    const xs = f.poly.map((q) => q.x);
    const zs = f.poly.map((q) => q.z);
    addToGrid(g, i, Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs), 0.01);
  });
  return g;
}

/**
 * The felt under (x, z), into `out`: the highest patch or cone there, with its slope. False where
 * there's no felt (then `out` is left as it was).
 */
export function lieAt(hole: Hole, grid: FeltGrid, x: number, z: number, out: Lie): boolean {
  let found = false;
  const near = gridAt(grid, x, z);
  for (let k = 0; k < near.length; k++) {
    const i = near[k];
    const f = hole.felt[i];
    if (!inside(f.poly, x, z)) continue;
    const h = feltHeight(f, x, z);
    if (found && h <= out.h) continue;
    found = true;
    out.h = h;
    out.gx = f.slope?.x ?? 0;
    out.gz = f.slope?.z ?? 0;
    out.felt = i;
  }
  const cones = hole.cones;
  for (let k = 0; cones && k < cones.length; k++) {
    const c = cones[k];
    const dx = x - c.x;
    const dz = z - c.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > c.r * c.r) continue;
    const d = Math.sqrt(d2);
    const { h, rise } = coneAt(c, d);
    if (found && h <= out.h) continue;
    found = true;
    out.h = h;
    // Right at the middle (the crater's, where the cup is) it's level.
    out.gx = d > 1e-9 ? (rise * dx) / d : 0;
    out.gz = d > 1e-9 ? (rise * dz) / d : 0;
    out.felt = -1;
  }
  return found;
}
