// Friday One (see protocol/heli.ts and server/heli/): getting in and out, and the pilot's page saying
// where it is. Everyone, on every floor and up on the roof, sees it.
import type { HeliClientMsg } from '../../../shared/protocol.js';
import { heliIfAny, heliOf } from '../../heli/index.js';
import type { FeatureHooks, HandlerMap, ViewPieces } from './types.js';

export const heliView: ViewPieces['heli'] = (ctx) => heliOf(ctx).state();

export const heliHandlers = {
  'heli.board'(ctx, c, msg) {
    heliOf(ctx).board(c, msg.seat);
  },
  'heli.leave'(ctx, c) {
    heliOf(ctx).leave(c);
  },
  'heli.fly'(ctx, c, msg) {
    heliOf(ctx).fly(c, msg.pose, msg.landed);
  },
} satisfies HandlerMap<HeliClientMsg>;

/**
 * Whoever leaves their floor, or the office, gets out if it's down; a pilot leaving mid-flight sends
 * it flying itself home, and a passenger is put off. Nobody's aboard one that hasn't been made yet.
 */
export const heliHooks: FeatureHooks = {
  leaving(ctx, c) {
    heliIfAny(ctx)?.gone(c);
  },
  closed(ctx, c) {
    heliIfAny(ctx)?.gone(c);
  },
};
