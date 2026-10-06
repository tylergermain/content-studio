import type { DeskDef } from './layout.js';
import type { Piece } from './furniture.js';

// Conference tables (the 'conference-table' piece, shared/furniture.ts): six chairs round each, which workers sit
// at as they would at desks. Each table takes a block of six of the office's table seats (TABLE_SEATS), kept on the
// piece as `seats`, the first one's number, so a worker keeps its chair when the table moves, and the chairs go
// where the table puts them. A floor seated only at tables (RoomOptions.seating) has no desks or bean bags.

export const TABLE = { width: 3.6, depth: 1.4, height: 0.76, seats: 6 } as const;

/** The most chairs a floor's conference tables have between them, six a table. */
export const TABLE_SEAT_POOL = 72;

/** The chairs at conference tables, by id (in layout.ts's DESK_BY_ID): nowhere here, as a floor's own tables put them. */
export const TABLE_SEATS: DeskDef[] = Array.from({ length: TABLE_SEAT_POOL }, (_, i) => ({ id: `seat-${i + 1}`, x: 0, z: 0, rotY: 0, label: `Chair ${i + 1}`, table: true }));

/**
 * What a floor's seats are beyond the office's own: the chairs at its conference tables, by id, where each table
 * puts them, and whether those are all it has (`only`: a floor seated at tables, with no desks or bean bags).
 */
export interface Seating {
  only: boolean;
  tables: ReadonlyMap<string, DeskDef>;
}
/** How far in from the table's edge a laptop sits, and how far apart the chairs down each side are. */
const IN = 0.45;
const SPACING = 1.2;

/** The blocks there are: a table's `seats` is 1, 7, 13\u2026 */
export const TABLE_BLOCKS = TABLE_SEAT_POOL / TABLE.seats;
const validBase = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= TABLE_SEAT_POOL - TABLE.seats + 1 && (n - 1) % TABLE.seats === 0;

/**
 * A table's chairs, where it puts them: three down each long side and none at the ends (one end's for the room's
 * TV), each (x, z) the spot on the table its worker's laptop goes, turned so the worker faces in (a DeskDef's
 * worker sits on its +z side at rotY 0).
 */
export function tableSeats(p: Pick<Piece, 'x' | 'z' | 'rotY' | 'seats'>): DeskDef[] {
  if (!validBase(p.seats)) return [];
  const half = { d: TABLE.depth / 2 };
  const local: [number, number, number][] = [
    [-SPACING, half.d - IN, 0],
    [0, half.d - IN, 0],
    [SPACING, half.d - IN, 0],
    [SPACING, -half.d + IN, Math.PI],
    [0, -half.d + IN, Math.PI],
    [-SPACING, -half.d + IN, Math.PI],
  ];
  const c = Math.cos(p.rotY), s = Math.sin(p.rotY);
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return local.map(([lx, lz, r], i) => {
    const pool = TABLE_SEATS[p.seats! - 1 + i];
    return { ...pool, x: round(p.x + lx * c + lz * s), z: round(p.z - lx * s + lz * c), rotY: round(r + p.rotY) };
  });
}

const cache = new WeakMap<readonly Piece[], Seating>();
const EMPTY: Seating = { only: false, tables: new Map() };

/** A floor's seating, from its plan: the chairs at its tables (on the floor, not upstairs), and whether they're all it has. */
export function seatingOf(plan: { furniture?: readonly Piece[]; room?: { seating?: string } } | undefined): Seating {
  const only = plan?.room?.seating === 'tables';
  const furniture = plan?.furniture;
  if (!furniture) return only ? { only, tables: new Map() } : EMPTY;
  let s = cache.get(furniture);
  if (!s) {
    const tables = new Map<string, DeskDef>();
    for (const p of furniture) if (p.kind === 'conference-table' && !p.level) for (const d of tableSeats(p)) tables.set(d.id, d);
    cache.set(furniture, (s = { only: false, tables }));
  }
  return s.only === only ? s : { only, tables: s.tables };
}

/**
 * Gives each conference table its block of seats: the one it has, unless another table took it first, else the first
 * that's free. A string says why there's no room for one more.
 */
export function assignTableSeats(pieces: Piece[]): Piece[] | string {
  const taken = new Set<number>();
  const tables = pieces.filter((p) => p.kind === 'conference-table');
  for (const p of tables) {
    if (validBase(p.seats) && !taken.has(p.seats)) taken.add(p.seats);
    else delete p.seats;
  }
  for (const p of tables) {
    if (p.seats) continue;
    const free = Array.from({ length: TABLE_BLOCKS }, (_, i) => i * TABLE.seats + 1).find((n) => !taken.has(n));
    if (!free) return `A floor takes at most ${TABLE_BLOCKS} conference tables`;
    p.seats = free;
    taken.add(free);
  }
  return pieces;
}
