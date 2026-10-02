// The way over to a teammate you clicked in the sidebar: round the furniture downstairs (see
// shared/nav.ts), up the stairs when they're upstairs (whichever upstairs the floor has: see deckOf in
// shared/mezzanine.ts), or out through the balcony doors when that's where they are.

import type { RoomOptions } from '../../../shared/floorplan';
import { BALCONY, BALCONY_DOOR, FLOOR, WALL_T, inWing } from '../../../shared/layout';
import { DECK_Y, deckOf, type Area, type Deck, type Flight } from '../../../shared/mezzanine';
import { route } from '../../../shared/nav';

export interface Spot {
  x: number;
  y: number;
  z: number;
}

type At = { x: number; z: number };
type Zone = 'floor' | 'stairs' | 'upper' | 'balcony' | 'outside';

/** From the balcony out onto the office floor: in through its doors. */
const BALCONY_IN: At[] = [
  { x: BALCONY_DOOR.u, z: FLOOR.maxZ + WALL_T + 0.6 },
  { x: BALCONY_DOOR.u, z: FLOOR.maxZ - 0.7 },
];

const within = (a: Area, p: At, pad = 0) => p.x > a.minX - pad && p.x < a.maxX + pad && p.z > a.minZ - pad && p.z < a.maxZ + pad;
const apart = (a: At, b: At) => Math.hypot(a.x - b.x, a.z - b.z);

/** The flight of stairs `p` is part-way up, if it's on one. They're off the office floor's map, which has the stairs down as a wall. */
function flightAt(deck: Deck | undefined, p: Spot): Flight | undefined {
  return p.y > 0.05 ? deck?.flights.find((f) => within(f.rect, p, 0.1)) : undefined;
}

/**
 * The flight to take between `up` (somewhere on the deck) and `down` (somewhere off it): the nearest,
 * which is the one that makes the shortest walk of the two ends, as the crow flies.
 */
export function flightBetween(flights: readonly Flight[], up: At, down: At): Flight {
  const walk = (f: Flight) => apart(up, f.topAt) + apart(f.footAt, down);
  return flights.reduce((best, f) => (walk(f) < walk(best) ? f : best));
}

function zoneOf(p: Spot, wing: number, deck: Deck | undefined): Zone {
  // The back office is more of the office floor, through where the north wall was.
  if (p.y > -1 && p.y < 0.5 && inWing(p.x, p.z, wing)) return 'floor';
  if (p.y < -1 || p.x < FLOOR.minX || p.x > FLOOR.maxX || p.z < FLOOR.minZ) return 'outside';
  if (p.z > FLOOR.maxZ) return p.x >= BALCONY.minX && p.x <= BALCONY.maxX ? 'balcony' : 'outside';
  if (deck && p.y > DECK_Y - 0.5 && within(deck.slab, p)) return 'upper';
  if (flightAt(deck, p)) return 'stairs';
  return 'floor';
}

/**
 * The points on the way from `p` (in `zone`) out onto the office floor, heading for `other`: off the
 * bottom of the flight it's on, down the nearest flight from upstairs (off the deck at the top of it,
 * which in the corner loft is its door), in through the balcony doors.
 */
function wayDown(zone: Zone, p: Spot, other: Spot, deck: Deck | undefined): At[] {
  if (zone === 'balcony') return BALCONY_IN;
  if (zone === 'stairs') return [flightAt(deck, p)!.footAt];
  if (zone !== 'upper') return [];
  const flight = flightBetween(deck!.flights, p, other);
  return [flight.topAt, flight.footAt];
}

/**
 * The corners of a walk from `from` to `to`, `to` included when it's somewhere you can stand, on a
 * floor built out `wing` rows into the back office, whose room is `room` (its upstairs and its stairs).
 * Across the office floor it goes by the floor's own map (see setOfficeRoom in shared/nav.ts).
 */
export function wayTo(from: Spot, to: Spot, wing = 0, room: RoomOptions = {}): At[] {
  const deck = deckOf(room);
  const a = zoneOf(from, wing, deck);
  const b = zoneOf(to, wing, deck);
  const there = { x: to.x, z: to.z };
  // Somewhere the office has no map of, or across the same deck or the balcony: straight there.
  if (a === 'outside' || b === 'outside' || (a === b && (a === 'upper' || a === 'balcony'))) return [there];
  const onFrom = flightAt(deck, from);
  const onTo = flightAt(deck, to);
  // Up or down the same flight.
  if (a === 'stairs' && b === 'stairs' && onFrom === onTo) return [there];
  // Between a flight and the deck at the top of it: off its top step.
  if (a === 'stairs' && b === 'upper') return [onFrom!.topAt, there];
  if (a === 'upper' && b === 'stairs') return [onTo!.topAt, there];
  const out = wayDown(a, from, to, deck);
  const into = [...wayDown(b, to, from, deck)].reverse();
  const start = out[out.length - 1] ?? from;
  const end = into[0] ?? to;
  // Across the office floor; route stops at the nearest place to stand if they're in a chair or on the couch.
  const across = route([start.x, start.z], [end.x, end.z], wing)
    .slice(1)
    .map(([x, z]) => ({ x, z }));
  return [...out, ...across, ...into.slice(1), ...(b === 'floor' ? [] : [there])];
}
