import type { CabinetState, GameFrame } from '../../../shared/cabinet';
import type { Slice } from '../store';

declare module '../store' {
  interface Store {
    /** Who's at the arcade cabinet on your floor, and the building's high scores: every game's table (see tableOf in shared/cabinet.ts). */
    cabinet: CabinetState;
    /** The game on the cabinet as its player last sent it; null while nobody plays. */
    cabinetFrame: GameFrame | null;
  }
  interface Topics {
    cabinet: true;
    cabinetFrame: true;
  }
}

export const cabinet: Slice = {
  init(s) {
    s.cabinet = { player: null, scores: [] };
    s.cabinetFrame = null;
  },
  on: {
    cabinet(s, m) {
      // Nobody at it any more, or on to another game: the last game's screen goes with it.
      const p = m.state.player;
      const was = s.cabinet.player;
      if (!p || p.id !== was?.id || p.game !== was.game) s.cabinetFrame = null;
      s.cabinet = m.state;
      return ['cabinet'];
    },
    'cabinet.frame'(s, m) {
      s.cabinetFrame = m.frame;
      return ['cabinetFrame'];
    },
  },
  enter(s, v) {
    s.cabinet = { player: v.cabinet.player, scores: v.cabinet.scores };
    s.cabinetFrame = v.cabinet.frame;
    return ['cabinet', 'cabinetFrame'];
  },
};
