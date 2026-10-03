import type { HoopBoard } from '../../../shared/longshots';
import type { PigState } from '../../../shared/pig';
import type { Slice } from '../store';

declare module '../store' {
  interface Store {
    /** The building's longest shots and PIG winners, on the scoreboard beside the hoop. */
    hoopBoard: HoopBoard;
    /** The make that last changed the table, and when it came (performance.now()): the board picks it out a while. */
    hoopLatest: { name: string; dist: number; rank: number; first: boolean; at: number } | null;
    /** The game of PIG on your floor; null while there's none. */
    pig: PigState | null;
  }
  interface Topics {
    hoopBoard: true;
    pig: true;
  }
}

export const hoop: Slice = {
  init(s) {
    s.hoopBoard = { shots: [], wins: [] };
    s.hoopLatest = null;
    s.pig = null;
  },
  on: {
    'hoop.board'(s, m) {
      s.hoopBoard = m.board;
      if (m.latest) s.hoopLatest = { ...m.latest, at: performance.now() };
      return ['hoopBoard'];
    },
    pig(s, m) {
      s.pig = m.pig;
      return ['pig'];
    },
  },
  enter(s, v) {
    // An office from before the scoreboard says nothing of it.
    s.hoopBoard = v.hoop?.board ?? { shots: [], wins: [] };
    s.pig = v.hoop?.pig ?? null;
    return ['hoopBoard', 'pig'];
  },
};
