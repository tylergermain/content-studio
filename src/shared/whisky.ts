// The whisky cabinet: a walnut sideboard with a bottle of The Macallan Litha, a decanter of it and four
// crystal glasses on a silver tray (see client/features/whisky, and world/office/furniture-whisky.ts
// for how it looks). Pour yourself a dram there, and clink glasses with whoever else has one. What both
// sides go by: which kind it is, where you pour from, who's near enough to clink with, and what the
// floor is told when you do.

import { kindDef, pieceY, type FurnitureKind, type Piece } from './furniture.js';

export const WHISKY_KIND = 'whisky-cabinet' satisfies FurnitureKind;
/** What's in the decanter. */
export const WHISKY_NAME = 'The Macallan Litha';
/** The glasses on the tray: the first few people to pour take one each. */
export const GLASSES = 4;
/** A dram goes in this many sips. */
export const SIPS = 5;
/**
 * How near two people with a dram stand to clink glasses (metres apart on the floor), and how far
 * apart in height they may be (on the same floor, not one on the stairs over the other).
 */
export const CLINK = { reach: 2, rise: 1.2 } as const;
/** The most people one toast takes in. */
export const CLINK_MOST = 5;
/** How far from the cabinet's front the office lets a pour through: its reach, and some for the lag. */
export const POUR_REACH = 2.6;

/** Someone standing somewhere: a peer, as both sides know them. */
export interface Stood {
  id: string;
  x: number;
  y: number;
  z: number;
}

/** Whether `p` is a whisky cabinet. */
export const isCabinet = (p: Piece): boolean => p.kind === WHISKY_KIND;

/** Where you stand to pour at the cabinet `p`: out from its front, on the floor it stands on. */
export function pourSpot(p: Piece): { x: number; y: number; z: number } {
  const out = kindDef(p.kind).use?.z ?? 0.9;
  return { x: p.x + Math.sin(p.rotY) * out, y: pieceY(p), z: p.z + Math.cos(p.rotY) * out };
}

/** Whether someone standing at `at` is near enough to the cabinet `p` to pour at it. */
export function canPour(p: Piece, at: { x: number; y: number; z: number }, reach = POUR_REACH): boolean {
  const s = pourSpot(p);
  return Math.hypot(at.x - s.x, at.z - s.z) <= reach && Math.abs(at.y - s.y) <= CLINK.rise;
}

/**
 * Who `me` clinks glasses with: everyone else in `others` near enough (see CLINK), nearest first, at
 * most CLINK_MOST of them. `others` is only those holding a dram.
 */
export function clinkWith<T extends Stood>(me: Stood, others: readonly T[], reach: number = CLINK.reach): T[] {
  return others
    .filter((o) => o.id !== me.id && Math.abs(o.y - me.y) <= CLINK.rise)
    .map((o) => ({ o, d: Math.hypot(o.x - me.x, o.z - me.z) }))
    .filter(({ d }) => d <= reach)
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
