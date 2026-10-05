// The rounds on Putt Street, refereed by the office. A group of up to four forms at the putter rack for
// PUTT_RULES.formS seconds (or until its starter tees off), then plays the nine holes in turn: each
// player putts until their ball drops, or they've taken PUTT_RULES.strokes (which scores
// PUTT_RULES.picked), then the next, and after everyone the next hole. The office rolls every putt
// (shared/minigolf/physics.ts) and tells everyone the path, timed on its own clock; the turn moves on
// once the ball has stopped. A turn left PUTT_RULES.idleS seconds is picked up, with a warning first;
// a group waits to start a hole while an earlier group still has balls on it; water or the felt's
// edge costs a stroke, and the ball goes back where it was putted from. Names and colours are the
// session's, never a message's.
import { HOLES } from '../../shared/minigolf/course.js';
import { roll, teeBall } from '../../shared/minigolf/physics.js';
import type { Hole } from '../../shared/minigolf/types.js';
import { PUTT_RULES, type PuttPlayer, type PuttRound, type PuttServerMsg } from '../../shared/protocol.js';
import type { StreetPoint } from '../../shared/mainstreet.js';
import type { PuttRecords } from './records.js';

/** Someone at Putt Street, as the session knows them. */
export interface PuttWho {
  id: string;
  name: string;
  color: string;
}

/** What the rounds need from the office round them. */
export interface PuttDeps {
  now(): number;
  /** Runs `fn` in `ms`; what it hands back calls it off. */
  later(ms: number, fn: () => void): () => void;
  /** To everyone, on every floor. */
  broadcast(msg: PuttServerMsg): void;
  /** A toast to one person. */
  tell(id: string, text: string): void;
  /** A toast to everyone. */
  toastAll(text: string): void;
  /** Where `id` is out on the street, whichever floor they're on; null when they're not down there. */
  where(id: string): StreetPoint | null;
  records: PuttRecords;
  /** The nine holes played (the course's own, unless a test brings some). */
  holes?: readonly Hole[];
}

/** How near your ball you have to be to putt it (m, across the ground), and how far above or below it. */
export const REACH = { across: 3, up: 2 } as const;
/** How long a finished round stays up (ms), its card on show, before it goes. */
export const OVER_FOR = 60_000;
/** A stroke whose `at` makes no sense is struck this long after the office hears it (ms). */
export const DEFAULT_LEAD = 90;

/** A round, and what the office keeps about it that nobody else needs to see. */
interface Game {
  round: PuttRound;
  /** Which round this is of all of them, so an earlier group plays through first. */
  order: number;
  /** The turn's warning and pick-up, the roll coming to rest, forming's end, or the finished round going. */
  timers: (() => void)[];
  /** The putt that's rolling: whose, and how it ends up. */
  pending: { id: string; taken: number; holed: boolean; rest: PuttRound['players'][number]['ball'] } | null;
}

export class PuttRounds {
  private games: Game[] = [];
  private made = 0;
  /** When each player last putted (ms), for PUTT_RULES.everyMs between putts. */
  private struck = new Map<string, number>();

  private readonly holes: readonly Hole[];

  constructor(private deps: PuttDeps) {
    this.holes = deps.holes ?? HOLES;
  }

  /** The rounds going on, as everyone sees them. */
  rounds(): PuttRound[] {
    return this.games.map((g) => g.round);
  }

  /** The round `id` is in that isn't over yet, if any. */
  private gameOf(id: string): Game | undefined {
    return this.games.find((g) => g.round.stage !== 'over' && g.round.players.some((p) => p.id === id));
  }

  /** At the putter rack: into a group that's still forming, or a new one with `who` as its starter. Says why not, if it can't. */
  play(who: PuttWho): string | undefined {
    if (this.gameOf(who.id)) return "⛳ You're already in a round: finish it, or leave it from the scorecard";
    // A round of theirs that's over (its card still up) lets them go, so they're only ever in one.
    for (const g of this.games.filter((g) => g.round.stage === 'over')) {
      const i = g.round.players.findIndex((p) => p.id === who.id);
      if (i >= 0) this.leave(g, i);
    }
    const now = this.deps.now();
    const player = (): PuttPlayer => ({ id: who.id, name: who.name, color: who.color, strokes: Array.from({ length: PUTT_RULES.holes }, () => null), ball: null, taken: 0 });
    const open = this.games.find((g) => g.round.stage === 'forming' && g.round.players.length < PUTT_RULES.players);
    if (open) {
      open.round.players.push(player());
      return this.changed();
    }
    const round: PuttRound = { id: `putt-${++this.made}`, stage: 'forming', hole: 0, turn: 0, players: [player()], starter: who.id, since: now, until: now + PUTT_RULES.formS * 1000 };
    const game: Game = { round, order: this.made, timers: [], pending: null };
    this.games.push(game);
    game.timers.push(this.deps.later(PUTT_RULES.formS * 1000, () => this.begin(game)));
    this.changed();
  }

  /** The starter tees off now, without waiting for anyone else. */
  start(id: string, roundId: string): string | undefined {
    const game = this.games.find((g) => g.round.id === roundId);
    if (!game || game.round.stage !== 'forming') return undefined;
    if (game.round.starter !== id) return '⛳ Only whoever started the round can tee off early';
    this.begin(game);
  }

  /**
   * `who` putts in round `roundId`: `yaw` and `power` as they swung, struck at `at` on the office's
   * clock (as their page has it). Only on their turn, with nothing rolling, from beside their ball;
   * anything else is ignored (undefined) or refused (why). The office rolls it, tells everyone, and
   * moves the round on when the ball's stopped.
   */
  stroke(who: PuttWho, roundId: string, yaw: number, power: number, at: number): string | undefined {
    const game = this.games.find((g) => g.round.id === roundId);
    if (!game) return undefined;
    const round = game.round;
    // The starter's first putt tees the group off, if it's still forming.
    if (round.stage === 'forming' && round.starter === who.id) this.begin(game);
    const now = this.deps.now();
    if (round.stage !== 'playing' || round.waiting || game.pending || (round.rolling ?? 0) > now) return undefined;
    const player = round.players[round.turn];
    if (!player || player.id !== who.id || !player.ball) return undefined;
    if (!Number.isFinite(yaw) || !Number.isFinite(power)) return undefined;
    const spot = this.deps.where(who.id);
    if (!spot || Math.hypot(spot.x - player.ball.x, spot.z - player.ball.z) > REACH.across || Math.abs(spot.h - player.ball.y) > REACH.up) return '⛳ Walk up to your ball first';
    if (now - (this.struck.get(who.id) ?? -Infinity) < PUTT_RULES.everyMs) return undefined;
    this.struck.set(who.id, now);
    const startAt = strikeAt(at, now);
    const hole = this.holes[round.hole];
    const swing = { yaw: wrap(yaw), power: Math.min(1, Math.max(0, power)) };
    const rolled = roll(hole, { from: player.ball, yaw: swing.yaw, power: swing.power, startAt });
    const taken = player.taken + 1 + (rolled.out ? 1 : 0);
    this.deps.broadcast({ t: 'putt.rolled', round: round.id, id: who.id, hole: round.hole, path: rolled.path, events: rolled.events, startAt, power: swing.power, rest: rolled.rest, holed: rolled.holed, out: rolled.out, ...(rolled.moved ? { moved: true } : {}), taken });
    // Its turn's clock stops while the ball rolls; the round moves on once it's stopped.
    this.clearTimers(game);
    const rests = startAt + ((rolled.path.length / 3 - 1) * 1000) / PUTT_RULES.samples;
    round.rolling = rests;
    game.pending = { id: who.id, taken, holed: rolled.holed, rest: rolled.holed ? null : rolled.rest };
    game.timers.push(this.deps.later(Math.max(0, rests - now), () => this.settle(game)));
    this.changed();
  }

  /** `id` leaves round `roundId` (their card goes); every round they're in, without one. */
  quit(id: string, roundId?: string) {
    let any = false;
    for (const game of [...this.games]) {
      if (roundId !== undefined && game.round.id !== roundId) continue;
      const i = game.round.players.findIndex((p) => p.id === id);
      if (i < 0) continue;
      any = true;
      this.leave(game, i);
    }
    if (any) this.changed();
  }

  // ---- The round going on ---------------------------------------------------------------------

  /** Forming's over: off to the first hole. */
  private begin(game: Game) {
    const round = game.round;
    if (round.stage !== 'forming') return;
    this.clearTimers(game);
    round.stage = 'playing';
    round.hole = 0;
    this.startHole(game);
    this.changed();
  }

  /** The group starts its hole, or waits while an earlier group still has balls on it. */
  private startHole(game: Game) {
    const round = game.round;
    round.turn = 0;
    for (const p of round.players) {
      p.ball = null;
      p.taken = 0;
    }
    if (this.blocked(game)) {
      round.waiting = true;
      round.since = this.deps.now();
      round.until = 0;
      return;
    }
    delete round.waiting;
    this.startTurn(game);
  }

  /** Whether an earlier group is still playing the hole this one wants to start. */
  private blocked(game: Game): boolean {
    return this.games.some((g) => g.order < game.order && g.round.stage === 'playing' && !g.round.waiting && g.round.hole === game.round.hole);
  }

  /** Whoever's turn it is putts from their ball (on the tee, if it's their first there), with the clock running. */
  private startTurn(game: Game) {
    const round = game.round;
    const player = round.players[round.turn];
    if (!player) return;
    player.ball ??= teeBall(this.holes[round.hole]);
    const now = this.deps.now();
    round.since = now;
    round.until = now + PUTT_RULES.idleS * 1000;
    this.clearTimers(game);
    const hole = round.hole + 1;
    game.timers.push(this.deps.later(PUTT_RULES.warnS * 1000, () => this.deps.tell(player.id, `⛳ Your turn on hole ${hole}: putt in the next ${PUTT_RULES.idleS - PUTT_RULES.warnS} s`)));
    game.timers.push(this.deps.later(PUTT_RULES.idleS * 1000, () => this.pickUp(game, player.id)));
  }

  /** A turn left too long: picked up, at PUTT_RULES.picked. */
  private pickUp(game: Game, id: string) {
    const round = game.round;
    const player = round.players[round.turn];
    if (round.stage !== 'playing' || !player || player.id !== id || game.pending) return;
    player.strokes[round.hole] = PUTT_RULES.picked;
    player.taken = PUTT_RULES.picked;
    player.ball = null;
    this.nextTurn(game);
    this.changed();
  }

  /** The ball's stopped: where it lies now, holed out, picked up at the most strokes, or to putt again. */
  private settle(game: Game) {
    const round = game.round;
    const done = game.pending;
    game.pending = null;
    delete round.rolling;
    const player = round.players[round.turn];
    if (!done || !player || player.id !== done.id) return this.changed();
    player.taken = done.taken;
    if (done.holed) {
      player.strokes[round.hole] = Math.min(done.taken, PUTT_RULES.picked);
      player.ball = null;
      this.holedOut(player.name, round.hole, done.taken);
      this.nextTurn(game);
    } else if (done.taken >= PUTT_RULES.strokes) {
      player.strokes[round.hole] = PUTT_RULES.picked;
      player.ball = null;
      this.nextTurn(game);
    } else {
      player.ball = done.rest;
      this.startTurn(game);
    }
    this.changed();
  }

  /** The next player still to finish this hole has a go; with nobody left, on to the next hole. */
  private nextTurn(game: Game) {
    const round = game.round;
    const next = round.players.findIndex((p, i) => i > round.turn && p.strokes[round.hole] === null);
    const first = next >= 0 ? next : round.players.findIndex((p) => p.strokes[round.hole] === null);
    if (first >= 0) {
      round.turn = first;
      return this.startTurn(game);
    }
    this.clearTimers(game);
    if (round.hole >= PUTT_RULES.holes - 1) return this.finish(game);
    round.hole++;
    this.startHole(game);
    this.letThrough();
  }

  /** Groups that were waiting for a hole an earlier group has now left go on, earliest first. */
  private letThrough() {
    for (const g of this.games) {
      if (!g.round.waiting || this.blocked(g)) continue;
      delete g.round.waiting;
      this.startTurn(g);
    }
  }

  /** All nine done: the card goes on the records, and the round goes a while later. */
  private finish(game: Game) {
    const round = game.round;
    this.clearTimers(game);
    round.stage = 'over';
    const now = this.deps.now();
    round.since = now;
    round.until = now + OVER_FOR;
    for (const p of round.players) p.ball = null;
    const cards = round.players.map((p) => ({ name: p.name, total: p.strokes.reduce<number>((s, v) => s + (v ?? PUTT_RULES.picked), 0) }));
    const news = this.deps.records.roundOver(cards);
    if (news.record) {
      this.deps.broadcast({ t: 'putt.board', board: this.deps.records.board(), latest: { name: news.record.name, what: 'record', total: news.record.total } });
      this.deps.toastAll(`⛳ ${news.record.name} set the Putt Street record: ${news.record.total}`);
    } else if (news.kept) this.deps.broadcast({ t: 'putt.board', board: this.deps.records.board() });
    game.timers.push(this.deps.later(OVER_FOR, () => this.drop(game)));
    this.letThrough();
  }

  private drop(game: Game) {
    this.clearTimers(game);
    this.games = this.games.filter((g) => g !== game);
    this.letThrough();
    this.changed();
  }

  /** A hole done in `strokes`: the best there yet, or a hole in one, goes on the records and the building hears. */
  private holedOut(name: string, hole: number, strokes: number) {
    const { best, ace } = this.deps.records.holedOut(name, hole, strokes);
    if (!best && !ace) return;
    this.deps.broadcast({ t: 'putt.board', board: this.deps.records.board(), latest: { name, what: ace ? 'ace' : 'best', hole } });
    if (ace) this.deps.toastAll(`⛳ Hole in one! ${name} aced hole ${hole + 1}`);
  }

  /** Player `i` leaves `game`: the turn passes on if it was theirs, and an empty round goes. */
  private leave(game: Game, i: number) {
    const round = game.round;
    const [gone] = round.players.splice(i, 1);
    this.struck.delete(gone.id);
    if (!round.players.length) {
      this.clearTimers(game);
      this.games = this.games.filter((g) => g !== game);
      return this.letThrough();
    }
    if (round.starter === gone.id) round.starter = round.players[0].id;
    if (round.stage !== 'playing') return;
    if (i < round.turn) return void round.turn--;
    if (i > round.turn) return;
    // It was their turn: whatever they had rolling is theirs no more, and the next player's up.
    if (game.pending?.id === gone.id) {
      game.pending = null;
      delete round.rolling;
    }
    round.turn = i - 1;
    if (round.waiting) return void (round.turn = 0);
    this.nextTurn(game);
  }

  private clearTimers(game: Game) {
    for (const off of game.timers) off();
    game.timers = [];
  }

  private changed(): undefined {
    this.deps.broadcast({ t: 'putt', rounds: this.rounds() });
    return undefined;
  }
}

/** A heading in ±π. */
export function wrap(yaw: number): number {
  const turn = Math.PI * 2;
  const w = (((yaw + Math.PI) % turn) + turn) % turn - Math.PI;
  return w;
}

/**
 * When a putt sent at `at` (the office's clock, as the page has it) is struck: no sooner than
 * PUTT_RULES.minLeadMs from `now` and no later than PUTT_RULES.leadMs, so nobody can pick the moment
 * the windmill's sails are out of the way, or hold up their group; DEFAULT_LEAD when `at` makes no sense.
 */
export function strikeAt(at: number, now: number): number {
  if (!Number.isFinite(at)) return now + DEFAULT_LEAD;
  return Math.min(now + PUTT_RULES.leadMs, Math.max(now + PUTT_RULES.minLeadMs, at));
}
