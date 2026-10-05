// A floor's own boards, kiosk agents and ticker (see shared/studio.ts), and what the office is signed in to for them.
import { EMPTY_STUDIO, isStudioBoard } from '../../../shared/studio.js';
import type { StudioClientMsg } from '../../../shared/protocol.js';
import { str } from '../../office/input.js';
import { here } from './common.js';
import type { HandlerMap, ViewPieces } from './types.js';

export const studioView: ViewPieces['studio'] = (_ctx, floor) => floor?.studio.state() ?? EMPTY_STUDIO;
export const tickerView: ViewPieces['ticker'] = (ctx, floor) => ctx.feeds.ticker(floor?.studio.symbols() ?? []);
export const watchView: ViewPieces['watch'] = (ctx, floor) => ctx.watch.state(floor?.studio.watching() ?? []);

export const studioHandlers = {
  'studio.setup'(ctx, c, msg) {
    if (!ctx.meOf(c.accountId).admin) return ctx.warn(c, 'Only admins can change what a floor\'s boards and agents are for');
    const floor = here(ctx, c);
    if (!floor) return;
    floor.studio.configure(msg.setup);
    ctx.toFloor(floor, { t: 'studio', studio: floor.studio.state() });
    ctx.toFloor(floor, { t: 'ticker', ticker: ctx.feeds.ticker(floor.studio.symbols()) });
    ctx.feeds.refreshTicker();
    // The channels it watches: what's known of them goes out now, and the new ones are read.
    ctx.toFloor(floor, { t: 'watch', watch: ctx.watch.state(floor.studio.watching()) });
    ctx.watch.refresh();
    ctx.toastFloor(floor, `🪧 ${c.peer.name} set up this floor's boards and agents`);
  },
  'studio.post'(ctx, c, msg) {
    const floor = here(ctx, c);
    if (!floor) return;
    const r = floor.studio.post(msg, c.peer.name);
    if (typeof r === 'string') return ctx.warn(c, r);
    ctx.toFloor(floor, { t: 'studio', studio: floor.studio.state() });
  },
  'studio.unpost'(ctx, c, msg) {
    const floor = here(ctx, c);
    if (!floor) return;
    const r = floor.studio.remove(str(msg.id, 40));
    if (typeof r === 'string') return ctx.warn(c, r);
    ctx.toFloor(floor, { t: 'studio', studio: floor.studio.state() });
  },
  'studio.seen'(ctx, c, msg) {
    const floor = here(ctx, c);
    if (floor && isStudioBoard(msg.board) && floor.studio.look(msg.board)) ctx.toFloor(floor, { t: 'studio', studio: floor.studio.state() });
  },
  'integrations.signIn'(ctx, c, msg) {
    // The office's own sign-ins to other services: admins only.
    if (!ctx.meOf(c.accountId).admin) return ctx.warn(c, 'Only admins can sign the office in to Slack or Metricool');
    ctx.feeds.signIn({ ...(msg.slack !== undefined ? { slack: msg.slack } : {}), ...(msg.metricool !== undefined ? { metricool: msg.metricool } : {}) });
  },
  'integrations.channels'(ctx, c) {
    if (!ctx.meOf(c.accountId).admin) return ctx.sendTo(c, { t: 'integrations.channels', channels: [], error: 'Only admins can pick the channels a board watches' });
    void ctx.feeds.slackChannels().then((r) => ctx.sendTo(c, typeof r === 'string' ? { t: 'integrations.channels', channels: [], error: r } : { t: 'integrations.channels', channels: r }));
  },
} satisfies HandlerMap<StudioClientMsg>;
