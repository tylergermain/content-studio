/**
 * Where a thing being dragged in the builder lands: on the grid, on the floor of its own level (the
 * office's, or the deck's for a piece upstairs), and for what hangs, on a wall's face. And what a wall
 * takes with it: the paintings on its faces move, turn and go when it does. All of it sums, with
 * nothing of the page in it (see tests/builder-snap.test.ts).
 */
import { kindDef, pieceBox, type Piece } from '../../../shared/furniture';
import { hangSize } from '../../../shared/hangings';
import type { RoomOptions } from '../../../shared/floorplan';
import { FLOOR } from '../../../shared/layout';
import type { Deck } from '../../../shared/mezzanine';
import { SNAP, type DeskPose } from '../../../shared/office-builder';
import { faceUnder, snapToFace, wallFaces, type WallFace } from '../../../shared/wall-faces';

/** The finer grid, with Alt held: furniture's own (see GRID in shared/furniture.ts). */
const FINE = 0.05;
const QUARTER = Math.PI / 2;
const TAU = Math.PI * 2;

export const snap = (n: number, step: number) => Math.round(n / step) * step;
const cm = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/**
 * Where what's dragged to `at` lands. A desk (no `piece`) goes on the builder's grid; a piece does too,
 * or on the finer one with `alt`. Upstairs it stays on the deck's floor, all of it. What hangs goes onto
 * the nearest of `faces` no further than `within` from it (the walls of its own level: see wallFaces),
 * facing the way that face does; with none that near, it's left in mid-air where the rules refuse it.
 */
export function dragPose(at: { x: number; z: number }, piece: Piece | undefined, faces: readonly WallFace[], deck: Deck | undefined, alt: boolean, within = 0.6): { x: number; z: number; rotY?: number } {
  const grid = alt && piece ? FINE : SNAP;
  const hangs = !!piece && !!kindDef(piece.kind).hangs;
  let area: { minX: number; maxX: number; minZ: number; maxZ: number } = FLOOR;
  let hx = 0;
  let hz = 0;
  if (piece?.level && deck?.floor) {
    area = deck.floor;
    // A painting's kept on the deck by the walls it hangs on; anything else by how much floor it takes.
    if (!hangs) {
      const box = pieceBox(piece);
      hx = (box.maxX - box.minX) / 2;
      hz = (box.maxZ - box.minZ) / 2;
    }
  }
  // In from the edge by half of it, to the furniture's own grid, so what's saved is what stood there.
  const span = (min: number, max: number, half: number): [number, number] => {
    const lo = Math.ceil((min + half) / FINE - 1e-6) * FINE;
    const hi = Math.floor((max - half) / FINE + 1e-6) * FINE;
    return lo > hi ? [(min + max) / 2, (min + max) / 2] : [lo, hi];
  };
  const [x0, x1] = span(area.minX, area.maxX, hx);
  const [z0, z1] = span(area.minZ, area.maxZ, hz);
  const x = cm(clamp(snap(at.x, grid), x0, x1));
  const z = cm(clamp(snap(at.z, grid), z0, z1));
  if (!hangs) return { x, z };
  // Which wall, and which side of it, goes by where the mouse is, not by the grid: a wall stands on the
  // grid's own lines, where its two faces are as near as each other. The grid is for how far along it.
  const raw = { x: clamp(at.x, x0, x1), z: clamp(at.z, z0, z1) };
  const margin = hangSize(piece!).w / 2;
  const near = snapToFace(raw, faces, within, margin);
  if (!near) return { x, z };
  const alongX = Math.round(near.rotY / QUARTER) % 2 === 0;
  return tuck(snapToFace(alongX ? { x, z: raw.z } : { x: raw.x, z }, faces, within, margin) ?? near, faces, margin);
}

/**
 * Keeps a painting's frame on the wall it's on: `half` its width in from the ends of the run of wall
 * its face is part of (walls stood end to end are one run), or in the middle of a run shorter than it.
 * One of the room's own walls has done as much already (see snapToFace's margin).
 */
function tuck(pose: { x: number; z: number; rotY: number }, faces: readonly WallFace[], half: number): { x: number; z: number; rotY: number } {
  const face = faceUnder(pose, faces);
  if (!face?.piece) return pose;
  const alongX = Math.round(face.rotY / QUARTER) % 2 === 0;
  // Along the wall, and out from it.
  const u = (f: { x: number; z: number }) => (alongX ? f.x : f.z);
  const v = (f: { x: number; z: number }) => (alongX ? f.z : f.x);
  const turned = (f: WallFace) => Math.round((f.rotY - face.rotY) / QUARTER) % 4 === 0;
  const others = faces.filter((f) => f.piece && f !== face && turned(f) && Math.abs(v(f) - v(face)) < 0.011);
  let lo = u(face) - face.half;
  let hi = u(face) + face.half;
  for (let grew = true; grew; ) {
    grew = false;
    for (const f of others) {
      const from = u(f) - f.half;
      const to = u(f) + f.half;
      if (from > hi + 0.011 || to < lo - 0.011 || (from >= lo - 1e-6 && to <= hi + 1e-6)) continue;
      lo = Math.min(lo, from);
      hi = Math.max(hi, to);
      grew = true;
    }
  }
  const at = hi - lo >= 2 * half ? clamp(u(pose), lo + half, hi - half) : (lo + hi) / 2;
  return alongX ? { ...pose, x: cm(at) } : { ...pose, z: cm(at) };
}

/** The paintings hanging on either face of the wall `wall`, among `furniture`. */
export function hungOn(wall: Piece, furniture: readonly Piece[], room: RoomOptions | undefined): Piece[] {
  if (!kindDef(wall.kind).wall) return [];
  const level = wall.level ?? 0;
  const faces = wallFaces([wall], level, room).filter((f) => f.piece === wall.id);
  return furniture.filter((p) => p.id !== wall.id && kindDef(p.kind).hangs && (p.level ?? 0) === level && faceUnder(p, faces));
}

/** Takes `riders` (what hangs on a wall) along with the wall, which stood at `was` and stands at `now`: moved as it moved, turned as it turned. */
export function carry(riders: readonly Piece[], was: DeskPose, now: DeskPose) {
  const turn = Math.round((now.rotY - was.rotY) / QUARTER) * QUARTER;
  const c = Math.round(Math.cos(turn));
  const s = Math.round(Math.sin(turn));
  for (const r of riders) {
    const ox = r.x - was.x;
    const oz = r.z - was.z;
    r.x = cm(now.x + ox * c + oz * s);
    r.z = cm(now.z - ox * s + oz * c);
    r.rotY = (((Math.round((r.rotY + turn) / QUARTER) * QUARTER) % TAU) + TAU) % TAU;
  }
}

/** Where the painting `p` is on the other side of the wall it hangs on, among `faces`; nothing, on an outside wall (or on none). */
export function otherSide(p: Piece, faces: readonly WallFace[]): { x: number; z: number; rotY: number } | undefined {
  const face = faceUnder(p, faces);
  const other = face?.piece ? faces.find((f) => f.piece === face.piece && f !== face) : undefined;
  return face && other ? { x: cm(p.x + other.x - face.x), z: cm(p.z + other.z - face.z), rotY: other.rotY } : undefined;
}
