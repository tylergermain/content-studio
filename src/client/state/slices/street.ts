import type { BusinessCard, StreetView } from '../../../shared/protocol';
import type { Slice } from '../store';

declare module '../store' {
  interface Store {
    /** Main Street's businesses: a card for each claimed plot (see shared/mainstreet.ts and features/mainstreet). */
    street: StreetView;
    /** Whether you're a street admin, who claims plots and flies Friday One: the office's admins, for now. */
    streetAdmin(): boolean;
    /** The business on plot `plot`, if it's claimed. */
    plotCard(plot: string): BusinessCard | undefined;
  }
  interface Topics {
    street: true;
  }
}

export const street: Slice = {
  init(s) {
    s.street = { cards: [] };
  },
  methods: {
    streetAdmin() {
      return this.me.admin;
    },
    plotCard(plot) {
      return this.street.cards.find((c) => c.plot === plot);
    },
  },
  on: {
    street(s, m) {
      s.street = m.street;
      return ['street'];
    },
  },
  enter(s, v) {
    // The building's, the same on every floor; an office from before Main Street says nothing of it.
    s.street = v.street ?? { cards: [] };
    return ['street'];
  },
};
