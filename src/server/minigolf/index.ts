// Putt Street, the mini golf course on Main Street (see protocol/minigolf.ts): the office is its
// referee. One course for the building, reached through puttOf(ctx), so the office's core knows
// nothing of it: its rounds (rounds.ts) and its records in minigolf.json (records.ts).
import type { PuttBoard, PuttRound, PuttView } from '../../shared/protocol.js';
import type { Ctx } from '../office/context.js';
import { streetSpot } from '../street/people.js';
import { PuttRecords } from './records.js';
import { PuttRounds, type PuttWho } from './rounds.js';

/** Putt Street as the office keeps it. */
export interface PuttStreet {
  /** The rounds going on. */
  rounds(): PuttRound[];
  /** The records, as minigolf.json keeps them. */
  board(): PuttBoard;
  /** Putt Street as whoever arrives on a floor is sent it (FloorView.putt). */
  view(): PuttView;
  /** At the putter rack: into a group that's forming, or a new one. Says why not, if it can't. */
  play(who: PuttWho): string | undefined;
  /** The starter tees their group off now. */
  start(id: string, round: string): string | undefined;
  /** A putt, on your turn, from beside your ball: rolled and told to everyone. Says why not, when it's worth saying. */
  stroke(who: PuttWho, round: string, yaw: number, power: number, at: number): string | undefined;
  /** Out of a round (every round, without one). */
  quit(id: string, round?: string): void;
}

/** The office's course: its rounds, refereed on the office's clock, and its records. */
class Course implements PuttStreet {
  private readonly records: PuttRecords;
  private readonly games: PuttRounds;

  constructor(ctx: Ctx) {
    this.records = new PuttRecords(ctx.cfg.dataDir);
    this.games = new PuttRounds({
      now: () => Date.now(),
      later: (ms, fn) => {
        const t = setTimeout(fn, ms);
        t.unref();
        return () => clearTimeout(t);
      },
      broadcast: (msg) => ctx.broadcast(msg),
      tell: (id, text) => {
        const c = ctx.clients.get(id);
        if (c) ctx.sendTo(c, { t: 'toast', text, level: 'warn' });
      },
      toastAll: (text) => ctx.toastAll(text),
      where: (id) => {
        const c = ctx.clients.get(id);
        return c ? streetSpot(ctx, c) : null;
      },
      records: this.records,
    });
  }

  rounds(): PuttRound[] {
    return this.games.rounds();
  }

  board(): PuttBoard {
    return this.records.board();
  }

  view(): PuttView {
    return { rounds: this.rounds(), board: this.board() };
  }

  play(who: PuttWho) {
    return this.games.play(who);
  }

  start(id: string, round: string) {
    return this.games.start(id, round);
  }

  stroke(who: PuttWho, round: string, yaw: number, power: number, at: number) {
    return this.games.stroke(who, round, yaw, power, at);
  }

  quit(id: string, round?: string) {
    this.games.quit(id, round);
  }
}

/** Each office's course. */
const COURSES = new WeakMap<Ctx, PuttStreet>();

/** The office's Putt Street, made the first time it's asked for. */
export function puttOf(ctx: Ctx): PuttStreet {
  let course = COURSES.get(ctx);
  if (!course) COURSES.set(ctx, (course = new Course(ctx)));
  return course;
}
