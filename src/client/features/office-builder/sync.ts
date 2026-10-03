/**
 * Standing the floor's desks and furniture where a layout has them: the one the floor has saved, or
 * the one being dragged about in the builder. Everything that goes by where they are follows: what you
 * bump into and what you use, the seats there are to sit on, and the way round the floor.
 */
import { roomOf, type RoomOptions } from '../../../shared/floorplan';
import { floorPalette } from '../../../shared/floors';
import { furnitureSeats, setFloorSeats, type Piece } from '../../../shared/furniture';
import { DESKS, MEETING_SEATS, deskSeat, seatAt } from '../../../shared/layout';
import { meetingPlace, type MeetingKind } from '../../../shared/meeting-place';
import { DECK_Y, deckOf, hasBoss, onDeck, type Area, type Deck } from '../../../shared/mezzanine';
import { nearestWalkable, setOfficeFurniture, setOfficeRoom } from '../../../shared/nav';
import { ORIGINAL_DESKS, deskRect, layoutFurniture, type DeskLayout } from '../../../shared/office-builder';
import { LOFT_SEATS, type Rect } from '../../../shared/office-fixed';
import { STEPS_RECT, onSteps, stepsSeats } from '../../../shared/steps';
import type { Ctx } from '../../core/context';
import { store } from '../../state';

/** How a floor's arranged: its desks, its furniture and its paint. */
export interface Arrangement {
  desks: DeskLayout;
  furniture: readonly Piece[];
  /** Which of FLOOR_PALETTES it's painted in, over the floor's own. */
  look?: number;
  /** The room's own fittings, where they aren't the office's (see RoomOptions). */
  room?: RoomOptions;
}

export type LayoutSync = ReturnType<typeof createLayoutSync>;

export function createLayoutSync(ctx: Ctx) {
  const { office, player } = ctx;
  /** The room's desks: the shared definition each one's view and everything else reads, by id. */
  const desks = ORIGINAL_DESKS.map((original) => ({ original, def: DESKS.find((d) => d.id === original.id)!, view: office.desks.get(original.id)! }));
  // What the builder picks a desk up by, as it does a piece of furniture (see world/office/furnish.ts).
  for (const d of desks) d.view.group.userData.piece = d.original.id;
  /** The upstairs the floor had before it was last rearranged, when that's gone or another one now, until you're next settled. */
  let went: Deck | undefined;
  /** The same for the Steps (whether it had them) and for where its workers met, each from when it first changed. */
  let hadSteps: boolean | undefined;
  let metAt: MeetingKind | undefined;

  /** The layout the floor you're on has saved. */
  function saved(): Arrangement {
    const plan = store.floorPlan;
    return { desks: plan.desks ?? {}, furniture: layoutFurniture(plan), look: plan.look, room: plan.room };
  }

  /** Stands everything where `a` has it, on a floor built out `wing` rows. */
  function arrange(a: Arrangement, wing: number) {
    for (const { original, def, view } of desks) {
      const pose = a.desks[original.id] ?? original;
      // The view's own definition is this one, so its worker and its sign follow.
      Object.assign(def, { x: pose.x, z: pose.z, rotY: pose.rotY });
      view.group.position.set(def.x, 0, def.z);
      view.group.rotation.y = def.rotY;
      if (view.collider) Object.assign(view.collider, deskRect(def));
      if (view.interact) Object.assign(view.interact, deskSeat(def, 1.25));
      const sign = office.signs.get(def.id);
      if (sign) {
        sign.position.set(def.x, 0, def.z);
        sign.rotation.y = def.rotY;
      }
    }
    // The room first: what's built into it (its upstairs and the stairs, the kitchen) is there or gone before the furniture stands round it.
    const room = roomOf(a);
    const was = office.room.get();
    const had = deckOf(was);
    if (had !== deckOf(room)) went ??= had;
    if (was.steps !== room.steps) hadSteps ??= was.steps;
    if (was.meeting !== room.meeting) metAt ??= was.meeting;
    office.room.set(room);
    // Where the floor's workers meet: the five seats every floor shares stand at this floor's own place, so whoever
    // looks one up by its id (a worker walking in to it, its view) finds it there. (The 3D office moves what you see of them.)
    meetingPlace(room).seats.forEach((pose, i) => Object.assign(MEETING_SEATS[i], pose));
    ctx.sound.setKitchen(room.kitchen);
    office.furniture.set(a.furniture, wing);
    // The seats there are to sit on: the furniture's, and a bench on each tier of the Steps on a floor that has them.
    setFloorSeats([...furnitureSeats(a.furniture, wing), ...(room.steps ? stepsSeats() : [])]);
    setOfficeFurniture(a.furniture);
    setOfficeRoom(room);
  }

  /** Paints the room in `look`, or in the floor's own paint with none. */
  function paint(look: number | undefined) {
    office.setLook(floorPalette(look ?? store.currentFloor()?.palette ?? 0));
  }

  /**
   * Once the floor's rearranged under you: sitting on something that's moved, you move with it (or
   * get up, if it's gone), and standing where something stands now (a flight of stairs, the Steps or
   * the meeting place's table too, when one comes), you step out of it. Up on a deck or its stairs, or
   * on a tier of the Steps, when that goes, you're down on the floor.
   */
  function settle() {
    if (ctx.upTop()) return;
    const room = office.room.get();
    const deck = deckOf(room);
    const lost = went;
    const noSteps = hadSteps === true && !room.steps;
    const moved = metAt !== undefined && metAt !== room.meeting;
    went = hadSteps = metAt = undefined;
    const p = player.pos;
    const inside = (a: Area, pad: number) => p.x > a.minX - pad && p.x < a.maxX + pad && p.z > a.minZ - pad && p.z < a.maxZ + pad;
    const within = ([minX, maxX, minZ, maxZ]: Rect, pad: number) => inside({ minX, maxX, minZ, maxZ }, pad);
    if (player.seat) {
      // The loft's couch, the boss's chair and the guests' went with the boss's office.
      const place = LOFT_SEATS.has(player.seat.seatId) && !hasBoss(room) ? undefined : seatAt(player.seat.key);
      if (place) {
        if (place.x !== player.seat.x || place.y !== player.seat.y || place.z !== player.seat.z || place.rotY !== player.seat.rotY) player.sit(place);
        return;
      }
      player.stand();
      player.onStand?.();
    }
    // Up where a deck or its stairs were, with neither under you now, or on a tier of the Steps that have gone:
    // on the floor below, wherever there's room to stand.
    const held = !!deck && ((onDeck(room, p.x, p.z, -0.4) && p.y > DECK_Y - 0.6) || deck.flights.some((f) => inside(f.rect, 0.4)));
    const upOn = (!!lost && !held && (inside(lost.slab, 0.4) || lost.flights.some((f) => inside(f.rect, 0.4)))) || (noSteps && onSteps(p.x, p.z));
    if (upOn && p.y > 0.1) {
      const [x, z] = nearestWalkable([p.x, p.z], store.floorPlan.wing);
      p.set(x, 0, z);
      player.vy = 0;
      player.grounded = true;
      return;
    }
    const all = [...desks.map((d) => d.view.collider), ...[...office.furniture.all()].map((v) => v.collider)];
    const hits = (c: (typeof all)[number]) => !!c && inside(c, 0.3);
    if (Math.abs(p.y - DECK_Y) < 0.1 && deck) {
      // Upstairs, where something stands now: at the top of the nearest stairs, which is kept clear.
      if (all.some((c) => c?.bottom && hits(c))) {
        const top = deck.flights.map((f) => f.topAt).sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
        if (top) p.set(top.x, DECK_Y, top.z);
      }
      return;
    }
    if (Math.abs(p.y) > 0.1) return;
    // On the floor where a flight of stairs stands (again), or the Steps: they're solid from the floor up, so that's
    // inside them. The same where the meeting place has just put its table (its glass, its prompter).
    // (What's upstairs starts at the deck: nobody under it is in its way.)
    const builtIn = deck?.flights.some((f) => inside(f.rect, 0.3)) || (room.steps && within(STEPS_RECT, 0)) || (moved && meetingPlace(room).fixed.some((f) => within(f.rect, 0.3)));
    if (builtIn || all.some((c) => !c?.bottom && hits(c))) {
      const [x, z] = nearestWalkable([p.x, p.z], store.floorPlan.wing);
      p.x = x;
      p.z = z;
    }
  }

  return { saved, arrange, paint, settle, deskIds: desks.map((d) => d.original.id) };
}
