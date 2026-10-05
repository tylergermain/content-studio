// Main Street's plots (see protocol/street.ts and server/street/): street admins claim a plot for a
// business, change what stands on it, and give it back; everyone, on every floor, sees it change.
// Who's a street admin is asked of the accounts as they are at each request, never remembered. Walls
// only go up where nobody and nothing stands (street/clear.ts), and each admin changes the street at
// most once every WRITE_EVERY_MS, so a stuck key can't hammer street.json.
import { PLOTS, isClaimable, type Claimable } from '../../../shared/mainstreet.js';
import type { BusinessDef, PlotLook, StreetClientMsg } from '../../../shared/protocol.js';
import { isStreetAdmin } from '../../street/admins.js';
import { inTheWay, wallsOf, whyNotClear } from '../../street/clear.js';
import { lookFrom } from '../../street/look.js';
import { changedHands, streetOf } from '../../street/registry.js';
import type { Ctx } from '../../office/context.js';
import { throttle, type Client } from '../../office/client.js';
import { str } from '../../office/input.js';
import type { HandlerMap, ViewPieces } from './types.js';

export const streetView: ViewPieces['street'] = (ctx) => streetOf(ctx).view();

/** At most one change to the street every this many ms from each admin. */
export const WRITE_EVERY_MS = 300;

const ADMINS_ONLY = '🏙 Only street admins can claim, change or release a plot';
const NOT_FOR_LEASE = "🏙 That plot isn't one a business can have";

/** Tells everyone, on every floor and up on the roof, what Main Street is now. */
const changed = (ctx: Ctx) => ctx.broadcast({ t: 'street', street: streetOf(ctx).view() });

/** Who claimed it, as the street remembers them: their account's name, or the name they gave on the shared password. */
const claimer = (ctx: Ctx, c: Client) => ctx.meOf(c.accountId).account?.name ?? c.peer.name;

/**
 * Whether `c` may change `plot`: a street admin, asking about a plot a business can have. Says why not
 * to `c`, and gives back nothing, when they may not.
 */
function plotFor(ctx: Ctx, c: Client, plot: unknown): Claimable | undefined {
  if (!isStreetAdmin(ctx, c)) return void ctx.warn(c, ADMINS_ONLY);
  if (!isClaimable(plot)) return void ctx.warn(c, NOT_FOR_LEASE);
  return plot;
}

/**
 * The business on `plot` that an edit or a release is about: the one there now, if the window was
 * showing it (`id`; a window that doesn't say is taken at its word). Says why not to `c` otherwise.
 */
function businessFor(ctx: Ctx, c: Client, plot: Claimable, id: unknown, none: string): BusinessDef | undefined {
  const was = streetOf(ctx).onPlot(plot);
  if (!was) return void ctx.warn(c, none);
  if (id !== undefined && str(id, 64) !== was.id) return void ctx.warn(c, changedHands(plot));
  return was;
}

export const streetHandlers = {
  'street.claim'(ctx, c, msg) {
    const plot = plotFor(ctx, c, msg.plot);
    if (!plot) return;
    const street = streetOf(ctx);
    const was = street.onPlot(plot);
    if (was) return ctx.warn(c, `🏙 ${PLOTS[plot].name} is ${was.name}'s already`);
    const r = lookFrom(msg, true);
    if ('error' in r) return ctx.warn(c, r.error);
    const look = r.look as PlotLook;
    const blocked = whyNotClear(plot, wallsOf(plot, look.stage, look.planned), inTheWay(ctx));
    if (blocked) return ctx.warn(c, blocked);
    if (!throttle(c, 'street', WRITE_EVERY_MS)) return;
    const done = street.claim(plot, look, claimer(ctx, c));
    if ('error' in done) return ctx.warn(c, done.error);
    changed(ctx);
    ctx.toastAll(`${look.stage === 'site' ? '🏗️' : '🏢'} ${done.def.name} is coming to ${PLOTS[plot].name} on Main Street`);
  },
  'street.edit'(ctx, c, msg) {
    const plot = plotFor(ctx, c, msg.plot);
    if (!plot) return;
    const was = businessFor(ctx, c, plot, msg.id, `🏙 ${PLOTS[plot].name} is for lease: claim it first`);
    if (!was) return;
    const r = lookFrom(msg, false);
    if ('error' in r) return ctx.warn(c, r.error);
    const next: BusinessDef = { ...was, ...r.look };
    // Walls move when a site becomes a shell (or back), or a shell grows or shrinks: look before they do.
    if (next.stage !== was.stage || (next.stage === 'shell' && next.planned !== was.planned)) {
      const blocked = whyNotClear(plot, wallsOf(plot, next.stage, next.planned), inTheWay(ctx));
      if (blocked) return ctx.warn(c, blocked);
    }
    if (JSON.stringify(next) === JSON.stringify(was) || !throttle(c, 'street', WRITE_EVERY_MS)) return;
    const done = streetOf(ctx).edit(plot, r.look, was.id);
    if ('error' in done) return ctx.warn(c, done.error);
    changed(ctx);
  },
  'street.release'(ctx, c, msg) {
    const plot = plotFor(ctx, c, msg.plot);
    if (!plot) return;
    const was = businessFor(ctx, c, plot, msg.id, `🏙 ${PLOTS[plot].name} is for lease already`);
    if (!was || !throttle(c, 'street', WRITE_EVERY_MS)) return;
    const done = streetOf(ctx).release(plot, was.id);
    if ('error' in done) return ctx.warn(c, done.error);
    changed(ctx);
    ctx.toastAll(`🪧 ${was.name} has left ${PLOTS[plot].name}: it's for lease again on Main Street`);
  },
} satisfies HandlerMap<StreetClientMsg>;
