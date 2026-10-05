import { emptyPuttBoard, type PuttBoard, type PuttRoll, type PuttRound, type PuttServerMsg } from '../../../shared/protocol';
import type { Slice } from '../store';

type BoardNews = NonNullable<Extract<PuttServerMsg, { t: 'putt.board' }>['latest']>;

declare module '../store' {
  interface Store {
    /** Putt Street's rounds going on, the building's (see features/minigolf). */
    puttRounds: PuttRound[];
    /** Putt Street's records: the course record, the best on each hole, holes-in-one and the last rounds. */
    puttBoard: PuttBoard;
    /** What last changed the records, and when it came (performance.now()): the boards pick it out a while. */
    puttLatest: (BoardNews & { at: number }) | null;
    /** Each round's latest putt, by round id: played back on the office's clock (officeNow) from its startAt. */
    puttRolls: Map<string, PuttRoll>;
    /** The round you're in, if any. */
    myRound(): PuttRound | undefined;
  }
  interface Topics {
    putt: true;
    puttBoard: true;
    puttRolled: true;
  }
}

export const minigolf: Slice = {
  init(s) {
    s.puttRounds = [];
    s.puttBoard = emptyPuttBoard();
    s.puttLatest = null;
    s.puttRolls = new Map();
  },
  methods: {
    myRound() {
      // One just over (its card still up for a minute) gives way to the next you've joined.
      const mine = (r: PuttRound) => r.players.some((p) => p.id === this.you);
      return this.puttRounds.find((r) => r.stage !== 'over' && mine(r)) ?? this.puttRounds.find(mine);
    },
  },
  on: {
    putt(s, m) {
      s.puttRounds = m.rounds;
      // A round that's gone takes its last putt with it.
      for (const id of [...s.puttRolls.keys()]) if (!m.rounds.some((r) => r.id === id)) s.puttRolls.delete(id);
      return ['putt'];
    },
    'putt.rolled'(s, m) {
      const { t: _, ...roll } = m;
      s.puttRolls.set(roll.round, roll);
      return ['puttRolled'];
    },
    'putt.board'(s, m) {
      s.puttBoard = m.board;
      if (m.latest) s.puttLatest = { ...m.latest, at: performance.now() };
      return ['puttBoard'];
    },
  },
  enter(s, v) {
    // The building's, the same on every floor; an office from before Putt Street says nothing of it.
    s.puttRounds = v.putt?.rounds ?? [];
    s.puttBoard = v.putt?.board ?? emptyPuttBoard();
    for (const id of [...s.puttRolls.keys()]) if (!s.puttRounds.some((r) => r.id === id)) s.puttRolls.delete(id);
    return ['putt', 'puttBoard'];
  },
};
