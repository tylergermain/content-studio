/**
 * The office as a world (see world/world.ts): where its seats and boards are, what's in the way, how
 * workers walk in and out. The rooftop is swapped in for it by core/travel.ts.
 */
import type { MapPlan } from '../../shared/maps';
import { ROOF } from '../../shared/rooftop';
import { groundAt } from '../player';
import { store } from '../state';
import { officeWorld, type World } from '../world/world';
import type { Ctx } from './context';
import { idleAgentsIn } from './stations';

/** The office's world and the board agents waiting in it. Needs ctx.office made. */
export function createWorlds(ctx: Ctx) {
  const { office } = ctx;
  const world: World = officeWorld(office, () => office.stack.state.index > 0, () => officeWing());
  /** Where everything is in the office: its seats by id, and places to sit. */
  const plan = (): MapPlan => world.plan;
  /** The board agents waiting at the office's kiosks. */
  const idleAgents = idleAgentsIn(world);

  /** How many rows the office's back office is built out where you are: the floor's plan, or none on the roof. */
  function officeWing(): number {
    return store.floor !== ROOF ? store.floorPlan.wing : 0;
  }

  /** The top of whatever's underfoot at (x, z) for feet at `y`: the floor, a step, the street. */
  const groundHere = (x: number, z: number, y: number) => Math.max(groundAt(world.colliders, x, z, y), ctx.player.street);

  return {
    /** The office as it's built. */
    world: () => world,
    /** The board agents waiting by their boards. */
    idleAgents: () => idleAgents,
    plan,
    officeWing,
    groundHere,
  };
}
