// The office's furniture: everything on the floor that the office builder can pick up, turn, paint,
// add or take away (see shared/office-builder.ts, and client/features/office-builder). A floor that was
// never rearranged has DEFAULT_FURNITURE, the office as it always was; one that was keeps its own list
// in its plan (shared/floorplan.ts). The workers' desks are the builder's too, but they're seats with
// ids of their own (see DeskLayout).

import { HOOP } from './hoop.js';
import { BOOKSHELF, CABINET, FLOOR, GONG, JUKEBOX, SEATING, SEATING_BY_ID, TV, WHITEBOARD, WING, type SeatDef } from './layout.js';

export type FurnitureGroup = 'Work' | 'Rooms' | 'Seating' | 'Tables' | 'Plants' | 'Play' | 'Decor';

/** What sitting on a piece takes (see SeatDef), in the piece's own frame. */
export interface KindSeat {
  label: string;
  places: readonly number[];
  hips: number;
  depth: number;
  out: number;
  /** How far toward its front (+z at rotY 0) the seat is from the piece's middle. */
  z?: number;
  /** Which way you face on it, from the piece's own front: PI at a desk, where the chair faces it. */
  turn?: number;
  /** A desk of your own: sitting down there puts your screen up on its monitor (see SeatDef.share). */
  share?: boolean;
}

export interface KindDef {
  label: string;
  icon: string;
  group: FurnitureGroup;
  /** Its footprint at rotY 0, `w` across x and `d` along z; or `r` round. */
  w?: number;
  d?: number;
  r?: number;
  /** How high what you bump into is. 0 lies flat on the floor (a rug): nothing bumps into it, and it can go under anything. */
  top: number;
  /** The part of its footprint you bump into, when that's not all of it: `z` toward its front from its middle. */
  solid?: { w: number; d: number; z: number };
  /** What it's painted until someone picks another color; none, when it can't be painted. */
  color?: string;
  /** It comes in sizes (see Piece.scale). */
  sizes?: boolean;
  /** It says something, until someone writes something else on it (see Piece.text). */
  text?: string;
  seat?: KindSeat;
  /**
   * Part of the office itself (the whiteboard, the jukebox, the hoop): a floor has the one, under the
   * id that's the kind's name, or it doesn't have it at all. The builder can't make a second.
   */
  fixed?: boolean;
  /** It hangs where the office has it (the hoop, on its wall): a floor keeps it or takes it down, and can't move it. */
  pinned?: boolean;
  /** Where you walk up to it to use it: `z` out from its middle toward its front, and how near's near enough. */
  use?: { z: number; radius: number };
  /** What E does there, for the things that are for playing with (see client/features/playthings). */
  play?: 'punch' | 'snack';
  /** You bounce on it: how hard it throws you back up, in m/s. */
  bounce?: number;
  /** It has a screen that plays the floor's own videos (see Piece.media, and client/features/screens). */
  plays?: boolean;
}

export const FURNITURE = {
  'team-desk': {
    label: 'Team desk',
    icon: '💻',
    group: 'Work',
    w: 1.8,
    d: 1.9,
    top: 0.78,
    solid: { w: 1.8, d: 0.9, z: -0.5 },
    color: '#5bc0eb',
    seat: { label: '💻 Team desk', places: [0], hips: 0.62, depth: -0.05, out: -0.8, z: 0.42, turn: Math.PI, share: true },
  },
  'long-table': { label: 'Long table', icon: '🪵', group: 'Work', w: 3.6, d: 1.2, top: 0.76, color: '#c9a36b' },
  'podcast-desk': { label: 'Podcast desk', icon: '🎙️', group: 'Work', w: 2, d: 1, top: 0.76, color: '#c9a36b' },
  screen: { label: 'Video screen', icon: '📺', group: 'Work', w: 2.3, d: 0.5, top: 1.85, color: '#2b2d42', plays: true },
  // Hung from the ceiling over wherever the news is: the market's prices sliding along it (see TickerSetup). Nothing's in the way under it.
  ticker: { label: 'Stock ticker', icon: '📈', group: 'Work', w: 6, d: 0.3, top: 0 },
  softbox: { label: 'Softbox light', icon: '💡', group: 'Work', r: 0.45, top: 2, color: '#f7f3ea' },
  camera: { label: 'Camera on a tripod', icon: '🎥', group: 'Work', r: 0.4, top: 1.6 },
  backdrop: { label: 'Backdrop', icon: '🎬', group: 'Work', w: 3, d: 0.5, top: 2.5, color: '#218cff' },
  wall: { label: 'Wall', icon: '🧱', group: 'Rooms', w: 2.4, d: 0.14, top: 2.6, color: '#fff6ea' },
  'wall-short': { label: 'Short wall', icon: '▫️', group: 'Rooms', w: 1.2, d: 0.14, top: 2.6, color: '#fff6ea' },
  'glass-wall': { label: 'Glass wall', icon: '🪟', group: 'Rooms', w: 2.4, d: 0.1, top: 2.6, color: '#3d405b' },
  'glass-short': { label: 'Short glass wall', icon: '🔲', group: 'Rooms', w: 1.2, d: 0.1, top: 2.6, color: '#3d405b' },
  'wood-wall': { label: 'Wood slat panel', icon: '🪵', group: 'Rooms', w: 2.4, d: 0.12, top: 2.6, color: '#b98554' },
  'wood-short': { label: 'Short wood panel', icon: '🟫', group: 'Rooms', w: 1.2, d: 0.12, top: 2.6, color: '#b98554' },
  table: { label: 'Table', icon: '🟫', group: 'Tables', w: 2.4, d: 1.1, top: 0.76, color: '#c98b5a' },
  'standing-table': { label: 'Standing table', icon: '🍸', group: 'Tables', r: 0.5, top: 1.05, color: '#c98b5a' },
  'coffee-table': { label: 'Coffee table', icon: '☕', group: 'Tables', r: 0.8, top: 0.46 },
  credenza: { label: 'Credenza', icon: '🗄️', group: 'Tables', w: 2, d: 0.48, top: 0.72, color: '#b98554' },
  'side-table': { label: 'Side table', icon: '▫️', group: 'Tables', w: 0.6, d: 0.6, top: 0.52, color: '#f7f3ea' },
  sofa: { label: 'Sofa', icon: '🛋️', group: 'Seating', w: 4.4, d: 1, top: 0.47, color: '#5b8def', seat: { label: '🛋️ Couch', places: [-1.2, 0, 1.2], hips: 0.5, depth: -0.05, out: 0.9 } },
  armchair: { label: 'Armchair', icon: '🪑', group: 'Seating', w: 1, d: 0.95, top: 0.45, color: '#ef476f', seat: { label: '🪑 Armchair', places: [0], hips: 0.5, depth: 0, out: 0.85 } },
  pouf: { label: 'Pouf', icon: '🫘', group: 'Seating', r: 0.5, top: 0.42, color: '#06d6a0', seat: { label: '🫘 Beanbag', places: [0], hips: 0.42, depth: -0.1, out: 1.2 } },
  'lounge-chair': { label: 'Lounge chair', icon: '💺', group: 'Seating', w: 0.9, d: 0.9, top: 0.42, color: '#e9dfcf', seat: { label: '💺 Lounge chair', places: [0], hips: 0.46, depth: -0.02, out: 0.85 } },
  stool: { label: 'Stool', icon: '🪑', group: 'Seating', r: 0.24, top: 0.72, color: '#2b2d42', seat: { label: '🪑 Stool', places: [0], hips: 0.78, depth: 0, out: 0.7 } },
  cushion: { label: 'Floor cushion', icon: '🧘', group: 'Seating', r: 0.42, top: 0.14, color: '#b388eb', seat: { label: '🧘 Cushion', places: [0], hips: 0.3, depth: 0, out: 0.9 } },
  trampoline: { label: 'Trampoline', icon: '🤸', group: 'Play', r: 1.3, top: 0.34, color: '#5bc0eb', bounce: 8.6 },
  'punching-bag': { label: 'Punching bag', icon: '🥊', group: 'Play', r: 0.5, top: 2.1, color: '#ef476f', use: { z: 0.95, radius: 1.3 }, play: 'punch' },
  'vending-machine': { label: 'Vending machine', icon: '🥤', group: 'Play', w: 1, d: 0.8, top: 1.95, color: '#118ab2', use: { z: 1.1, radius: 1.3 }, play: 'snack' },
  'ping-pong': { label: 'Ping-pong table', icon: '🏓', group: 'Play', w: 2.74, d: 1.53, top: 0.76, color: '#1a7f5a' },
  foosball: { label: 'Foosball table', icon: '⚽', group: 'Play', w: 1.5, d: 0.8, top: 0.9, color: '#8a5a3b' },
  monstera: { label: 'Monstera', icon: '🪴', group: 'Plants', r: 0.3, top: 0.5, sizes: true },
  'snake-plant': { label: 'Snake plant', icon: '🌿', group: 'Plants', r: 0.3, top: 0.5, sizes: true },
  ficus: { label: 'Ficus', icon: '🌳', group: 'Plants', r: 0.3, top: 0.5, sizes: true },
  planter: { label: 'Planter box', icon: '🌱', group: 'Plants', w: 1.8, d: 0.45, top: 1, color: '#2b2d42' },
  rug: { label: 'Rug', icon: '🟦', group: 'Decor', w: 6.2, d: 4.6, top: 0, color: '#bde0fe' },
  'rug-large': { label: 'Large rug', icon: '🟪', group: 'Decor', w: 7, d: 7, top: 0, color: '#ffc6ff' },
  'rug-small': { label: 'Small rug', icon: '🟩', group: 'Decor', w: 3, d: 2, top: 0, color: '#caffbf' },
  'rug-round': { label: 'Round rug', icon: '⭕', group: 'Decor', r: 1.6, top: 0, color: '#ffd6a5' },
  divider: { label: 'Divider', icon: '🧱', group: 'Decor', w: 2.4, d: 0.2, top: 1.5, color: '#8ecae6' },
  bookcase: { label: 'Bookcase', icon: '📚', group: 'Decor', w: 1.6, d: 0.45, top: 1.9, color: '#c98b5a' },
  'floor-lamp': { label: 'Floor lamp', icon: '💡', group: 'Decor', r: 0.25, top: 1.7, color: '#ffd166' },
  sign: { label: 'Sign', icon: '🪧', group: 'Decor', w: 1.8, d: 0.4, top: 1.6, color: '#2b2d42', text: 'Friday Labs' },
  // Lit letters, hung at head height against whatever's behind them: nothing's in the way under it.
  neon: { label: 'Neon sign', icon: '✨', group: 'Decor', w: 2.6, d: 0.2, top: 0, color: '#ff5fa2', text: 'ON AIR' },
  // What the office comes with (see KindDef.fixed), each built by its own feature (features/whiteboard and the rest).
  whiteboard: { label: 'Whiteboard', icon: '📝', group: 'Decor', w: 4.4, d: 0.96, top: 3.05, fixed: true, use: { z: 1.7, radius: 2.3 } },
  jukebox: { label: 'Jukebox', icon: '🎵', group: 'Play', w: 1.4, d: 0.8, top: 1.85, fixed: true, use: { z: 1.3, radius: 1.6 } },
  arcade: { label: 'Arcade cabinet', icon: '🕹️', group: 'Play', w: 0.84, d: 0.85, top: 1.9, fixed: true, use: { z: 1.2, radius: 1.3 } },
  // On its wall, over a key painted on the floor: nothing's in the way down there (the backboard is overhead).
  hoop: { label: 'Basketball hoop', icon: '🏀', group: 'Play', w: 1.4, d: 0.5, top: 0, fixed: true, pinned: true },
  docs: { label: 'Docs bookshelf', icon: '📚', group: 'Decor', w: 1.78, d: 0.48, top: 2.37, fixed: true, use: { z: 1.2, radius: 1.6 } },
  gong: { label: 'Gong', icon: '🔔', group: 'Decor', w: 2.4, d: 0.6, top: 2.55, fixed: true, use: { z: 1.3, radius: 1.5 } },
} as const satisfies Record<string, KindDef>;

export type FurnitureKind = keyof typeof FURNITURE;
export const FURNITURE_KINDS = Object.keys(FURNITURE) as FurnitureKind[];
/** The kinds a floor has one of at most (see KindDef.fixed). */
export const FIXED_KINDS = FURNITURE_KINDS.filter((k) => (FURNITURE[k] as KindDef).fixed);
export const FURNITURE_GROUPS: readonly FurnitureGroup[] = ['Work', 'Rooms', 'Seating', 'Tables', 'Plants', 'Play', 'Decor'];

export function kindDef(kind: FurnitureKind): KindDef {
  return FURNITURE[kind];
}

/** One piece of furniture, standing at (x, z) on the floor. */
export interface Piece {
  id: string;
  kind: FurnitureKind;
  x: number;
  z: number;
  /** Rotation around Y: at 0 its front is toward +z. Quarter turns, unless it's round. */
  rotY: number;
  /** Its paint, for a kind that can be painted (see KindDef.color). */
  color?: string;
  /** Its size next to the kind's own, for a kind that comes in sizes. */
  scale?: number;
  /** What it says, for a kind that says something. */
  text?: string;
  /** The one video it plays, by its name in the floor's media folder, for a kind that plays them: every video there, with none. */
  media?: string;
}

/** The most pieces a floor takes. */
export const MAX_PIECES = 150;
/** The longest a sign's text may be, in characters. */
export const MAX_PIECE_TEXT = 28;
export const PIECE_SCALE = { min: 0.6, max: 1.8 } as const;
/** Furniture stands on a 5 cm grid (the builder drags it a quarter meter at a time, see SNAP). */
const GRID = 0.05;

const TAU = Math.PI * 2;
const QUARTER = Math.PI / 2;
const round = (n: number, step: number) => Math.round(n / step) * step;
const tidy = (n: number) => Math.round(n * 1000) / 1000;

/** The office's furniture as it was before anyone moved any: the lounge, the rugs under the desks and the plants. */
export const DEFAULT_FURNITURE: readonly Piece[] = [
  ...(
    [
      [-10.5, -4, '#bde0fe'],
      [-1.5, -4, '#ffd6a5'],
      [-10.5, 4, '#caffbf'],
      [-1.5, 4, '#ffc6ff'],
    ] as const
  ).map(([x, z, color], i): Piece => ({ id: `rug-${i + 1}`, kind: 'rug', x, z, rotY: 0, color })),
  { id: 'lounge-rug', kind: 'rug-large', x: 13.4, z: 0, rotY: 0, color: '#ffc6ff' },
  // The couch, its back to the room, facing the TV on the east wall.
  { id: 'couch', kind: 'sofa', x: 10.5, z: 0, rotY: QUARTER, color: '#5b8def' },
  { id: 'coffee-table', kind: 'coffee-table', x: 13, z: 0, rotY: 0 },
  // A pouf either side of the lounge (the seats still called beanbags), turned to the TV.
  { id: 'lounge-beanbag-1', kind: 'pouf', x: 12.5, z: 3.5, rotY: tidy(Math.atan2(TV.x - 12.5, TV.z - 3.5)), color: '#06d6a0' },
  { id: 'lounge-beanbag-2', kind: 'pouf', x: 14.5, z: -3.4, rotY: tidy(Math.atan2(TV.x - 14.5, TV.z + 3.4)), color: '#ffd166' },
  ...(
    [
      [-17.2, -12.2, 1.4],
      [17.2, -12.2, 1.5],
      [17.2, 12.2, 1.3],
      [-17.2, 8.5, 1.2],
      [14.2, -12.2, 1.1],
      [-6, 0, 1],
      [3.5, 0, 0.9],
      [8.5, 5, 1.1],
    ] as const
  ).map(([x, z, scale], i): Piece => ({ id: `plant-${i + 1}`, kind: (['monstera', 'snake-plant', 'ficus'] as const)[i % 3], x, z, rotY: 0, scale })),
  // What the office comes with, where it always stood: the whiteboard out on the floor, the jukebox and the
  // arcade against the east wall (facing into the room), the docs against the south one, the gong by the elevator.
  { id: 'whiteboard', kind: 'whiteboard', x: WHITEBOARD.x, z: WHITEBOARD.z, rotY: 0 },
  { id: 'jukebox', kind: 'jukebox', x: FLOOR.maxX - 0.4, z: JUKEBOX.z, rotY: 3 * QUARTER },
  { id: 'arcade', kind: 'arcade', x: FLOOR.maxX - 0.45, z: CABINET.z, rotY: 3 * QUARTER },
  { id: 'docs', kind: 'docs', x: BOOKSHELF.x, z: FLOOR.maxZ - 0.25, rotY: 2 * QUARTER },
  { id: 'gong', kind: 'gong', x: GONG.x, z: GONG.z, rotY: 0 },
  { id: 'hoop', kind: 'hoop', x: FLOOR.minX + 0.6, z: HOOP.z, rotY: QUARTER },
];

/** Where a floor has something of the office's that it can't move (see KindDef.pinned): where the office has it. */
const PINNED = new Map(DEFAULT_FURNITURE.filter((p) => kindDef(p.kind).pinned).map((p) => [p.kind, p]));

/** The seats the default furniture has, which SEATING lists too: a floor's own furniture takes their place (see setFloorSeats). */
const DEFAULT_SEAT_IDS = new Set(DEFAULT_FURNITURE.filter((p) => kindDef(p.kind).seat).map((p) => p.id));

/** How big it is next to its kind's own size. */
export function pieceScale(p: Piece): number {
  return kindDef(p.kind).sizes ? (p.scale ?? 1) : 1;
}

/** Whether it's round: it turns any way, and keeps round things' distance. */
export function isRound(p: Piece): boolean {
  return kindDef(p.kind).r !== undefined;
}

/** Whether anything bumps into it: a rug lies flat, under whatever stands on it. */
export function isSolid(p: Piece): boolean {
  return kindDef(p.kind).top > 0;
}

/** How far a round piece reaches from its middle. */
export function pieceRadius(p: Piece): number {
  return (kindDef(p.kind).r ?? 0) * pieceScale(p);
}

export interface Box {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** A `w` by `d` box, `z` toward the front of a piece at (x, z) turned `rotY` (a quarter turn at a time). */
function turnedBox(x: number, z: number, rotY: number, w: number, d: number, front = 0): Box {
  const q = (((Math.round(rotY / QUARTER) % 4) + 4) % 4) as 0 | 1 | 2 | 3;
  const s = [0, 1, 0, -1][q];
  const c = [1, 0, -1, 0][q];
  const cx = x + s * front;
  const cz = z + c * front;
  const hx = (q % 2 ? d : w) / 2;
  const hz = (q % 2 ? w : d) / 2;
  return { minX: cx - hx, maxX: cx + hx, minZ: cz - hz, maxZ: cz + hz };
}

/** The floor it takes up: nothing else that stands on the floor goes there. */
export function pieceBox(p: Piece): Box {
  const k = kindDef(p.kind);
  if (k.r !== undefined) {
    const r = pieceRadius(p);
    return { minX: p.x - r, maxX: p.x + r, minZ: p.z - r, maxZ: p.z + r };
  }
  return turnedBox(p.x, p.z, p.rotY, k.w ?? 1, k.d ?? 1);
}

/** What you bump into of it, and how high that is (see Collider); none for what lies flat on the floor. */
export function pieceCollider(p: Piece): (Box & { top: number }) | undefined {
  const k = kindDef(p.kind);
  if (!k.top) return undefined;
  const top = k.top * pieceScale(p);
  if (k.solid) return { ...turnedBox(p.x, p.z, p.rotY, k.solid.w, k.solid.d, k.solid.z), top };
  return { ...pieceBox(p), top };
}

/** In the way into the back office (see WING): put away while the floor's built out, as the plants there always were. */
export function pieceAway(p: Piece, wing: number): boolean {
  return wing > 0 && p.x > WING.minX && p.z < FLOOR.minZ + 1.5;
}

/** What's in the way of whoever walks the floor (see shared/nav.ts), built out `wing` rows. */
export function furnitureObstacles(pieces: readonly Piece[], wing = 0): { rects: [number, number, number, number][]; circles: [number, number, number][] } {
  const rects: [number, number, number, number][] = [];
  const circles: [number, number, number][] = [];
  for (const p of pieces) {
    if (!isSolid(p) || pieceAway(p, wing)) continue;
    if (isRound(p)) circles.push([p.x, p.z, pieceRadius(p)]);
    else {
      const b = pieceBox(p);
      rects.push([b.minX, b.maxX, b.minZ, b.maxZ]);
    }
  }
  return { rects, circles };
}

/** Whether a sofa faces the lounge TV, near enough to watch it from. */
function facesTv(p: Piece): boolean {
  const dx = TV.x - p.x;
  const dz = TV.z - p.z;
  const far = Math.hypot(dx, dz);
  return far < 14 && (Math.sin(p.rotY) * dx + Math.cos(p.rotY) * dz) / (far || 1) > 0.8;
}

/** The seat a piece is, if you can sit on it. */
export function pieceSeat(p: Piece): SeatDef | undefined {
  const s: KindSeat | undefined = kindDef(p.kind).seat;
  if (!s) return undefined;
  const front = s.z ?? 0;
  return {
    id: p.id,
    label: s.label,
    x: p.x + Math.sin(p.rotY) * front,
    y: 0,
    z: p.z + Math.cos(p.rotY) * front,
    rotY: p.rotY + (s.turn ?? 0),
    places: s.places,
    hips: s.hips,
    depth: s.depth,
    out: s.out,
    ...(p.kind === 'sofa' && facesTv(p) ? { tv: true } : {}),
    ...(s.share ? { share: true } : {}),
  };
}

/** Everywhere the furniture has to sit, on a floor built out `wing` rows. */
export function furnitureSeats(pieces: readonly Piece[], wing = 0): SeatDef[] {
  return pieces.flatMap((p) => (pieceAway(p, wing) ? [] : (pieceSeat(p) ?? [])));
}

/**
 * The seat called `id` on a floor with this furniture, up on the roof or down on the floor: the
 * furniture's own, else one of the office's that isn't furniture (the loft's, the balcony's, the roof's).
 */
export function floorSeat(pieces: readonly Piece[], wing: number, id: string): SeatDef | undefined {
  return furnitureSeats(pieces, wing).find((s) => s.id === id) ?? (DEFAULT_SEAT_IDS.has(id) ? undefined : SEATING_BY_ID.get(id));
}

/** The furniture seats SEATING has now (see setFloorSeats). */
let floorSeats = new Set(DEFAULT_SEAT_IDS);

/**
 * Makes the floor's furniture the seats there are to sit on, in place of the last floor's (a browser
 * shows one floor at a time): SEATING and SEATING_BY_ID follow, so everything that finds a seat by its
 * id finds these. The office's other seats stay as they are.
 */
export function setFloorSeats(seats: readonly SeatDef[]) {
  for (let i = SEATING.length - 1; i >= 0; i--) if (floorSeats.has(SEATING[i].id)) SEATING.splice(i, 1);
  for (const id of floorSeats) SEATING_BY_ID.delete(id);
  floorSeats = new Set(seats.map((s) => s.id));
  for (const s of seats) {
    SEATING.push(s);
    SEATING_BY_ID.set(s.id, s);
  }
}

/** A sign's text as it's written: one line, no control characters, at most MAX_PIECE_TEXT characters. */
export function cleanPieceText(text: unknown): string {
  if (typeof text !== 'string') return '';
  const flat = text.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
  return [...flat].slice(0, MAX_PIECE_TEXT).join('').trim();
}

const ID = /^[a-z0-9][a-z0-9-]{0,23}$/;
const COLOR = /^#[0-9a-f]{6}$/;
/** A file's name in a floor's media folder (see server/media.ts). */
const MEDIA_NAME = /^[\w][\w.\- ()]{0,120}$/;

/** An id for a new piece, that none of `taken` has. */
export function newPieceId(taken: Iterable<{ id: string }>): string {
  const ids = new Set([...taken].map((p) => p.id));
  for (;;) {
    const id = `f-${Math.random().toString(36).slice(2, 8)}`;
    if (!ids.has(id)) return id;
  }
}

/**
 * A list of furniture from somewhere it can't be trusted (a browser, a file): each piece as it's
 * kept, or why the list won't do. It only checks each piece is a piece; where they may stand is
 * validateLayout's (shared/office-builder.ts).
 */
export function cleanFurniture(raw: unknown): Piece[] | string {
  if (!Array.isArray(raw)) return 'Choose a valid furniture list';
  if (raw.length > MAX_PIECES) return `A floor takes at most ${MAX_PIECES} pieces of furniture`;
  const out: Piece[] = [];
  const ids = new Set<string>();
  for (const value of raw) {
    if (!value || typeof value !== 'object') return 'Choose a valid furniture list';
    const r = value as Partial<Record<keyof Piece, unknown>>;
    // Not a desk's id either: the builder tells a floor's desks and its furniture apart by them.
    if (typeof r.id !== 'string' || !ID.test(r.id) || ids.has(r.id) || /^desk-\d+$/.test(r.id)) return 'Every piece of furniture needs an id of its own';
    if (typeof r.kind !== 'string' || !(r.kind in FURNITURE)) return 'There is no such piece of furniture';
    const kind = r.kind as FurnitureKind;
    const k = kindDef(kind);
    if (![r.x, r.z, r.rotY].every((n) => typeof n === 'number' && Number.isFinite(n))) return `${k.label} coordinates must be finite numbers`;
    let rotY = (((r.rotY as number) % TAU) + TAU) % TAU;
    if (k.r === undefined) {
      const quarter = Math.round(rotY / QUARTER);
      if (Math.abs(rotY - quarter * QUARTER) > 0.001) return `Turn the ${k.label.toLowerCase()} in quarter turns`;
      rotY = (quarter % 4) * QUARTER;
    } else rotY = tidy(rotY);
    const piece: Piece = { id: r.id, kind, x: tidy(round(r.x as number, GRID)), z: tidy(round(r.z as number, GRID)), rotY };
    if (k.color) {
      const color = typeof r.color === 'string' ? r.color.toLowerCase() : k.color;
      piece.color = COLOR.test(color) ? color : k.color;
    }
    if (k.sizes) {
      const scale = typeof r.scale === 'number' && Number.isFinite(r.scale) ? r.scale : 1;
      piece.scale = tidy(round(Math.max(PIECE_SCALE.min, Math.min(PIECE_SCALE.max, scale)), GRID));
    }
    if (k.text !== undefined) piece.text = cleanPieceText(r.text) || k.text;
    if (k.plays && typeof r.media === 'string' && MEDIA_NAME.test(r.media) && !r.media.includes('..')) piece.media = r.media;
    // One of each of what the office comes with, under its own name, and where the office hangs it if it's on a wall.
    if (k.fixed && piece.id !== kind) return `There is only one ${k.label.toLowerCase()}`;
    const hung = PINNED.get(kind);
    if (hung) Object.assign(piece, { x: hung.x, z: hung.z, rotY: hung.rotY });
    ids.add(piece.id);
    out.push(piece);
  }
  return out;
}
