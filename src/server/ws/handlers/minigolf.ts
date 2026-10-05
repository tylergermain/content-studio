// Putt Street (see protocol/minigolf.ts and server/minigolf/): joining a group at the putter rack,
// teeing off, putting (the office rolls it and sends everyone the ball's path) and leaving a round.
// The rounds are the building's: everyone, on every floor, sees them. Who's playing is the session's
// say (its name and colour), never a message's.
import type { PuttClientMsg } from '../../../shared/protocol.js';
import { throttle, type Client } from '../../office/client.js';
import { str } from '../../office/input.js';
import { puttOf } from '../../minigolf/index.js';
import type { PuttWho } from '../../minigolf/rounds.js';
import { streetSpot } from '../../street/people.js';
import type { FeatureHooks, HandlerMap, ViewPieces } from './types.js';

export const puttView: ViewPieces['putt'] = (ctx) => puttOf(ctx).view();

/** `c` as Putt Street knows them. */
const whoIs = (c: Client): PuttWho => ({ id: c.id, name: c.peer.name, color: c.peer.color });
/** A number from a message, or NaN when it isn't one (which the rounds turn away). */
const numOf = (v: unknown) => (typeof v === 'number' ? v : NaN);

export const puttHandlers = {
  'putt.play'(ctx, c) {
    if (!throttle(c, 'putt.play', 500)) return;
    if (!streetSpot(ctx, c)) return ctx.warn(c, '⛳ Come down to Putt Street to play');
    ctx.warn(c, puttOf(ctx).play(whoIs(c)));
  },
  'putt.start'(ctx, c, msg) {
    if (!throttle(c, 'putt.start', 300)) return;
    ctx.warn(c, puttOf(ctx).start(c.id, str(msg.round, 32)));
  },
  'putt.stroke'(ctx, c, msg) {
    ctx.warn(c, puttOf(ctx).stroke(whoIs(c), str(msg.round, 32), numOf(msg.yaw), numOf(msg.power), numOf(msg.at)));
  },
  'putt.quit'(ctx, c, msg) {
    puttOf(ctx).quit(c.id, str(msg.round, 32));
  },
} satisfies HandlerMap<PuttClientMsg>;

/** Leaving the office takes you out of your rounds; going to another floor doesn't (every floor has the street under it). */
export const puttHooks: FeatureHooks = {
  closed: (ctx, c) => puttOf(ctx).quit(c.id),
};
