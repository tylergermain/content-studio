import { parkedHeli } from '../../../shared/heli';
import type { HeliCrew, HeliPose, HeliState } from '../../../shared/protocol';
import type { Slice } from '../store';

declare module '../store' {
  interface Store {
    /** Friday One: where it is, whether it's down and who's aboard (see features/heli). */
    heli: HeliState;
    /**
     * Its newest pose, and when it was there (ms since 1970, the office's clock): what everyone but the
     * pilot draws it from. `heli.move` sets it often, without a topic.
     */
    heliPose: { pose: HeliPose; at: number };
    /** `id`'s seat in it, if they're aboard. */
    heliSeatOf(id: string): HeliCrew | undefined;
  }
  interface Topics {
    heli: true;
  }
}

export const heli: Slice = {
  init(s) {
    s.heli = parkedHeli();
    s.heliPose = { pose: s.heli.pose, at: 0 };
  },
  methods: {
    heliSeatOf(id) {
      return this.heli.crew.find((c) => c.id === id);
    },
  },
  on: {
    heli(s, m) {
      s.heli = m.heli;
      s.heliPose = { pose: m.heli.pose, at: s.officeNow() };
      return ['heli'];
    },
    'heli.move'(s, m) {
      s.heliPose = { pose: m.pose, at: m.at };
    },
  },
  enter(s, v) {
    // The building's, the same on every floor; an office from before Friday One says nothing of it.
    s.heli = v.heli ?? parkedHeli();
    s.heliPose = { pose: s.heli.pose, at: s.officeNow() };
    return ['heli'];
  },
};
