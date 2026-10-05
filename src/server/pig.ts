import { COURT_REACH, feetOf, forfeit, newGame, shotRefused, shotResult, shotTaken, type PigState } from '../shared/pig.js';
import { FARTHEST, rimDistance } from '../shared/longshots.js';
import type { Flight } from './shot-judge.js';
import type { Shooter } from './longshots.js';

/** Someone in a game of PIG (or asked to play one): their connection now, and who they are. */
export interface PigWho extends Shooter {
  id: string;
}

/** Where someone is: their floor (none: the roof, the lobby) and where they stand on it. */
export interface Whereabouts {
  floor: string | undefined;
  x: number;
  y: number;
  z: number;
}

/** What the games need from the office around them. */
export interface PigDeps {
  /** Where `id` is now; undefined once they've left the office (their connection closed). */
  where(id: string): Whereabouts | undefined;
  /** Whoever going by `owner` is on `floor` now: someone back on a new connection after theirs dropped. */
  findOwner(floor: string, owner: string): string | undefined;
  /** The floor's game changed (null: there's none any more). */
  changed(floor: string, pig: PigState | null): void;
  /**
   * The floor's ball is only `reserved`'s to pick up ('' nobody's, undefined anyone's again), and in
   * `holder`'s hands when that's given.
   */
  ball(floor: string, reserved: string | undefined, holder?: string): void;
  /** To everyone on the floor. */
  toast(floor: string, text: string): void;
  /** To `id` alone: they're asked to play (`from`), or told how it went. */
  tell(id: string, msg: { invitedBy: PigWho; until: number } | { text: string }): void;
  /** `winner` won a game of PIG (for the table). */
  won(winner: Shooter): void;
  /** Whether `floor` still has its hoop up (the office builder can take it down, mid-game too). */
  hasHoop(floor: string): boolean;
  /** Runs `fn` in `ms`; what it hands back calls it off. */
  later(ms: number, fn: () => void): () => void;
  now(): number;
}

/**
 * Further off than this (m) a player is away from the court: nowhere on the floor's own level, as
 * there's a long shot at the hoop (a heave, way out) from nearly anywhere on it (see
 * shared/hoop-range.ts). Up in the loft is away all the same (see atCourt).
 */
export const AWAY_REACH = FARTHEST;
/** How long a player can be away (off the court, off the floor, or out of the office) before they forfeit (ms). */
export const AWAY_GRACE = 20_000;
/** How long an invite stands (ms). */
export const INVITE_FOR = 30_000;
/** After a shot lands, how long before the ball's in the next shooter's hands (ms). */
export const HAND_AFTER = 1200;
/** How long a finished game stays on the board (ms) before it goes back to the longest shots. */
export const SHOW_END = 8000;
/** How often the office looks at where the players are (ms). */
const SWEEP_EVERY = 1000;

interface Game {
  floor: string;
  state: PigState;
  owners: string[];
  /** When each player went away from the court (0: they're there). */
  away: number[];
  /** How many shots each player has had (landed, and decided), for whether a forfeit's win counts. */
  shots: number[];
  /** Timers to call off when the game ends. */
  timers: Set<() => void>;
}

interface Invite {
  floor: string;
  from: PigWho;
  to: PigWho;
  until: number;
}

/**
 * The games of PIG on the building's floors, one a floor (there's one ball): who's asked whom, whose
 * turn it is, where to match from, the letters, and the winner. The office decides every shot from its
 * own flight of the throw (see shot-judge.ts), hands the ball to whoever's turn it is, and calls the
 * game for the one who stays when the other walks off, leaves the floor or drops out for AWAY_GRACE.
 */
export class PigGames {
  private games = new Map<string, Game>();
  /** By whoever's asked. */
  private invites = new Map<string, Invite>();
  private sweeping: (() => void) | null = null;

  constructor(private deps: PigDeps) {}

  /** The game on `floor`, as everyone there sees it (null: none). */
  game(floor: string): PigState | null {
    return this.games.get(floor)?.state ?? null;
  }

  /** The game `id` is playing in (and not over yet), if any. */
  private gameOf(id: string): Game | undefined {
    for (const g of this.games.values()) if (g.state.winner === null && g.state.players.some((p) => p.id === id)) return g;
    return undefined;
  }

  /** Whether `id` is standing at the court on `floor`. */
  private atCourt(id: string, floor: string, reach = COURT_REACH): boolean {
    const w = this.deps.where(id);
    return !!w && w.floor === floor && Math.abs(w.y) < 1.5 && rimDistance(w) <= reach;
  }

  /**
   * `from` asks `to` to play, on `floor` (where the hoop is: the caller checks). Asking someone who's
   * asked you is a yes. Says why not, if it can't be.
   */
  invite(floor: string, from: PigWho, to: PigWho): string | undefined {
    if (from.id === to.id) return undefined;
    const theirs = this.invites.get(from.id);
    if (theirs && theirs.from.id === to.id && theirs.until > this.deps.now()) return this.answer(floor, from, to.id, true);
    const busy = this.busy(floor, from, to);
    if (busy) return busy;
    const until = this.deps.now() + INVITE_FOR;
    // One invite out at a time: asking someone else calls off the last.
    for (const [k, v] of this.invites) if (v.from.id === from.id) this.invites.delete(k);
    this.invites.set(to.id, { floor, from, to, until });
    this.deps.tell(to.id, { invitedBy: from, until });
    return undefined;
  }

  /** Why `from` and `to` can't start a game on `floor` now, or undefined. */
  private busy(floor: string, from: PigWho, to: PigWho): string | undefined {
    // The same account (or name, on the shared password) in two tabs is one person: no game, and no win to farm.
    if (from.owner === to.owner) return "🐷 That's you, in another tab: PIG takes two people";
    const on = this.games.get(floor);
    if (on && on.state.winner === null) return `🐷 ${on.state.players.map((p) => p.name).join(' and ')} are playing PIG: one game at a time, there's one ball`;
    if (this.gameOf(to.id)) return `🐷 ${to.name} is in a game already`;
    if (!this.atCourt(from.id, floor)) return '🐷 Come over to the hoop first';
    if (!this.atCourt(to.id, floor)) return `🐷 ${to.name} has to be at the hoop too`;
    return undefined;
  }

  /** `who` says yes (or no thanks) to `fromId`'s invite. Says why it can't start, if it can't. */
  answer(floor: string, who: PigWho, fromId: string, yes: boolean): string | undefined {
    const inv = this.invites.get(who.id);
    if (!inv || inv.from.id !== fromId || inv.until <= this.deps.now() || inv.floor !== floor) return yes ? '🐷 That invite ran out: ask them again' : undefined;
    this.invites.delete(who.id);
    if (!yes) {
      this.deps.tell(inv.from.id, { text: `🐷 ${who.name} said no thanks` });
      return undefined;
    }
    const busy = this.busy(floor, inv.from, who);
    if (busy) return busy;
    this.start(floor, inv.from, who);
    return undefined;
  }

  private start(floor: string, a: PigWho, b: PigWho) {
    this.end(floor);
    for (const id of [a.id, b.id]) {
      this.invites.delete(id);
      for (const [k, v] of this.invites) if (v.from.id === id) this.invites.delete(k);
    }
    const g: Game = { floor, state: newGame(a, b), owners: [a.owner, b.owner], away: [0, 0], shots: [0, 0], timers: new Set() };
    this.games.set(floor, g);
    this.deps.ball(floor, a.id, a.id);
    this.deps.changed(floor, g.state);
    this.deps.toast(floor, `🐷 ${a.name} and ${b.name} are playing PIG: ${a.name} shoots first`);
    this.sweepSoon();
  }

  /** Why `id` may not throw the ball from `s` now (in a game on `floor`), or null. A drop (`drop`) is always fine. */
  mayThrow(floor: string, id: string, s: { x: number; z: number; vx: number; vz: number }, drop: boolean): string | null {
    const g = this.games.get(floor);
    if (!g || drop) return null;
    return shotRefused(g.state, id, feetOf(s));
  }

  /** `id` threw the ball on `floor`, and this is how it went (the office's flight); no flight for a drop. */
  thrown(floor: string, id: string, s: { x: number; z: number; vx: number; vz: number }, flight: Flight | null) {
    const g = this.games.get(floor);
    if (!g || !flight || g.state.winner !== null || g.state.inAir) return;
    if (g.state.players[g.state.turn].id !== id) return;
    g.state = shotTaken(g.state);
    this.deps.ball(floor, '');
    this.deps.changed(floor, g.state);
    const feet = feetOf(s);
    this.after(g, flight.at * 1000, () => this.landed(g, flight.made, feet));
  }

  private landed(g: Game, made: boolean, feet: { x: number; z: number }) {
    g.shots[g.state.turn]++;
    g.state = shotResult(g.state, made, feet);
    this.deps.changed(g.floor, g.state);
    if (g.state.winner !== null) return this.finish(g);
    for (const p of g.state.players) this.deps.tell(p.id, { text: `🐷 ${g.state.news}` });
    this.after(g, HAND_AFTER, () => this.handOver(g));
  }

  /** The ball, to whoever's turn it is: in their hands if they're here, else waiting for them to pick it up. */
  private handOver(g: Game) {
    if (this.games.get(g.floor) !== g || g.state.winner !== null) return;
    const id = g.state.players[g.state.turn].id;
    this.deps.ball(g.floor, id, this.deps.where(id)?.floor === g.floor ? id : undefined);
  }

  /** `id` gives up the game they're in. */
  quit(id: string) {
    const g = this.gameOf(id);
    if (g) this.forfeit(g, g.state.players.findIndex((p) => p.id === id), 'gave up');
  }

  /** `id` left the office: their invites go (a game of theirs waits AWAY_GRACE for them). */
  gone(id: string) {
    this.invites.delete(id);
    for (const [k, v] of this.invites) if (v.from.id === id) this.invites.delete(k);
  }

  private forfeit(g: Game, loser: number, why: string) {
    if (loser < 0 || g.state.winner !== null) return;
    g.state = forfeit(g.state, loser, why);
    this.deps.changed(g.floor, g.state);
    this.finish(g);
  }

  /**
   * It's over: the floor hears who won, the table gets the win, the ball's anyone's again, and the
   * board shows it a while. A win by forfeit only counts once each player has had a shot: giving up
   * (or walking off) straight away doesn't put a win on the table.
   */
  private finish(g: Game) {
    for (const off of g.timers) off();
    g.timers.clear();
    const winner = g.state.players[g.state.winner!];
    this.deps.toast(g.floor, `🐷 ${g.state.news}`);
    if (g.state.end === 'pig' || g.shots.every((n) => n > 0)) this.deps.won({ owner: g.owners[g.state.winner!], name: winner.name, color: winner.color });
    else for (const p of g.state.players) this.deps.tell(p.id, { text: '🐷 No win on the table: it takes a shot each before a game counts' });
    this.deps.ball(g.floor, undefined);
    this.after(g, SHOW_END, () => this.end(g.floor));
  }

  /** The floor's hoop came down mid-game: the game's off, no contest (no win for anyone), and the ball's anyone's again. */
  private noContest(g: Game) {
    const players = g.state.players;
    this.end(g.floor);
    for (const p of players) this.deps.tell(p.id, { text: '🐷 The hoop came down: the game of PIG is off, no contest' });
  }

  /** Takes the floor's game off the board. */
  private end(floor: string) {
    const g = this.games.get(floor);
    if (!g) return;
    for (const off of g.timers) off();
    this.games.delete(floor);
    if (g.state.winner === null) this.deps.ball(floor, undefined);
    this.deps.changed(floor, null);
  }

  private after(g: Game, ms: number, fn: () => void) {
    const off = this.deps.later(ms, () => {
      g.timers.delete(off);
      fn();
    });
    g.timers.add(off);
  }

  private sweepSoon() {
    if (this.sweeping) return;
    this.sweeping = this.deps.later(SWEEP_EVERY, () => {
      this.sweeping = null;
      this.sweep();
      if ([...this.games.values()].some((g) => g.state.winner === null)) this.sweepSoon();
    });
  }

  /**
   * Looks at each game: whether its floor still has the hoop, and where each player is (back on a new
   * connection, off the court, or gone long enough to forfeit).
   */
  sweep() {
    const now = this.deps.now();
    for (const [k, v] of this.invites) if (v.until <= now) this.invites.delete(k);
    for (const g of [...this.games.values()]) {
      if (g.state.winner !== null) continue;
      if (!this.deps.hasHoop(g.floor)) {
        this.noContest(g);
        continue;
      }
      g.state.players.forEach((p, i) => {
        if (g.state.winner !== null) return;
        let w = this.deps.where(p.id);
        if (!w) {
          // Their connection dropped: someone back as them on this floor takes their place.
          const back = this.deps.findOwner(g.floor, g.owners[i]);
          if (back && !this.gameOf(back)) {
            const players = g.state.players.map((q, j) => (j === i ? { ...q, id: back } : q));
            g.state = { ...g.state, players, seq: g.state.seq + 1 };
            this.deps.changed(g.floor, g.state);
            if (g.state.turn === i && !g.state.inAir) this.handOver(g);
            w = this.deps.where(back);
          }
        }
        const id = g.state.players[i].id;
        if (w && this.atCourt(id, g.floor, AWAY_REACH)) {
          g.away[i] = 0;
          return;
        }
        g.away[i] ||= now;
        if (now - g.away[i] < AWAY_GRACE) return;
        this.forfeit(g, i, !w ? 'dropped out' : w.floor !== g.floor ? 'left the floor' : 'walked off the court');
      });
    }
  }

  /** The office is closing: every timer stops. */
  dispose() {
    this.sweeping?.();
    this.sweeping = null;
    for (const g of this.games.values()) for (const off of g.timers) off();
    this.games.clear();
    this.invites.clear();
  }
}
