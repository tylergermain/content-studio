// Where people are on Main Street, whichever floor they're on: each floor draws the street that many
// storeys under it, so someone's spot on their floor is a spot on the one street (shared/mainstreet.ts).
// The helicopter's landing check and a plot's claim both ask who's out there.
import { streetBelow } from '../../shared/layout.js';
import { fridayFrame, toStreet, type StreetPoint } from '../../shared/mainstreet.js';
import type { Client } from '../office/client.js';
import type { Ctx } from '../office/context.js';

/** Which storey floor `id` is (0 is the bottom one), as the building stacks them; -1 for none (the roof, the lobby). */
export function storeyOf(ctx: Ctx, id: string | undefined): number {
  if (!id) return -1;
  let i = 0;
  for (const key of ctx.floors.keys()) {
    if (key === id) return i;
    i++;
  }
  return -1;
}

/** Where `c` is in the street frame; null when they're not on a floor of the building (the roof, the lobby) or are on the 2D view. */
export function streetSpot(ctx: Ctx, c: Client): StreetPoint | null {
  if (c.out || c.peer.lite) return null;
  const i = storeyOf(ctx, c.peer.floor);
  return i < 0 ? null : toStreet(fridayFrame(streetBelow(i)), c.peer);
}

/** Everyone down at street level, on every floor: their feet no more than `up` over the street (not up on a balcony). */
export function streetPeople(ctx: Ctx, up = 3): { c: Client; at: StreetPoint }[] {
  const out: { c: Client; at: StreetPoint }[] = [];
  for (const c of ctx.clients.values()) {
    const at = streetSpot(ctx, c);
    if (at && at.h > -1 && at.h <= up) out.push({ c, at });
  }
  return out;
}
