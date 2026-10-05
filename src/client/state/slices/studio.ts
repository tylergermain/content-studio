import { EMPTY_STUDIO, NO_INTEGRATIONS, type IntegrationsState, type StudioState, type TickerState } from '../../../shared/studio';
import type { Slice } from '../store';

declare module '../store' {
  interface Store {
    /** What your floor's wall boards and kiosks are for, when it has made them its own, and what's posted (see shared/studio.ts). */
    studio: StudioState;
    /** The prices on your floor's ticker. */
    ticker: TickerState;
    /** What the office is signed in to, for the boards it fills by itself. */
    integrations: IntegrationsState;
  }
  interface Topics {
    studio: true;
    ticker: true;
    integrations: true;
  }
}

const NO_TICKER: TickerState = { quotes: [], at: 0 };

export const studio: Slice = {
  init(s) {
    s.studio = EMPTY_STUDIO;
    s.ticker = NO_TICKER;
    s.integrations = NO_INTEGRATIONS;
  },
  on: {
    welcome(s, m) {
      s.integrations = m.integrations ?? NO_INTEGRATIONS;
      return ['integrations'];
    },
    studio(s, m) {
      s.studio = m.studio;
      return ['studio'];
    },
    ticker(s, m) {
      s.ticker = m.ticker;
      return ['ticker'];
    },
    integrations(s, m) {
      s.integrations = m.state;
      return ['integrations'];
    },
  },
  enter(s, v) {
    s.studio = v.studio ?? EMPTY_STUDIO;
    s.ticker = v.ticker ?? NO_TICKER;
    return ['studio', 'ticker'];
  },
};
