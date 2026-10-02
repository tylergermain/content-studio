/**
 * Standing the floor's desks and furniture where a layout has them: the one the floor has saved, or
 * the one being dragged about in the builder. Everything that goes by where they are follows: what you
 * bump into and what you use, the seats there are to sit on, and the way round the floor.
 */
import { roomOf, type RoomOptions } from '../../../shared/floorplan';
import { floorPalette } from '../../../shared/floors';
import { furnitureSeats, setFloorSeats, type Piece } from '../../../shared/furniture';
import { DESKS, deskSeat, seatAt } from '../../../shared/layout';
import { nearestWalkable, setOfficeFurniture } from '../../../shared/nav';
import { ORIGINAL_DESKS, deskRect, layoutFurniture, type DeskLayout } from '../../../shared/office-builder';
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
    office.room.set(roomOf(a));
    office.furniture.set(a.furniture, wing);
    setFloorSeats(furnitureSeats(a.furniture, wing));
    setOfficeFurniture(a.furniture);
  }

  /** Paints the room in `look`, or in the floor's own paint with none. */
  function paint(look: number | undefined) {
    office.setLook(floorPalette(look ?? store.currentFloor()?.palette ?? 0));
  }

  /**
   * Once the floor's rearranged under you: sitting on something that's moved, you move with it (or
   * get up, if it's gone), and standing where something stands now, you step out of it.
   */
  function settle() {
    if (!ctx.inOffice() || ctx.upTop()) return;
    if (player.seat) {
      const place = seatAt(player.seat.key);
      if (!place) {
        player.stand();
        player.onStand?.();
      } else if (place.x !== player.seat.x || place.z !== player.seat.z || place.rotY !== player.seat.rotY) player.sit(place);
      return;
    }
    const p = player.pos;
    if (Math.abs(p.y) > 0.1) return;
    const inTheWay = [...desks.map((d) => d.view.collider), ...[...office.furniture.all()].map((v) => v.collider)];
    if (inTheWay.some((c) => c && p.x > c.minX - 0.3 && p.x < c.maxX + 0.3 && p.z > c.minZ - 0.3 && p.z < c.maxZ + 0.3)) {
      const [x, z] = nearestWalkable([p.x, p.z], store.floorPlan.wing);
      p.x = x;
      p.z = z;
    }
  }

  return { saved, arrange, paint, settle, deskIds: desks.map((d) => d.original.id) };
}
