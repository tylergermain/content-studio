// The office builder's rules: where the workers' desks and the furniture (shared/furniture.ts) may
// stand on an office floor. The browser checks a layout as it's dragged about, and the server checks
// it again before it's saved (server/floorplan.ts).

import { DESKS, DESK_SIZE, FLOOR, type DeskDef } from './layout.js';
import { DEFAULT_FURNITURE, cleanFurniture, isRound, isSolid, kindDef, pieceBox, pieceRadius, type Box, type Piece } from './furniture.js';
import type { RoomOptions } from './floorplan.js';
import { fixedIn, keepClearIn } from './office-fixed.js';

export interface DeskPose {
  x: number;
  z: number;
  rotY: number;
}
/** Where each of the room's desks stands, by its id: one that isn't listed is where it always was. */
export type DeskLayout = Record<string, DeskPose>;

/** A floor's arrangement: its desks, and everything else that stands on it. */
export interface OfficeLayout {
  desks: DeskLayout;
  furniture: Piece[];
}

// Keep the original floor plan even when a browser moves its shared desk definitions.
export const ORIGINAL_DESKS: readonly DeskDef[] = DESKS.map((d) => ({ ...d }));
/** The floor the builder arranges: the room, right up to its walls. */
export const BUILD_AREA = FLOOR;
/** What the builder drags things by: a quarter of a meter. */
export const SNAP = 0.25;
/** How far behind a desk its chair and whoever's in it reach. */
const CHAIR_REACH = 1.4;
/** How much two things may overlap before they're in each other's way. */
const SLACK = 0.02;

/** The floor a desk takes up, with its chair behind it too (`chair`). */
export function deskRect(p: DeskPose, chair = false): Box {
  const halfX = DESK_SIZE.width / 2;
  const minZ = -DESK_SIZE.depth / 2;
  const maxZ = chair ? CHAIR_REACH : DESK_SIZE.depth / 2;
  const points = [
    [-halfX, minZ],
    [halfX, minZ],
    [-halfX, maxZ],
    [halfX, maxZ],
  ].map(([x, z]) => [p.x + x * Math.cos(p.rotY) + z * Math.sin(p.rotY), p.z - x * Math.sin(p.rotY) + z * Math.cos(p.rotY)]);
  const xs = points.map((q) => q[0]);
  const zs = points.map((q) => q[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
}

/** The room's desks as `layout` has them. */
export function layoutDesks(layout: DeskLayout = {}): DeskDef[] {
  return ORIGINAL_DESKS.map((d) => ({ ...d, ...layout[d.id] }));
}

/** A floor's furniture: its own once it's been rearranged, else the office's as it comes. */
export function layoutFurniture(plan: { furniture?: readonly Piece[] } | undefined): readonly Piece[] {
  return plan?.furniture ?? DEFAULT_FURNITURE;
}

const outside = (b: Box) => b.minX < BUILD_AREA.minX - SLACK || b.maxX > BUILD_AREA.maxX + SLACK || b.minZ < BUILD_AREA.minZ - SLACK || b.maxZ > BUILD_AREA.maxZ + SLACK;
const overlaps = (a: Box, b: Box) => a.minX < b.maxX - SLACK && a.maxX > b.minX + SLACK && a.minZ < b.maxZ - SLACK && a.maxZ > b.minZ + SLACK;
const boxOf = ([minX, maxX, minZ, maxZ]: readonly [number, number, number, number]): Box => ({ minX, maxX, minZ, maxZ });
const hitsCircle = (b: Box, x: number, z: number, r: number) => Math.hypot(x - Math.max(b.minX, Math.min(b.maxX, x)), z - Math.max(b.minZ, Math.min(b.maxZ, z))) < r - SLACK;

/** Something standing on the floor, for checking it against everything else: its box, and its circle if it's round. */
interface Standing {
  label: string;
  /** What it's called as the thing another one's on top of: "desk 2", "the sofa". */
  as: string;
  box: Box;
  round?: { x: number; z: number; r: number };
}

function touching(a: Standing, b: Standing): boolean {
  if (a.round && b.round) return Math.hypot(a.round.x - b.round.x, a.round.z - b.round.z) < a.round.r + b.round.r - SLACK;
  if (a.round) return hitsCircle(b.box, a.round.x, a.round.z, a.round.r);
  if (b.round) return hitsCircle(a.box, b.round.x, b.round.z, b.round.r);
  return overlaps(a.box, b.box);
}

/**
 * Why `s` can't stand where it is in a room like `room` (what's built into it goes by its options: a
 * floor with no mezzanine has no stairs to keep off), whatever else is on the floor; or nothing, if it can.
 */
function misplaced(s: Standing, room: RoomOptions): string | undefined {
  if (outside(s.box)) return `${s.label} must stay inside the room`;
  const fixed = fixedIn(room);
  for (const f of fixed.rects) if (touching(s, { label: f.what, as: f.what, box: boxOf(f.rect) })) return `${s.label} is in the way of ${f.what}`;
  for (const f of fixed.circles) {
    const [x, z, r] = f.circle;
    if (touching(s, { label: f.what, as: f.what, box: { minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r }, round: { x, z, r } })) return `${s.label} is in the way of ${f.what}`;
  }
  for (const f of keepClearIn(room)) if (touching(s, { label: f.what, as: f.what, box: boxOf(f.rect) })) return `${s.label} would block ${f.what}`;
  return undefined;
}

const standingDesk = (d: DeskDef): Standing => ({ label: d.label, as: d.label.toLowerCase(), box: deskRect(d, true) });
const standingPiece = (p: Piece): Standing => {
  const label = kindDef(p.kind).label;
  return { label, as: `the ${label.toLowerCase()}`, box: pieceBox(p), ...(isRound(p) ? { round: { x: p.x, z: p.z, r: pieceRadius(p) } } : {}) };
};

/** The desk poses in `raw`, each on the grid and a quarter turn, or why they won't do. */
function cleanDesks(raw: unknown): DeskLayout | string {
  if (raw === undefined) return {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'Choose a valid desk layout';
  const entries = Object.entries(raw);
  if (entries.length > ORIGINAL_DESKS.length) return 'Too many desks in this layout';
  const layout: DeskLayout = {};
  for (const [id, value] of entries) {
    if (!ORIGINAL_DESKS.some((d) => d.id === id) || !value || typeof value !== 'object') return 'Only the main office desks can be moved';
    const p = value as DeskPose;
    if (![p.x, p.z, p.rotY].every((n) => typeof n === 'number' && Number.isFinite(n))) return 'Desk coordinates must be finite numbers';
    const quarter = Math.round(p.rotY / (Math.PI / 2));
    if (Math.abs(p.rotY - (quarter * Math.PI) / 2) > 0.001) return 'Rotate desks in quarter turns';
    layout[id] = { x: Math.round(p.x / SNAP) * SNAP, z: Math.round(p.z / SNAP) * SNAP, rotY: ((((quarter % 4) + 4) % 4) * Math.PI) / 2 };
  }
  return layout;
}

/**
 * What's wrong with where things stand, by the id of each desk or piece that's somewhere it can't be:
 * off the floor, on something built in, in a doorway, or on top of something else. Rugs lie under
 * anything, as long as they're in the room. `room` is the floor's own (see RoomOptions): the office's
 * as it comes, when it isn't said.
 */
export function layoutProblems(layout: OfficeLayout, room: RoomOptions = {}): Map<string, string> {
  const problems = new Map<string, string>();
  const desks = layoutDesks(layout.desks).map((d) => ({ id: d.id, s: standingDesk(d) }));
  const pieces = layout.furniture.map((p) => ({ id: p.id, s: standingPiece(p), solid: isSolid(p) }));
  for (const d of desks) {
    const why = misplaced(d.s, room);
    if (why) problems.set(d.id, why);
  }
  for (const p of pieces) {
    if (!p.solid) {
      if (outside(p.s.box)) problems.set(p.id, `${p.s.label} must stay inside the room`);
      continue;
    }
    const why = misplaced(p.s, room);
    if (why) problems.set(p.id, why);
  }
  const solid = [...desks, ...pieces.filter((p) => p.solid)];
  for (let i = 0; i < solid.length; i++) {
    for (let j = i + 1; j < solid.length; j++) {
      const a = solid[i];
      const b = solid[j];
      if (!touching(a.s, b.s)) continue;
      if (!problems.has(a.id)) problems.set(a.id, `${a.s.label} overlaps ${b.s.as}`);
      if (!problems.has(b.id)) problems.set(b.id, `${b.s.label} overlaps ${a.s.as}`);
    }
  }
  return problems;
}

/**
 * What's wrong with where the desk or piece `id` stands in `layout`, or nothing: the same check as
 * layoutProblems, for the one thing being dragged about.
 */
export function problemAt(layout: OfficeLayout, id: string, room: RoomOptions = {}): string | undefined {
  const desk = layoutDesks(layout.desks).find((d) => d.id === id);
  const piece = desk ? undefined : layout.furniture.find((p) => p.id === id);
  if (!desk && !piece) return undefined;
  const s = desk ? standingDesk(desk) : standingPiece(piece!);
  if (piece && !isSolid(piece)) {
    return outside(s.box) ? `${s.label} must stay inside the room` : undefined;
  }
  const why = misplaced(s, room);
  if (why) return why;
  for (const other of [...layoutDesks(layout.desks).filter((d) => d.id !== id).map(standingDesk), ...layout.furniture.filter((p) => p.id !== id && isSolid(p)).map(standingPiece)]) {
    if (touching(s, other)) return `${s.label} overlaps ${other.as}`;
  }
  return undefined;
}

/**
 * Why a floor arranged like `layout` can't have the mezzanine (back): what stands where its stairs or
 * its posts go, which is fine on a floor that's all one level. Nothing, if it can. For whoever's
 * turning it back on (the builder, and the office when it saves), so the reason names the mezzanine.
 */
export function mezzanineProblem(layout: OfficeLayout, room: RoomOptions = {}): string | undefined {
  const flat = layoutProblems(layout, { ...room, loft: false });
  for (const [id, why] of layoutProblems(layout, { ...room, loft: true })) if (!flat.has(id)) return `Clear the floor for the mezzanine first: ${why}`;
  return undefined;
}

/**
 * A layout from somewhere it can't be trusted (a browser, a file): the desks and the furniture as
 * they're kept, or why it won't do. No furniture at all is the office's as it comes. It's checked
 * against the room it's for (`room`, the floor's own options): the office's as it comes, when it isn't said.
 */
export function validateLayout(desks: unknown, furniture?: unknown, room: RoomOptions = {}): OfficeLayout | string {
  const d = cleanDesks(desks);
  if (typeof d === 'string') return d;
  const f = furniture === undefined ? DEFAULT_FURNITURE.map((p) => ({ ...p })) : cleanFurniture(furniture);
  if (typeof f === 'string') return f;
  const layout = { desks: d, furniture: f };
  const [first] = layoutProblems(layout, room).values();
  return first ?? layout;
}
