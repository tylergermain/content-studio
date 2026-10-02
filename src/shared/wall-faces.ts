// The faces a painting can hang on (see KindDef.hangs in shared/furniture.ts): the inside of the room's
// outside walls, and both sides of every wall the builder has put up, level by level. The builder snaps
// a painting onto the nearest one as it's dragged, and the rules (shared/office-builder.ts) refuse one
// that's on none, so nothing is saved hanging in mid-air.

import type { RoomOptions } from './floorplan.js';
import { kindDef, type Piece } from './furniture.js';
import { FLOOR } from './layout.js';
import { deckOf, type Area } from './mezzanine.js';

const QUARTER = Math.PI / 2;
const tidy = (n: number) => Math.round(n * 1000) / 1000;
/** Which quarter turn `rotY` is, 0 to 3. */
const quarterOf = (rotY: number) => ((Math.round(rotY / QUARTER) % 4) + 4) % 4;

/** One flat stretch of wall, seen from above: a line `half` either way from its middle, facing `rotY`. */
export interface WallFace {
  /** The middle of the stretch. */
  x: number;
  z: number;
  /** The way it faces, which is the way a painting on it does: a quarter turn, 0 toward +z. */
  rotY: number;
  /** Half its length along the wall. */
  half: number;
  /** The wall piece it's a side of: none for one of the room's outside walls. */
  piece?: string;
}

/** The inside faces of the outside walls round `area` that it reaches: all four for the office floor, fewer round a deck. */
function outerFaces(area: Area): WallFace[] {
  const faces: WallFace[] = [];
  const along = (min: number, max: number) => ({ mid: (min + max) / 2, half: (max - min) / 2 });
  const x = along(area.minX, area.maxX);
  const z = along(area.minZ, area.maxZ);
  if (area.minZ <= FLOOR.minZ) faces.push({ x: x.mid, z: FLOOR.minZ, rotY: 0, half: x.half });
  if (area.maxZ >= FLOOR.maxZ) faces.push({ x: x.mid, z: FLOOR.maxZ, rotY: 2 * QUARTER, half: x.half });
  if (area.minX <= FLOOR.minX) faces.push({ x: FLOOR.minX, z: z.mid, rotY: QUARTER, half: z.half });
  if (area.maxX >= FLOOR.maxX) faces.push({ x: FLOOR.maxX, z: z.mid, rotY: 3 * QUARTER, half: z.half });
  return faces;
}

/**
 * Every face a painting on `level` can hang on, on a floor with this furniture and this room: the
 * outside walls where that level reaches them, then both sides of each wall piece standing on it
 * (glass takes nothing). Upstairs there are none while the boss's office has the loft.
 */
export function wallFaces(furniture: readonly Piece[], level = 0, room: RoomOptions = {}): WallFace[] {
  const floor = level ? deckOf(room)?.floor : FLOOR;
  if (!floor) return [];
  const faces = outerFaces(floor);
  for (const p of furniture) {
    const k = kindDef(p.kind);
    if (!k.wall || (p.level ?? 0) !== level) continue;
    const q = quarterOf(p.rotY);
    const out = (k.d ?? 0) / 2;
    const half = (k.w ?? 0) / 2;
    for (const side of [0, 2]) {
      const rotY = ((q + side) % 4) * QUARTER;
      faces.push({ x: tidy(p.x + Math.sin(rotY) * out), z: tidy(p.z + Math.cos(rotY) * out), rotY, half, piece: p.id });
    }
  }
  return faces;
}

/**
 * Where `at` lands on `face` and how far from the face it is; with a `margin`, the place is kept that
 * far in from the face's ends (where it's long enough), though how far it is goes by the face itself.
 */
function onto(at: { x: number; z: number }, face: WallFace, margin = 0) {
  // Along the face: at right angles to the way it looks.
  const ax = Math.cos(face.rotY);
  const az = -Math.sin(face.rotY);
  const along = (at.x - face.x) * ax + (at.z - face.z) * az;
  const clamp = (reach: number) => Math.max(-reach, Math.min(reach, along));
  const t = clamp(face.half);
  const far = Math.hypot(at.x - (face.x + ax * t), at.z - (face.z + az * t));
  const kept = clamp(Math.max(0, face.half - margin));
  return { x: face.x + ax * kept, z: face.z + az * kept, far };
}

/**
 * The nearest place on a face to `at`, no further than `within` from it (Infinity: wherever the nearest
 * is), as where a painting hung there is and the way it faces; or null when no face is that near.
 * `margin` is half the painting's width, which keeps its frame on an outside wall's own stretch.
 */
export function snapToFace(at: { x: number; z: number }, faces: readonly WallFace[], within = 0.6, margin = 0): { x: number; z: number; rotY: number } | null {
  let best: { x: number; z: number; rotY: number } | null = null;
  let bestFar = Infinity;
  for (const face of faces) {
    const p = onto(at, face, face.piece ? 0 : margin);
    if (p.far > within || p.far >= bestFar) continue;
    bestFar = p.far;
    best = { x: Math.round(p.x * 100) / 100, z: Math.round(p.z * 100) / 100, rotY: face.rotY };
  }
  return best;
}

/** The face `p` hangs on: the one its origin is on that faces the way it does, or none when it's on no wall. */
export function faceUnder(p: Pick<Piece, 'x' | 'z' | 'rotY'>, faces: readonly WallFace[]): WallFace | undefined {
  const q = quarterOf(p.rotY);
  return faces.find((face) => quarterOf(face.rotY) === q && onto(p, face).far < 0.011);
}
