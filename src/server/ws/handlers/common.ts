// Lookups most handlers start with.
import type { Floor } from '../../floor.js';
import type { Ctx } from '../../office/context.js';
import type { Client } from '../../office/client.js';
import { str } from '../../office/input.js';
import { floorAccessError } from '../../org-chart/access.js';

/** The floor `c` is on, or a note to them that they have to be on one. */
export const here = (ctx: Ctx, c: Client): Floor | undefined => {
  const f = ctx.floorOf(c);
  if (!f) ctx.warn(c, 'Take the elevator to a floor first');
  return f;
};

/** The floor `c` is on, when they may work there (shared/floor-access.ts); else a note to them saying why not. */
export const workHere = (ctx: Ctx, c: Client): Floor | undefined => {
  const f = here(ctx, c);
  if (!f) return undefined;
  const why = floorAccessError(ctx, f, c.accountId);
  if (why) ctx.warn(c, why);
  return why ? undefined : f;
};

/** A worker by id, with the floor it sits on. */
export const workerOf = (ctx: Ctx, id: unknown) => {
  const wid = str(id, 32);
  const floor = ctx.workerFloor(wid);
  return floor ? { wid, floor, info: floor.workers.get(wid)! } : undefined;
};
