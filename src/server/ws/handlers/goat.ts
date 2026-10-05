// Marc, the building's goat: on whichever floor he lives on.
import type { GoatClientMsg } from '../../../shared/protocol.js';
import type { HandlerMap, ViewPieces } from './types.js';

export const goatView: ViewPieces['goat'] = (_ctx, floor) => floor?.goat.view() ?? null;

export const goatHandlers = {
  'goat.pet'(ctx, c) {
    // He follows an admin into the elevator, to live where they got out: which floor has him is the building's, for everyone.
    ctx.floorOf(c)?.goat.pet(c.peer, ctx.meOf(c.accountId).admin);
  },
} satisfies HandlerMap<GoatClientMsg>;
