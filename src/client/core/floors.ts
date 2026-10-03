/**
 * The building's floors as the office and its parts see them: which are built, how far each one's
 * back office goes, what each one's storey looks like from outside, and which seats are there to sit
 * at. Also the paint of the floor you're on, and who's waiting on another floor.
 */
import { floorPalette } from '../../shared/floors';
import { DESK_BY_ID, FLOOR, WING, deskBuilt, inWing } from '../../shared/layout';
import type { FloorInfo } from '../../shared/protocol';
import { store } from '../state';
import { $, toast } from '../ui/dom';
import type { StoreyLook } from '../world/facade';
import type { Ctx } from './context';

/** The floors of the building from the bottom up (not the ones still being cloned: nobody can go there yet). */
export function builtFloors(): FloorInfo[] {
  return store.floors.filter((f) => !f.cloning);
}

/** How far each floor's back office goes, for the building's outside (the one you're on as you see it). */
export function floorWings(floors: FloorInfo[]): number[] {
  return floors.map((f) => (f.id === store.floor ? store.floorPlan.wing : (f.wing ?? 0)));
}

/**
 * Each floor as the building's outside shows it, from the bottom up: its name, and the color of its
 * paint's trim for its slab band and its sign. That's the paint the office builder gave it (its look),
 * else its own; the one you're on as its plan has it.
 */
export function floorStoreys(floors: FloorInfo[]): StoreyLook[] {
  return floors.map((f) => ({ name: f.name, accent: floorPalette((f.id === store.floor ? store.floorPlan.look : f.look) ?? f.palette).trim }));
}

/** Whether seat `id` is there to sit at on this floor: a back office desk only once the floor's built out that far. */
export function seatBuilt(id: string): boolean {
  const d = DESK_BY_ID.get(id);
  return !d || deskBuilt(d, store.floorPlan.wing);
}

/**
 * Standing where a back office would be, further back than this floor's goes (`level` rows): a row
 * walled up round you, or a floor you switched to that isn't built out as far as the one you left.
 */
export function pastTheWing(p: { x: number; y: number; z: number }, level: number): boolean {
  return p.y > -1 && p.y < 3 && p.x > WING.minX - 0.3 && p.x < WING.maxX + 0.3 && p.z < FLOOR.minZ && !inWing(p.x, p.z, level);
}

/** Registers the floor's paint (store 'floors' and 'floorPlan') and the floors' waiting count (the 'floors' message). */
export function installFloors(ctx: Ctx) {
  /** Which of the floor palettes the walls are painted in now. */
  let painted = -1;
  function paintFloor() {
    // The office builder can paint a floor's room over its own color (FloorPlan.look).
    const p = store.floorPlan.look ?? store.currentFloor()?.palette ?? 0;
    if (p === painted) return;
    painted = p;
    ctx.world().setLook(floorPalette(p));
  }
  // A brand-new floor can arrive before the elevator's list says what color it is.
  store.on('floors', paintFloor);
  store.on('floorPlan', paintFloor);

  ctx.messages.on('floors', () => noticeWaiting());
  /** Workers waiting on someone, per floor, the last time the elevator said so. */
  const waitingOn = new Map<string, number>();
  /** Someone's waiting on another floor: say so, since you can't see or hear it from here. */
  function noticeWaiting() {
    let elsewhere = 0;
    for (const f of store.floors) {
      const before = waitingOn.get(f.id);
      waitingOn.set(f.id, f.waiting);
      if (f.id === store.floor) continue;
      elsewhere += f.waiting;
      if (before !== undefined && f.waiting > before) {
        toast(`🙋 A worker on the ${f.name} floor is waiting on someone — take the elevator up`, 'warn');
        ctx.sound.ding('needs_input');
      }
    }
    const badge = $('floors-waiting');
    badge.textContent = elsewhere ? String(elsewhere) : '';
    badge.classList.toggle('hidden', !elsewhere);
    $('project').title = elsewhere ? `${elsewhere} worker${elsewhere === 1 ? '' : 's'} on other floors waiting on someone — click to go there` : 'Floors: go to another project';
  }

  return { paintFloor, noticeWaiting };
}
