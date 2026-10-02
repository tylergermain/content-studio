import { roomOf, type RoomOptions } from '../../shared/floorplan';
import { BALCONY, DANCE_FLOOR, FIRE_PIT, FLOOR, MEETING_ROOM, ROOF_BAR, ROOF_TABLES, SEATING_BY_ID, STAGE, WING, inWing, seatAt } from '../../shared/layout';
import { DECK_Y, hasBoss, onDeck } from '../../shared/mezzanine';
import type { PeerInfo } from '../../shared/protocol';
import { ROOF } from '../../shared/rooftop';
import { CARS, type CarSeat } from '../../shared/garage';
import { store } from '../state';

/** Every upstairs a floor can have: where someone up off the floor may be standing, on a floor whose room isn't known. */
const ANY_DECK: readonly RoomOptions[] = [{ mezzanine: 'corner' }, { mezzanine: 'big' }];

/**
 * What a teammate is up to, for the line under their name tag and in the sidebar: whatever they have
 * open ("💻 in Pixel's terminal", "🔀 reading PR #12"), else somewhere worth saying they are ("🌇 on
 * the balcony", "🛋️ on the couch", "🏎️ driving the Orange Lambo"). Nothing while they're just walking around
 * the office.
 *
 * `room` is their floor's room (its upstairs, and whether that's the boss's office), which is only
 * known for the floor you're on: of someone up off the floor anywhere else, all there is to say is
 * that they're upstairs.
 */
export function whereabouts(p: PeerInfo, car?: { car: number; seat: CarSeat }, room: RoomOptions | undefined = store.onMyFloor(p) ? roomOf(store.floorPlan) : undefined): string | undefined {
  if (p.doing) return p.doing;
  // Not standing anywhere: in on the 2D view, from a phone, say.
  if (p.lite) return '📱 on the 2D view';
  // In one of the garage's cars (see Store.carOf).
  const def = car && CARS[car.car];
  if (def) return `🏎️ ${car.seat === 'driver' ? 'driving' : 'riding in'} the ${def.name}`;
  if (p.smoking) return '🚬 on a smoke break';
  if (p.golfing) return '🏌️ teeing off';
  if (p.throwing) return p.throwing === 'darts' ? '🎯 playing darts' : '🪓 throwing axes';
  const place = p.seat ? seatAt(p.seat) : undefined;
  const seat = place && SEATING_BY_ID.get(place.seatId);
  if (seat) {
    // "🛋️ Couch" -> "🛋️ on the couch".
    const [icon, ...name] = seat.label.split(' ');
    return `${icon} ${seat.game ? 'in' : 'on'} the ${name.join(' ').toLowerCase()}`;
  }
  // The roof is the office's size, but none of its rooms are up there.
  if (p.floor === ROOF) return onTheRoof(p);
  // Through the north wall in the back office: nobody gets there unless the floor's built out.
  if (p.y > -1 && inWing(p.x, p.z, WING.rows)) return '🏗️ in the back office';
  // Down on the street, or out the back door on the stairs down to it.
  if (p.y < -1 || p.x < FLOOR.minX || p.x > FLOOR.maxX || p.z < FLOOR.minZ) return '🚶 outside';
  if (p.z > FLOOR.maxZ) return p.x >= BALCONY.minX && p.x <= BALCONY.maxX ? '🌇 on the balcony' : '🚶 outside';
  // Up off the office floor: on its deck, if it's over one (and not just on the ladder, or up the pole).
  if (p.y > DECK_Y - 0.5) {
    if (!room) return ANY_DECK.some((any) => onDeck(any, p.x, p.z)) ? '⬆️ upstairs' : undefined;
    if (!onDeck(room, p.x, p.z)) return undefined;
    return hasBoss(room) ? "👔 in the boss's office" : '⬆️ upstairs';
  }
  if (p.x > MEETING_ROOM.minX && p.z > MEETING_ROOM.minZ) return '🤝 in the meeting room';
  return undefined;
}

/** Somewhere on the rooftop bar worth saying they are, standing up. */
function onTheRoof(p: PeerInfo): string | undefined {
  if (p.x > STAGE.minX && p.x < STAGE.maxX && p.z < STAGE.maxZ) return '🎧 up on the stage';
  if (p.x > DANCE_FLOOR.minX && p.x < DANCE_FLOOR.maxX && p.z > DANCE_FLOOR.minZ && p.z < DANCE_FLOOR.maxZ) return '🪩 on the dance floor';
  if (p.x > ROOF_BAR.x - 2.5 && p.z > ROOF_BAR.minZ - 0.5 && p.z < ROOF_BAR.maxZ + 0.5) return '🍸 at the bar';
  if (ROOF_TABLES.some((t) => Math.hypot(p.x - t.x, p.z - t.z) < 1.3)) return '🕯️ at a tall table';
  if (Math.hypot(p.x - FIRE_PIT.x, p.z - FIRE_PIT.z) < 3.5) return '🔥 by the fire';
  return undefined;
}
