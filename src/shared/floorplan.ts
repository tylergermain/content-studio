// A floor's own layout on top of the office everyone shares: the signs hung over its desks, how far
// its back office is built out (see WING in layout.ts), and where its desks and furniture stand once
// someone's rearranged them (see shared/office-builder.ts). Saved by server/floorplan.ts.

import { FLOOR_PALETTES } from './floors.js';
import { DEFAULT_FURNITURE, type Piece } from './furniture.js';
import { layoutProblems, validateLayout, type DeskLayout } from './office-builder.js';
import { DESKS, WING, WING_DESKS, wingLevel, type Side } from './layout.js';
import { hasBoss, hasKitchen, mezzanineOf, type MezzanineKind } from './mezzanine.js';

/** A sign hanging from the ceiling over a desk, naming what it's for ("Operations", "Code cleanup"). */
export interface DeskLabel {
  text: string;
  /** One of SIGN_COLORS. */
  color: string;
  by: string;
  at: number;
}

export interface FloorPlan {
  /** Where the room's desks stand, once they've been moved (see the office builder). */
  desks?: DeskLayout;
  /** Everything else on the floor, once it's been rearranged: none is the office's as it comes (DEFAULT_FURNITURE). */
  furniture?: Piece[];
  /** Which of FLOOR_PALETTES the room's painted in, when the builder picked one over the floor's own. */
  look?: number;
  /** What this floor has of the room's own fittings, where that isn't what the office comes with (see RoomOptions). */
  room?: RoomOptions;
  /** Goes up each time the layout's saved, so a builder working from an older one is told. */
  layoutRevision?: number;
  /** How many rows the back office is built out (0 is just the room), up to WING.rows. */
  wing: number;
  /** Signs by desk id. */
  labels: Record<string, DeskLabel>;
}

/** The outside walls a floor can have in wood, in the order a room keeps them. */
export const PANEL_SIDES: readonly Side[] = ['north', 'east', 'south', 'west'];

/**
 * The room's own fittings a floor can have its own way, set in the office builder with the layout:
 * how many driving tees are out on the balcony, what it has for an upstairs, whether the boss's office
 * and the kitchen are there, and which walls are wood. A floor's plan only keeps what differs from
 * ROOM_DEFAULTS, in this order (see cleanRoom).
 */
export interface RoomOptions {
  /** Driving tees side by side on the balcony: 1, or 2 for teeing off together. */
  tees?: number;
  /** The upstairs: the loft in the south-east corner with its stairs (what a room that doesn't say has), the big mezzanine along the south side, or none for a floor that's all one level. */
  mezzanine?: MezzanineKind;
  /** The boss's office up in the corner loft: false leaves the loft an empty glass room to furnish. */
  boss?: boolean;
  /** The kitchen in the south-west corner: false for a floor without one. */
  kitchen?: boolean;
  /** The outside walls panelled in wood, floor to ceiling. */
  panels?: readonly Side[];
  /** What that wood is: oak, unless it says walnut. */
  wood?: 'oak' | 'walnut';
  /** Read only: false on a floor saved before `mezzanine` said 'none'. Never written again. */
  loft?: boolean;
}

/** A floor's room worked out in full, every fitting said: what the office is built from (see roomOf). */
export interface FloorRoom {
  tees: number;
  mezzanine: MezzanineKind;
  boss: boolean;
  kitchen: boolean;
  panels: readonly Side[];
  wood: 'oak' | 'walnut';
}
export const ROOM_DEFAULTS: FloorRoom = { tees: 1, mezzanine: 'corner', boss: true, kitchen: true, panels: [], wood: 'oak' };

/** Room options from somewhere they can't be trusted: only what's valid and isn't the default, in RoomOptions' order. */
export function cleanRoom(raw: unknown): RoomOptions {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  // What it says for a mezzanine wins; a floor from before it could say goes by its `loft`.
  const mezzanine = mezzanineOf({ mezzanine: r.mezzanine as MezzanineKind, loft: r.loft === false ? false : undefined });
  const panels = Array.isArray(r.panels) ? PANEL_SIDES.filter((side) => (r.panels as unknown[]).includes(side)) : [];
  return {
    ...(r.tees === 2 ? { tees: 2 } : {}),
    ...(mezzanine !== 'corner' ? { mezzanine } : {}),
    // The boss's office is the corner loft's: nowhere else is there one to leave out.
    ...(mezzanine === 'corner' && r.boss === false ? { boss: false } : {}),
    ...(r.kitchen === false ? { kitchen: false } : {}),
    ...(panels.length ? { panels } : {}),
    ...(r.wood === 'walnut' ? { wood: 'walnut' as const } : {}),
  };
}

/** A floor's room as it is: its own options over the office's. (Always in FloorRoom's order: what follows it compares them as text.) */
export function roomOf(plan: { room?: RoomOptions } | undefined): FloorRoom {
  const c = cleanRoom(plan?.room);
  return { tees: c.tees ?? ROOM_DEFAULTS.tees, mezzanine: mezzanineOf(c), boss: hasBoss(c), kitchen: hasKitchen(c), panels: c.panels ?? [], wood: c.wood ?? ROOM_DEFAULTS.wood };
}

export const EMPTY_PLAN: FloorPlan = { wing: 0, labels: {} };

/** The longest a sign's text may be, in characters. */
export const MAX_LABEL = 32;

/** What a sign can be painted: its board, and the ink its letters are in. */
export const SIGN_COLORS = [
  { color: '#2b2d42', ink: '#fffaf3', name: 'Navy' },
  { color: '#ef476f', ink: '#fffaf3', name: 'Pink' },
  { color: '#f78c6b', ink: '#2b2d42', name: 'Orange' },
  { color: '#ffd166', ink: '#2b2d42', name: 'Yellow' },
  { color: '#06d6a0', ink: '#2b2d42', name: 'Green' },
  { color: '#118ab2', ink: '#fffaf3', name: 'Blue' },
  { color: '#9b5de5', ink: '#fffaf3', name: 'Purple' },
] as const;

/** A few to start from, in the label window. */
export const LABEL_IDEAS = ['Operations', 'Code cleanup', 'Frontend', 'Backend', 'Bug fixes', 'Docs', 'Infra', 'Research'];

/** Desks that can have a sign: the room's and the back office's, not the bean bags, kiosks or meeting chairs. */
const LABELABLE = new Set([...DESKS, ...WING_DESKS].map((d) => d.id));

export function canLabel(deskId: string): boolean {
  return LABELABLE.has(deskId);
}

/** A sign's text as it's hung: one line, no control characters, at most MAX_LABEL characters. */
export function cleanLabel(text: unknown): string {
  if (typeof text !== 'string') return '';
  const flat = text.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
  return [...flat].slice(0, MAX_LABEL).join('').trim();
}

/** The paint a sign asked for, or the first one when it's none of SIGN_COLORS. */
export function signColor(color: unknown): string {
  return SIGN_COLORS.find((c) => c.color === color)?.color ?? SIGN_COLORS[0].color;
}

/** The ink for letters on a board painted `color`. */
export function signInk(color: string): string {
  return SIGN_COLORS.find((c) => c.color === color)?.ink ?? SIGN_COLORS[0].ink;
}

/** A plan read back from disk (or anywhere else it can't be trusted): what's valid of it. */
export function cleanPlan(raw: unknown): FloorPlan {
  const r = raw && typeof raw === 'object' ? (raw as Partial<Record<keyof FloorPlan, unknown>>) : {};
  const labels: Record<string, DeskLabel> = {};
  if (r.labels && typeof r.labels === 'object') {
    for (const [id, l] of Object.entries(r.labels as Record<string, unknown>)) {
      if (!canLabel(id) || !l || typeof l !== 'object') continue;
      const s = l as Partial<Record<keyof DeskLabel, unknown>>;
      const text = cleanLabel(s.text);
      if (!text) continue;
      labels[id] = { text, color: signColor(s.color), by: typeof s.by === 'string' ? s.by : '?', at: typeof s.at === 'number' ? s.at : 0 };
    }
  }
  // A layout that no longer fits the office (it was saved by an older one) is dropped whole: the office as it comes,
  // less what its room has no place for (see stock).
  // (Checked against the room it was saved with: a floor that's all one level may have furniture where the stairs were.)
  const room = cleanRoom(r.room);
  const layout = r.desks === undefined && r.furniture === undefined ? undefined : validateLayout(r.desks, r.furniture, room);
  const look = cleanLook(r.look);
  return {
    wing: wingLevel(r.wing),
    labels,
    ...(look !== undefined ? { look } : {}),
    ...(Object.keys(room).length ? { room } : {}),
    ...(typeof layout === 'object'
      ? { desks: layout.desks, ...(r.furniture !== undefined ? { furniture: layout.furniture } : {}), layoutRevision: Number.isSafeInteger(r.layoutRevision) && Number(r.layoutRevision) >= 0 ? Number(r.layoutRevision) : 0 }
      : stock(room)),
  };
}

/**
 * What a floor with no layout of its own has for furniture, where that isn't simply the office's as it
 * comes: in a room the office's own doesn't all fit (the hoop hangs where the big mezzanine's slab
 * is), the office's less what's in that room's way. Nothing, in a room it all fits.
 */
function stock(room: RoomOptions): { furniture?: Piece[] } {
  if (!Object.keys(room).length) return {};
  const wrong = layoutProblems({ desks: {}, furniture: DEFAULT_FURNITURE.map((p) => ({ ...p })) }, room);
  return wrong.size ? { furniture: DEFAULT_FURNITURE.filter((p) => !wrong.has(p.id)).map((p) => ({ ...p })) } : {};
}

/** Which of FLOOR_PALETTES `look` names, or undefined when it's none of them (the floor's own paint). */
export function cleanLook(look: unknown): number | undefined {
  return Number.isInteger(look) && (look as number) >= 0 && (look as number) < FLOOR_PALETTES.length ? (look as number) : undefined;
}

/** The desks a row of the back office brings: `row` from 1. */
export function rowDesks(row: number) {
  return WING_DESKS.filter((d) => d.wing === row);
}

/** How many more rows the back office can take. */
export function roomToGrow(plan: FloorPlan): number {
  return WING.rows - plan.wing;
}
