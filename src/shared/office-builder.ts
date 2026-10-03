// The office builder's rules: where the workers' desks and the furniture (shared/furniture.ts) may
// stand on an office floor. The browser checks a layout as it's dragged about, and the server checks
// it again before it's saved (server/floorplan.ts).

import { BOSS_ROOM, bossWallClash } from './boss-walls.js';
import { DESKS, DESK_SIZE, ELEVATOR, ELEVATOR_FRONT, FLOOR, type DeskDef } from './layout.js';
import { DEFAULT_FURNITURE, canGoUp, cleanFurniture, isRound, isSolid, kindDef, pieceBox, pieceRadius, pieceTop, type Box, type Piece } from './furniture.js';
import type { RoomOptions } from './floorplan.js';
import { meetingOf } from './meeting-place.js';
import { BIG, HEADROOM, deckOf, hasKitchen, mezzanineOf } from './mezzanine.js';
import { fixedIn, keepClearIn, keepClearUp } from './office-fixed.js';
import { hasSteps } from './steps.js';
import { faceUnder, wallFaces, type WallFace } from './wall-faces.js';

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

const within = (b: Box, a: Box) => b.minX >= a.minX - SLACK && b.maxX <= a.maxX + SLACK && b.minZ >= a.minZ - SLACK && b.maxZ <= a.maxZ + SLACK;

/**
 * Why a piece upstairs (`level: 1`) can't be where it is in a room like `room`, whatever else is up
 * there; or nothing. While the boss's office has the loft only a painting goes up there, on the
 * office's own walls and clear of what it has against them (see shared/boss-walls.ts).
 */
function misplacedUp(p: Piece, s: Standing, room: RoomOptions): string | undefined {
  const deck = deckOf(room);
  if (!deck) return `${s.label} is upstairs, and this floor is all one level`;
  if (!deck.floor) {
    if (deck.kind !== 'corner' || !kindDef(p.kind).hangs) return `${s.label} is upstairs, where the boss's office is`;
    if (!within(s.box, BOSS_ROOM)) return `${s.label} must stay in the boss's office`;
    const what = bossWallClash(p);
    if (what) return `${s.label} is in the way of ${what}`;
  } else {
    if (!canGoUp(p.kind)) return `The ${s.label.toLowerCase()} only stands on the office floor`;
    if (!within(s.box, deck.floor)) return `${s.label} must stay on the mezzanine`;
    if (isSolid(p)) for (const f of keepClearUp(room)) if (touching(s, { label: f.what, as: f.what, box: boxOf(f.rect) })) return `${s.label} would block ${f.what}`;
  }
  if (pieceTop(p) > deck.height - 0.05) return `${s.label} is too tall for the ${deck.kind === 'big' ? 'mezzanine' : 'loft'}`;
  return undefined;
}

/**
 * Why a ceiling panel can't hang where it is in a room like `room`; or nothing. It's on rods from the
 * office's own ceiling, so nothing built in may be in between: not the corner loft's floor (the big
 * mezzanine's is everything's business, see pieceProblem), a flight of stairs or the elevator's shaft.
 */
function hungThrough(s: Standing, room: RoomOptions): string | undefined {
  const deck = deckOf(room);
  if (deck?.kind === 'corner' && overlaps(s.box, deck.slab)) return `${s.label} hangs too high to go under the loft`;
  if (deck?.flights.some((f) => overlaps(s.box, f.rect))) return `${s.label} is in the way of the stairs`;
  if (overlaps(s.box, { minX: ELEVATOR.x - ELEVATOR.width / 2, maxX: ELEVATOR.x + ELEVATOR.width / 2, minZ: FLOOR.minZ, maxZ: ELEVATOR_FRONT })) return `${s.label} is in the way of the elevator`;
  return undefined;
}

/**
 * Why the piece `p` can't be where it is in a room like `room`, whatever other furniture there is; or
 * nothing. Upstairs it has to be on a deck that has room for it; down on the office floor it keeps off
 * what's built in (only when it's solid: a rug goes under anything) and fits under the big mezzanine
 * where it's under it; a ceiling panel has a clear run up to the ceiling; and what hangs has to be on
 * one of `faces`, the walls of its own level.
 */
function pieceProblem(p: Piece, s: Standing, room: RoomOptions, faces: readonly WallFace[]): string | undefined {
  if (p.level) {
    const why = misplacedUp(p, s, room);
    if (why) return why;
  } else {
    const why = isSolid(p) ? misplaced(s, room) : outside(s.box) ? `${s.label} must stay inside the room` : undefined;
    if (why) return why;
    if (mezzanineOf(room) === 'big' && overlaps(s.box, BIG) && pieceTop(p) > HEADROOM - 0.02) {
      const k = kindDef(p.kind);
      return k.overhead || k.hangs ? `${s.label} hangs too high to go under the mezzanine` : `${s.label} is too tall to stand under the mezzanine`;
    }
    const through = p.kind === 'ceiling-panel' ? hungThrough(s, room) : undefined;
    if (through) return through;
  }
  if (kindDef(p.kind).hangs && !faceUnder(p, faces)) return `${s.label} needs a wall to hang on`;
  return undefined;
}

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
 * as it comes, when it isn't said. What's upstairs is checked against the room's deck, and only gets in
 * the way of what else is up there.
 */
export function layoutProblems(layout: OfficeLayout, room: RoomOptions = {}): Map<string, string> {
  const problems = new Map<string, string>();
  const desks = layoutDesks(layout.desks).map((d) => ({ id: d.id, s: standingDesk(d), solid: true, level: 0 }));
  const pieces = layout.furniture.map((p) => ({ id: p.id, s: standingPiece(p), solid: isSolid(p), level: p.level ?? 0, p }));
  const hung = layout.furniture.some((p) => kindDef(p.kind).hangs);
  const faces = hung ? [wallFaces(layout.furniture, 0, room), wallFaces(layout.furniture, 1, room)] : [[], []];
  for (const d of desks) {
    const why = misplaced(d.s, room);
    if (why) problems.set(d.id, why);
  }
  for (const p of pieces) {
    const why = pieceProblem(p.p, p.s, room, faces[p.level]);
    if (why) problems.set(p.id, why);
  }
  const solid = [...desks, ...pieces.filter((p) => p.solid)];
  for (let i = 0; i < solid.length; i++) {
    for (let j = i + 1; j < solid.length; j++) {
      const a = solid[i];
      const b = solid[j];
      if (a.level !== b.level || !touching(a.s, b.s)) continue;
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
  const level = piece?.level ?? 0;
  const why = piece ? pieceProblem(piece, s, room, kindDef(piece.kind).hangs ? wallFaces(layout.furniture, level, room) : []) : misplaced(s, room);
  if (why || (piece && !isSolid(piece))) return why;
  const others = [...(level ? [] : layoutDesks(layout.desks).filter((d) => d.id !== id).map(standingDesk)), ...layout.furniture.filter((p) => p.id !== id && isSolid(p) && (p.level ?? 0) === level).map(standingPiece)];
  for (const other of others) if (touching(s, other)) return `${s.label} overlaps ${other.as}`;
  return undefined;
}

/**
 * Why a floor arranged like `layout` can't go from the room `was` to the room `next`: the first thing
 * that's somewhere it can't be in the new one and was fine in the old, with what has to be cleared
 * first (upstairs, when it's a piece up there whose deck is going; the floor where the kitchen comes
 * back, where the meeting place moves to or where the Steps go; else the floor where a mezzanine's
 * stairs and posts go). Nothing, if it can. For whoever's changing the room (the builder, and the
 * office when it saves), so the reason names what changed.
 */
export function structureProblem(layout: OfficeLayout, was: RoomOptions, next: RoomOptions): string | undefined {
  const before = layoutProblems(layout, was);
  // Whether `id` is fine in the new room with one thing left as it was: that one thing's doing, then.
  const dry = new Map<string, Map<string, string>>();
  const without = (what: string, id: string, room: RoomOptions) => {
    let problems = dry.get(what);
    if (!problems) dry.set(what, (problems = layoutProblems(layout, room)));
    return !problems.has(id);
  };
  for (const [id, why] of layoutProblems(layout, next)) {
    if (before.has(id)) continue;
    if (layout.furniture.find((p) => p.id === id)?.level) return `Clear upstairs first: ${why}`;
    if (hasKitchen(next) && !hasKitchen(was) && without('kitchen', id, { ...next, kitchen: false })) return `Clear the floor for the kitchen first: ${why}`;
    if (meetingOf(next) !== meetingOf(was) && without('meeting', id, { ...next, meeting: meetingOf(was) })) return `Clear the floor for the meeting place first: ${why}`;
    if (hasSteps(next) && !hasSteps(was) && without('steps', id, { ...next, steps: false })) return `Clear the floor for the Steps first: ${why}`;
    return `Clear the floor for the mezzanine first: ${why}`;
  }
  return undefined;
}

/**
 * Why a floor arranged like `layout` can't have its mezzanine (back): what stands where its stairs or
 * its posts go, which is fine on a floor that's all one level. Nothing, if it can. The room's own
 * mezzanine, or the corner loft for one that's all one level.
 */
export function mezzanineProblem(layout: OfficeLayout, room: RoomOptions = {}): string | undefined {
  const kind = mezzanineOf(room);
  return structureProblem(layout, { ...room, mezzanine: 'none' }, { ...room, mezzanine: kind === 'none' ? 'corner' : kind });
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
