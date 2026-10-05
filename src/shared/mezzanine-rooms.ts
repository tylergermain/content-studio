// A set of rooms to start the big mezzanine with (see BIG in shared/mezzanine.ts): four glass-fronted
// offices along the deck, each with a doorway that names it, and an open landing where the stairs
// arrive. They're ordinary furniture with `level: 1`, so the builder moves, renames or removes any of it.

import { kindDef, newPieceId, type FurnitureKind, type Piece } from './furniture.js';

const QUARTER = Math.PI / 2;

/** The line the rooms' fronts stand on: a walkway's width back from the deck's rail. */
const FRONT_Z = 6.9;
/** The walls between the rooms, from the fronts back to the south wall: where each stands along the deck. */
const CROSS_X = [-9.6, -1.2, 7.2, 13.2];
/** What each cross wall is made of, front to back: two walls and a short one, each turned to run north to south. */
const CROSS: readonly (readonly [kind: FurnitureKind, z: number])[] = [
  ['wall', 8.2],
  ['wall', 10.6],
  ['wall-short', 12.4],
];
/**
 * Each room's front, west to east: glass, with its doorway at the end nearer the landing. The two
 * east of it take the loft's high windows.
 */
const FRONTS: readonly (readonly [kind: FurnitureKind, x: number, name?: string])[] = [
  ['glass-wall', -16.8],
  ['glass-wall', -14.4],
  ['glass-wall', -12],
  ['doorway', -10.2, 'Office 1'],
  ['glass-wall', -8.4],
  ['glass-wall', -6],
  ['glass-wall', -3.6],
  ['doorway', -1.8, 'Office 2'],
  ['doorway', 7.8, 'Studio'],
  ['glass-wall', 9.6],
  ['glass-wall', 12],
  ['doorway', 13.8, 'Office 3'],
  ['glass-wall', 15.6],
  ['glass-short', 17.4],
];

/** The starter rooms as pieces to add to a floor that has `taken` already: each with an id none of those has, as the office keeps a piece. */
export function starterRooms(taken: Iterable<{ id: string }>): Piece[] {
  const pieces: Piece[] = [];
  const ids = [...taken].map((p) => ({ id: p.id }));
  const add = (kind: FurnitureKind, x: number, z: number, rotY: number, text?: string) => {
    const id = newPieceId(ids);
    ids.push({ id });
    const k = kindDef(kind);
    pieces.push({ id, kind, x, z, rotY, ...(k.color ? { color: k.color } : {}), ...(text ? { text } : {}), level: 1 });
  };
  for (const [kind, x, name] of FRONTS) add(kind, x, FRONT_Z, 0, name);
  for (const x of CROSS_X) for (const [kind, z] of CROSS) add(kind, x, z, QUARTER);
  return pieces;
}
