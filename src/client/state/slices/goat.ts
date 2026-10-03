import type { GoatState } from '../../../shared/protocol';
import type { Slice, Store } from '../store';

declare module '../store' {
  interface Store {
    /** Marc, the building's goat, while he's on your floor, and when (performance.now()) the leg he's on began. */
    goat: GoatState | null;
    goatStart: number;
  }
  interface Topics {
    goat: true;
  }
}

function setGoat(s: Store, goat: GoatState | null) {
  s.goat = goat;
  s.goatStart = performance.now() - (goat?.elapsed ?? 0);
}

export const goat: Slice = {
  init(s) {
    s.goat = null;
    s.goatStart = 0;
  },
  on: {
    goat(s, m) {
      setGoat(s, m.goat);
      return ['goat'];
    },
  },
  enter(s, v) {
    // An office from before he moved in says nothing of him.
    setGoat(s, v.goat ?? null);
    return ['goat'];
  },
};
