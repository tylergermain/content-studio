// The office builder: an admin saves the floor as they arranged it (see shared/office-builder.ts).
import { floorSeat } from '../../../shared/furniture.js';
import { layoutFurniture } from '../../../shared/office-builder.js';
import type { PlanClientMsg } from '../../../shared/protocol.js';
import { here } from './common.js';
import type { HandlerMap } from './types.js';

export const officeBuilderHandlers = {
  'floor.layout'(ctx, c, msg) {
    if (!ctx.meOf(c.accountId).admin) return ctx.warn(c, 'Only admins can change the office layout');
    const floor = here(ctx, c);
    if (!floor) return;
    const error = floor.plan.layout({ desks: msg.desks, furniture: msg.furniture, look: msg.look, room: msg.room }, msg.revision, (id) => floor.workers.deskOccupied(id));
    if (error) return ctx.warn(c, error);
    // Anyone sitting on something that's gone is on their feet, as far as the office knows.
    const plan = floor.plan.state();
    for (const o of ctx.clients.values()) {
      const seat = o.peer.seat?.replace(/:\d+$/, '');
      if (!seat || o.peer.floor !== c.peer.floor || floorSeat(layoutFurniture(plan), plan.wing, seat)) continue;
      delete o.peer.seat;
      ctx.broadcast({ t: 'peer.update', peer: o.peer });
    }
    ctx.toFloor(floor, { t: 'plan', plan });
    ctx.toastFloor(floor, `📐 ${c.peer.name} rearranged the office`);
  },
} satisfies HandlerMap<Extract<PlanClientMsg, { t: 'floor.layout' }>>;
