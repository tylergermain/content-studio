// The whisky cabinet: a walnut sideboard with a bottle of The Macallan Litha, a decanter of it and four
// crystal glasses on a silver tray (see client/features/whisky, and world/office/furniture-whisky.ts
// for how it looks). Pour yourself a dram there, and clink glasses with whoever else has one. What both
// sides go by: which kind it is, where you pour from, how long a pour takes, who's near enough to clink
// with, and what the floor is told when you do (and how often).

import { kindDef, pieceY, type FurnitureKind, type Piece } from './furniture.js';

export const WHISKY_KIND = 'whisky-cabinet' satisfies FurnitureKind;
/** What's in the decanter. */
export const WHISKY_NAME = 'The Macallan Litha';
/** The glasses on the tray: the first few people to pour take one each. */
export const GLASSES = 4;
/** A dram goes in this many sips. */
export const SIPS = 5;
/**
 * How near two people with a dram stand to raise a glass to each other (metres apart on the floor),
 * and how far apart in height they may be (on the same floor, not one on the stairs over the other);
 * and how near for their glasses to meet, as far as arms reach (further than that, they're raised
 * toward each other from where they stand: see client/features/whisky/clink.ts).
 */
export const CLINK = { reach: 2, rise: 1.2, touch: 1.3 } as const;
/** The most people one toast takes in. */
export const CLINK_MOST = 5;
/** How far from the cabinet's front the office lets a pour through: its reach, and some for the lag. */
export const POUR_REACH = 2.6;
/**
 * A pour, start to finish, in seconds (features/whisky/world.ts plays it): off with the stopper, the
 * decanter over the glass and back, the stopper back in.
 */
export const POUR_SECONDS = 2.8;
/** How soon the office pours for the same person again, in milliseconds: never before their last pour is done. */
export const POUR_EVERY_MS = Math.ceil(POUR_SECONDS * 1000) + 200;
/** How soon the same two people's toast is told to the floor again, and any toast at all on a floor (milliseconds). */
export const TOLD = { pair: 30_000, floor: 10_000 } as const;

/** Someone standing somewhere: a peer, as both sides know them. */
export interface Stood {
  id: string;
  x: number;
  y: number;
  z: number;
}

/** Whether `p` is a whisky cabinet. */
export const isCabinet = (p: Piece): boolean => p.kind === WHISKY_KIND;

/** Where you stand to pour at the cabinet `p`: out from its front, on the floor it stands on (into `to`, if given). */
export function pourSpot(p: Piece): { x: number; y: number; z: number };
export function pourSpot<T extends { x: number; y?: number; z: number }>(p: Piece, to: T): T;
export function pourSpot(p: Piece, to: { x: number; y?: number; z: number } = { x: 0, y: 0, z: 0 }) {
  const out = kindDef(p.kind).use?.z ?? 0.9;
  to.x = p.x + Math.sin(p.rotY) * out;
  to.y = pieceY(p);
  to.z = p.z + Math.cos(p.rotY) * out;
  return to;
}

/** Whether someone standing at `at` is near enough to the cabinet `p` to pour at it. */
export function canPour(p: Piece, at: { x: number; y: number; z: number }, reach = POUR_REACH): boolean {
  const s = pourSpot(p);
  return Math.hypot(at.x - s.x, at.z - s.z) <= reach && Math.abs(at.y - s.y) <= CLINK.rise;
}

/**
 * How far `o` is from `me` on the floor, when they're someone else near enough to clink glasses with
 * (see CLINK), or -1 when they're not.
 */
export function clinkDistance(me: Stood, o: Stood, reach: number = CLINK.reach): number {
  if (o.id === me.id || Math.abs(o.y - me.y) > CLINK.rise) return -1;
  const d = Math.hypot(o.x - me.x, o.z - me.z);
  return d <= reach ? d : -1;
}

/**
 * Who `me` clinks glasses with: everyone else in `others` near enough (see CLINK), nearest first, at
 * most CLINK_MOST of them. `others` is only those holding a dram.
 */
export function clinkWith<T extends Stood>(me: Stood, others: readonly T[], reach: number = CLINK.reach): T[] {
  return others
    .map((o) => ({ o, d: clinkDistance(me, o, reach) }))
    .filter(({ d }) => d >= 0)
    .sort((a, b) => a.d - b.d)
    .slice(0, CLINK_MOST)
    .map(({ o }) => o);
}

/** Names read out as a list: "Tyler", "Tyler and Gavin", "Tyler, Gavin and Sam". */
export function nameList(names: readonly string[]): string {
  if (names.length < 2) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** What the floor is told when glasses clink: whoever raised one first, then the others. */
export function cheersLine(names: readonly string[]): string {
  return `🥃 ${nameList(names)} raised a glass of ${WHISKY_NAME}`;
}

/**
 * Which toasts on a floor the floor is told of (the office keeps one per floor): the glasses clink and
 * "Cheers" pops up every time, but the floor hears of it at most every TOLD.floor, and of the same two
 * people at most every TOLD.pair, so nobody fills everyone's screen with it.
 */
export class Toasts {
  private lastTold = -Infinity;
  /** When each pair (their ids in order, joined) was last told of. */
  private pairs = new Map<string, number>();

  /** A toast `ids` raised (whoever raised it first) at `now` (ms): whether the floor is told of it. */
  tell(ids: readonly string[], now: number): boolean {
    if (now - this.lastTold < TOLD.floor) return false;
    const [by, ...rest] = ids;
    const keys = rest.map((id) => (by < id ? `${by} ${id}` : `${id} ${by}`));
    if (!keys.some((k) => now - (this.pairs.get(k) ?? -Infinity) >= TOLD.pair)) return false;
    for (const [k, at] of this.pairs) if (now - at >= TOLD.pair) this.pairs.delete(k);
    this.lastTold = now;
    for (const k of keys) this.pairs.set(k, now);
    return true;
  }
}
