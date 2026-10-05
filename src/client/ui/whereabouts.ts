import { roomOf, type RoomOptions } from '../../shared/floorplan';
import { BALCONY, DANCE_FLOOR, FIRE_PIT, FLOOR, MEETING_ROOM, ROOF_BAR, ROOF_TABLES, SEATING_BY_ID, STAGE, WING, inWing, seatAt } from '../../shared/layout';
import { meetingPlace } from '../../shared/meeting-place';
import { DECK_Y, hasBoss, onDeck } from '../../shared/mezzanine';
import type { PeerInfo } from '../../shared/protocol';
import { ROOF } from '../../shared/rooftop';
import { hasSteps, onSteps, stepsSeats } from '../../shared/steps';
import { CARS, type CarSeat } from '../../shared/garage';
import { store } from '../state';

/** Every upstairs a floor can have: where someone up off the floor may be standing, on a floor whose room isn't known. */
const ANY_DECK: readonly RoomOptions[] = [{ mezzanine: 'corner' }, { mezzanine: 'big' }];
/** The Steps are a place of their own, whether you're sat on a tier or stood on one. */
const ON_STEPS = '🏟️ on the Steps';
const STEPS_SEATS: ReadonlySet<string> = new Set(stepsSeats().map((s) => s.id));

/**
 * What a teammate is up to, for the line under their name tag and in the sidebar: whatever they have
 * open ("💻 in Pixel's terminal", "🔀 reading PR #12"), else somewhere worth saying they are ("🌇 on
 * the balcony", "🛋️ on the couch", "🏎️ driving the Orange Lambo"). Nothing while they're just walking around
 * the office.
 *
 * `room` is their floor's room (its upstairs, and whether that's the boss's office; where its workers
 * meet; whether it has the Steps), which is only known for the floor you're on. Of someone anywhere
 * else, all there is to say is that they're upstairs when they're up off the floor, and in the meeting
 * room when they're in the corner the office comes with one in.
 */
export function whereabouts(p: PeerInfo, car?: { car: number; seat: CarSeat }, room: RoomOptions | undefined = store.onMyFloor(p) ? roomOf(store.floorPlan) : undefined): string | undefined {
  if (p.doing) return p.doing;
  // Not standing anywhere: in on the 2D view, from a phone, say.
  if (p.lite) return '📱 on the 2D view';
  // In one of the garage's cars (see Store.carOf).
  const def = car && CARS[car.car];
  if (def) return `🏎️ ${car.seat === 'driver' ? 'driving' : 'riding in'} the ${def.name}`;
  // Aboard Friday One, from whichever floor they got in on (see Store.heliSeatOf).
  const heli = store.heliSeatOf(p.id);
  if (heli) return `🚁 ${heli.seat === 'pilot' ? 'flying' : 'riding in'} Friday One`;
  if (p.smoking) return '🚬 on a smoke break';
  if (p.golfing) return '🏌️ teeing off';
  if (p.throwing) return p.throwing === 'darts' ? '🎯 playing darts' : '🪓 throwing axes';
  const place = p.seat ? seatAt(p.seat) : undefined;
  const seat = place && SEATING_BY_ID.get(place.seatId);
  if (seat) {
    if (STEPS_SEATS.has(seat.id)) return ON_STEPS;
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
  if (!room) return p.x > MEETING_ROOM.minX && p.z > MEETING_ROOM.minZ ? '🤝 in the meeting room' : undefined;
  // Up on a tier of the Steps, or down between their walls.
  if (hasSteps(room) && onSteps(p.x, p.z)) return ON_STEPS;
  // Where the floor's workers meet: the glass room, the stage or the anchor desk, each by its own name.
  const meeting = meetingPlace(room);
  const [minX, maxX, minZ, maxZ] = meeting.area;
  return p.x > minX && p.x <= maxX && p.z > minZ && p.z <= maxZ ? meeting.where : undefined;
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
