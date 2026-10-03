// The whisky cabinet on a floor (shared/whisky.ts): who has a dram in hand, a pour at the cabinet, a
// glass going back, and glasses clinking. Everyone on the floor sees each, and whoever arrives finds
// the glasses in people's hands. A pour each no faster than a pour takes, a toast each every few
// seconds, and the floor told of a toast only now and then (Toasts).
import type { Floor } from '../../floor.js';
import { pieceAway } from '../../../shared/furniture.js';
import type { WhiskyClientMsg } from '../../../shared/protocol.js';
import { CLINK, POUR_EVERY_MS, Toasts, canPour, clinkWith, isCabinet } from '../../../shared/whisky.js';
import type { Ctx } from '../../office/context.js';
import { throttle, type Client } from '../../office/client.js';
import { str } from '../../office/input.js';
import { here } from './common.js';
import type { FeatureHooks, HandlerMap, ViewPieces } from './types.js';

/** Who has a dram in hand. Only on the floor they poured it on: leaving it, it goes back on the tray. */
const holding = new WeakSet<Client>();
/** Which toasts each floor has been told of lately. */
const told = new WeakMap<Floor, Toasts>();

/** Everyone on `floor` with a dram, as the office has them. */
const holders = (ctx: Ctx, floor: Floor): Client[] => [...ctx.clients.values()].filter((c) => holding.has(c) && c.peer.floor === floor.id);

export const whiskyView: ViewPieces['whisky'] = (ctx, floor) => (floor ? holders(ctx, floor).map((c) => c.id) : []);

/** `c`'s glass goes back on the tray: `floor` (theirs, or the one they're leaving) is told. */
function putDown(ctx: Ctx, c: Client, floor: Floor | undefined) {
  if (!holding.delete(c) || !floor) return;
  ctx.toFloor(floor, { t: 'whisky.down', id: c.id });
}

export const whiskyHandlers = {
  'whisky.pour'(ctx, c, msg) {
    const floor = here(ctx, c);
    if (!floor) return;
    const { furniture } = floor.plan.layoutNow();
    const cabinet = furniture.find((p) => p.id === str(msg.piece, 40) && isCabinet(p));
    // A cabinet the floor has (not one put away while the back office is built out), and you in reach of it.
    if (!cabinet || pieceAway(cabinet, floor.plan.wing)) return ctx.warn(c, 'There is no whisky cabinet there');
    if (!canPour(cabinet, c.peer)) return ctx.warn(c, 'Walk up to the whisky cabinet first');
    // One pour at a time each: not again till the last is done.
    if (!throttle(c, 'whisky.pour', POUR_EVERY_MS)) return;
    const top = holding.has(c);
    holding.add(c);
    ctx.toFloor(floor, { t: 'whisky.poured', id: c.id, piece: cabinet.id, ...(top ? { top: true } : {}) });
  },
  'whisky.down'(ctx, c) {
    putDown(ctx, c, ctx.floorOf(c));
  },
  'whisky.cheers'(ctx, c) {
    const floor = ctx.floorOf(c);
    if (!floor || !holding.has(c)) return;
    // A little further than the page goes by: where each of them is reached the office a moment ago.
    const near = clinkWith(c.peer, holders(ctx, floor).map((o) => o.peer), CLINK.reach + 0.4);
    if (!near.length) return ctx.warn(c, 'Nobody with a glass is near enough to clink');
    if (!throttle(c, 'whisky.cheers', 2500)) return;
    const all = [c.peer, ...near];
    const ids = all.map((p) => p.id);
    let toasts = told.get(floor);
    if (!toasts) told.set(floor, (toasts = new Toasts()));
    const tell = toasts.tell(ids, Date.now());
    const { x, y, z } = c.peer;
    ctx.toFloor(floor, { t: 'whisky.cheers', ids, names: all.map((p) => p.name), x, y, z, ...(tell ? { told: true as const } : {}) });
  },
} satisfies HandlerMap<WhiskyClientMsg>;

export const whiskyHooks: FeatureHooks = {
  // The glass stays on its floor: whoever's left there sees it go back.
  leaving: (ctx, c, was) => putDown(ctx, c, was),
  closed: (ctx, c) => putDown(ctx, c, ctx.floorOf(c)),
};
