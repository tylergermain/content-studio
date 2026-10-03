// The scoreboard beside the hoop: the longest shots sunk, and games of PIG.
import type { Floor } from '../../floor.js';
import type { HoopClientMsg } from '../../../shared/protocol.js';
import { ordinal } from '../../../shared/longshots.js';
import type { Ctx } from '../../office/context.js';
import { throttle, type Client } from '../../office/client.js';
import { str } from '../../office/input.js';
import { creditedDistance, flyShot, floorSolids, hasHoop, isDrop } from '../../shot-judge.js';
import type { Shooter } from '../../longshots.js';
import type { PigWho } from '../../pig.js';
import type { FeatureHooks, HandlerMap, ViewPieces } from './types.js';

type Throw = { x: number; y: number; z: number; vx: number; vy: number; vz: number };

/** Whose shots and wins they are: an account, or a name on the shared password (as the arcade's high scores go by). */
export const ownerOf = (c: Client): string => (c.accountId ? `account:${c.accountId}` : `name:${c.peer.name}`);

/** `c` as a game of PIG knows them. Names come from the session, never from a message. */
export const pigWho = (c: Client): PigWho => ({ id: c.id, owner: ownerOf(c), name: c.peer.name, color: c.peer.color });

export const hoopView: ViewPieces['hoop'] = (ctx, floor) => ({ board: ctx.longShots.board(), pig: floor ? ctx.pig.game(floor.id) : null });

/** The floor `c` is on, if it has the hoop up; else they're told why not. */
function court(ctx: Ctx, c: Client): Floor | undefined {
  const floor = ctx.floorOf(c);
  if (floor && hasHoop(floor.plan.layoutNow().furniture)) return floor;
  ctx.warn(c, "🏀 There's no hoop on this floor");
  return undefined;
}

export const hoopHandlers = {
  'pig.invite'(ctx, c, msg) {
    if (!throttle(c, 'pig.invite', 1000)) return;
    const floor = court(ctx, c);
    if (!floor) return;
    const to = ctx.clients.get(str(msg.to, 64));
    if (!to || to === c || to.out || to.peer.lite || to.peer.floor !== floor.id) return ctx.warn(c, "🐷 They're not on the floor any more");
    const err = ctx.pig.invite(floor.id, pigWho(c), pigWho(to));
    if (err) return ctx.warn(c, err);
    // Asking someone who'd asked you starts the game; otherwise they've been asked.
    if (!ctx.pig.game(floor.id)?.players.some((p) => p.id === c.id)) ctx.sendTo(c, { t: 'toast', text: `🐷 Asked ${to.peer.name} to play PIG`, level: 'info' });
  },
  'pig.answer'(ctx, c, msg) {
    if (!throttle(c, 'pig.answer', 300)) return;
    const floor = court(ctx, c);
    if (floor) ctx.warn(c, ctx.pig.answer(floor.id, pigWho(c), str(msg.from, 64), msg.yes === true));
  },
  'pig.quit'(ctx, c) {
    ctx.pig.quit(c.id);
  },
} satisfies HandlerMap<HoopClientMsg>;

/**
 * Before the court takes a throw of `c`'s: whether the floor's game of PIG lets them throw it from
 * there (it's their turn; a follower is in the ring; it leaves their hands where they stand). They're
 * told why not.
 */
export function hoopMayThrow(ctx: Ctx, c: Client, floor: Floor, s: Throw): boolean {
  const drop = isDrop(s);
  let why = ctx.pig.mayThrow(floor.id, c.id, s, drop);
  const game = ctx.pig.game(floor.id);
  const playing = !!game && game.winner === null && game.players.some((p) => p.id === c.id);
  if (!why && !drop && playing && creditedDistance(c.peer, s) === null) why = '🐷 Shoot from where you stand';
  ctx.warn(c, why ?? undefined);
  return !why;
}

/** How often one person's throws are flown (ms): no shot follows another quicker, as the ball has to be picked up and wound up. */
export const FLY_EVERY = 400;

/**
 * The court took a throw of `c`'s: the office flies it (see shot-judge.ts). How it went is the game
 * of PIG's to know, and a make goes on the longest shots as it drops through the net.
 */
export function hoopThrown(ctx: Ctx, c: Client, floor: Floor, s: Throw) {
  const layout = floor.plan.layoutNow();
  if (!hasHoop(layout.furniture)) return;
  if (isDrop(s)) return ctx.pig.thrown(floor.id, c.id, s, null);
  // A shot in a game of PIG is always flown: the game's turns keep those far enough apart.
  const game = ctx.pig.game(floor.id);
  const playing = !!game && game.winner === null && game.players.some((p) => p.id === c.id);
  if (!playing && !throttle(c, 'hoop.fly', FLY_EVERY)) return;
  const flight = flyShot(s, floorSolids(layout, floor.plan.wing));
  ctx.pig.thrown(floor.id, c.id, s, flight);
  const dist = flight.made ? creditedDistance(c.peer, s) : null;
  if (dist === null) return;
  const who: Shooter = { owner: ownerOf(c), name: c.peer.name, color: c.peer.color };
  setTimeout(() => recordMake(ctx, c.id, floor.id, who, dist), flight.at * 1000).unref();
}

/**
 * `who` sank one from `dist` m on floor `floorId`, just now: on the table at once if it's their longest
 * yet. The building hears about it then, or (hard on the heels of their last) once it may: where it
 * stands on the table by then, if it's still on it.
 */
export function recordMake(ctx: Ctx, id: string, floorId: string, who: Shooter, dist: number) {
  if (!ctx.longShots.record(who, dist).rank) return;
  ctx.longShots.announce(who.owner, () => {
    const row = ctx.longShots.rowOf(who.owner);
    if (!row) return;
    const first = row.rank === 1;
    ctx.broadcast({ t: 'hoop.board', board: ctx.longShots.board(), latest: { name: who.name, dist: row.dist, rank: row.rank, first } });
    if (first) return ctx.toastFloor(ctx.floors.get(floorId), `🏀 ${who.name} sank one from ${row.dist.toFixed(1)} m — a new record!`);
    const c = ctx.clients.get(id);
    if (c) ctx.sendTo(c, { t: 'toast', text: `🏀 Your longest yet: ${row.dist.toFixed(1)} m, ${ordinal(row.rank)} on the board`, level: 'info' });
  });
}

export const hoopHooks: FeatureHooks = {
  // A game of theirs waits a little for them to come back (see PigGames.sweep); their invites go.
  closed: (ctx, c) => ctx.pig.gone(c.id),
};
