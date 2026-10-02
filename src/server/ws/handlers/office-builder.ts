import type { PlanClientMsg } from '../../../shared/protocol.js';
import type { HandlerMap } from './types.js';
import { here } from './common.js';
export const officeBuilderHandlers = {
  'floor.layout'(ctx, c, msg) {
    if (!ctx.meOf(c.accountId).admin) return ctx.warn(c, 'Only admins can change the office layout');
    const floor = here(ctx,c);
    if (!floor) return;
    const error = floor.plan.layout(msg.desks, msg.revision, id => floor.workers.deskOccupied(id));
    if (error) return ctx.warn(c,error);
    ctx.toFloor(floor,{t:'plan',plan:floor.plan.state()});
    ctx.toastFloor(floor, `${c.peer.name} saved the office layout`);
  }
} satisfies HandlerMap<Extract<PlanClientMsg, {t:'floor.layout'}>>;
