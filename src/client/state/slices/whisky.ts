import type { Slice } from '../store';

declare module '../store' {
  interface Store {
    /** Who on your floor has a dram from the whisky cabinet in hand, you too, by peer id (see features/whisky). */
    drams: ReadonlySet<string>;
  }
  interface Topics {
    whisky: true;
  }
}

export const whisky: Slice = {
  init(s) {
    s.drams = new Set();
  },
  on: {
    'whisky.poured'(s, m) {
      if (s.drams.has(m.id)) return;
      s.drams = new Set([...s.drams, m.id]);
      return ['whisky'];
    },
    'whisky.down'(s, m) {
      if (!s.drams.has(m.id)) return;
      s.drams = new Set([...s.drams].filter((id) => id !== m.id));
      return ['whisky'];
    },
  },
  enter(s, v) {
    // An office from before the cabinet says nothing of it.
    s.drams = new Set(v.whisky ?? []);
    return ['whisky'];
  },
};
