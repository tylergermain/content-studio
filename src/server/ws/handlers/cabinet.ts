// The arcade on every floor: who's at the cabinet, the game on its screen, the games on the boss's monitor, and the high scores.
import type { Floor } from '../../floor.js';
import { checkFrame, checkTitle, type CabinetState, type GameFrame, type GameTitle } from '../../../shared/cabinet.js';
import type { CabinetClientMsg } from '../../../shared/protocol.js';
import type { Ctx } from '../../office/context.js';
import { throttle, type Client } from '../../office/client.js';
import { here } from './common.js';
import type { FeatureHooks, HandlerMap, ViewPieces } from './types.js';

/**
 * At the arcade cabinet on their floor (`playing`) or at a game on the boss's monitor (`away`),
 * on `game` (see Arcade), which is a game of `title`; `frame` is it as it looks now.
 */
interface Player {
  playing: boolean;
  away: boolean;
  game?: string;
  title: GameTitle;
  frame?: GameFrame;
}
const players = new WeakMap<Client, Player>();
const player = (c: Client): Player => {
  let p = players.get(c);
  if (!p) players.set(c, (p = { playing: false, away: false, title: 'blockfall' }));
  return p;
};

/** Who's playing the arcade cabinet on a floor. */
export const cabinetPlayer = (ctx: Ctx, floor: Floor): Client | undefined => [...ctx.clients.values()].find((c) => player(c).playing && c.peer.floor === floor.id);
export const cabinetState = (ctx: Ctx, floor: Floor | undefined): CabinetState => {
  const p = floor && cabinetPlayer(ctx, floor);
  return { player: p ? { id: p.id, name: p.peer.name, game: player(p).game ?? '', title: player(p).title } : null, scores: ctx.highScores.top() };
};
/** Who's at the cabinet, the high scores, and the game on its screen as its player last sent it. */
export const cabinetView: ViewPieces['cabinet'] = (ctx, floor) => {
  const state = cabinetState(ctx, floor);
  const p = floor && cabinetPlayer(ctx, floor);
  return { ...state, frame: (p && player(p).frame) ?? null };
};
export const cabinetChanged = (ctx: Ctx, floor: Floor | undefined) => {
  if (floor) ctx.toFloor(floor, { t: 'cabinet', state: cabinetState(ctx, floor) });
};
/** `c` stepped away from their game (or left the floor, or the office): it waits, with its score so far on the table. */
export const stopPlaying = (ctx: Ctx, c: Client, floor = ctx.floorOf(c)) => {
  const p = player(c);
  if (!p.playing && !p.away) return;
  if (floor) ctx.arcade.leave(p.game, floor.id);
  const cabinet = p.playing;
  p.playing = p.away = false;
  p.game = undefined;
  p.frame = undefined;
  if (cabinet) cabinetChanged(ctx, floor);
};

export const cabinetHandlers = {
  'cabinet.play'(ctx, c, msg) {
    const who = c.peer.name;
    const floor = here(ctx, c);
    const p = player(c);
    // Only a game the office knows.
    const title = checkTitle(msg.title);
    const away = msg.away === true;
    if (!floor || !title) return;
    const on = p.playing || p.away;
    // Where they are already, on the game they are on already: the office says so again.
    if (on && p.away === away && msg.game === p.game) return ctx.sendTo(c, { t: 'cabinet.game', game: p.game ?? '', title: p.title });
    const at = cabinetPlayer(ctx, floor);
    if (!away && at && at !== c) {
      ctx.warn(c, `${at.peer.name} is on the arcade — press E there to watch`);
      ctx.sendTo(c, { t: 'cabinet', state: cabinetState(ctx, floor) });
      return;
    }
    // Already at one: that game's over (or put down), and this is the next.
    if (on) ctx.arcade.leave(p.game, floor.id);
    p.game = ctx.arcade.start({ owner: c.accountId ? `account:${c.accountId}` : `name:${who}`, name: who, color: c.peer.color, connection: c.id }, msg.game, title);
    if (p.game !== msg.game && !ctx.arcade.counts(p.game)) ctx.warn(c, "🕹️ That's a lot of new games in a row, so this one won't go on the high-score table");
    const cabinet = p.playing || !away;
    p.playing = !away;
    p.away = away;
    p.title = title;
    p.frame = undefined;
    ctx.sendTo(c, { t: 'cabinet.game', game: p.game, title });
    if (cabinet) cabinetChanged(ctx, floor);
  },
  'cabinet.leave'(ctx, c) {
    stopPlaying(ctx, c);
  },
  'cabinet.frame'(ctx, c, msg) {
    const floor = ctx.floorOf(c);
    const p = player(c);
    if (!p.playing && !p.away) {
      // A game the office isn't following (it dropped the connection it was on): its browser asks again.
      if (throttle(c, 'cabinet.game', 1000)) ctx.sendTo(c, { t: 'cabinet.game', game: '', title: p.title });
      return;
    }
    const frame = checkFrame(msg.frame, p.title);
    if (!floor || !frame) return;
    // Every frame counts towards the score, even one that comes too soon after the last to pass on.
    if (ctx.arcade.frame(p.game, frame, floor.id) === 'void') ctx.warn(c, "🕹️ The office couldn't follow this game, so its score won't go on the high-score table");
    p.frame = frame;
    // The boss's monitor is the boss's own: only the cabinet's screen is everyone's.
    if (p.away || !throttle(c, 'cabinet.frame', 40)) return;
    ctx.toNeighbors(c, { t: 'cabinet.frame', frame }, true);
  },
} satisfies HandlerMap<CabinetClientMsg>;

export const cabinetHooks: FeatureHooks = {
  // The arcade downstairs stays downstairs.
  leaving: (ctx, c, was) => stopPlaying(ctx, c, was),
  closed: (ctx, c) => stopPlaying(ctx, c),
};
