import type { RaceView } from '../../../shared/race';
import type { Slice } from '../store';

declare module '../store' {
  interface Store {
    /** The race on this floor (see shared/race.ts), and when (performance.now()) the office last said how it stands: its clock runs from then. */
    race: RaceView | null;
    raceAt: number;
  }
  interface Topics {
    race: true;
  }
}

export const race: Slice = {
  init(s) {
    s.race = null;
    s.raceAt = 0;
  },
  on: {
    race(s, m) {
      s.race = m.race;
      s.raceAt = performance.now();
      return ['race'];
    },
  },
  enter(s, v) {
    s.race = v.race ?? null;
    s.raceAt = performance.now();
    return ['race'];
  },
};
