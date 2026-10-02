import { NO_WATCH, type WatchState } from '../../../shared/protocol/watch';
import type { Slice } from '../store';

declare module '../store' {
  interface Store {
    /** The newest videos from the YouTube channels your floor watches (see StudioSetup.watch), for its screens. */
    watch: WatchState;
  }
  interface Topics {
    watch: true;
  }
}

export const watch: Slice = {
  init(s) {
    s.watch = NO_WATCH;
  },
  on: {
    watch(s, m) {
      s.watch = m.watch;
      return ['watch'];
    },
  },
  enter(s, v) {
    s.watch = v.watch ?? NO_WATCH;
    return ['watch'];
  },
};
