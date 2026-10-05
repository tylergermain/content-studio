/**
 * Main Street: the street Friday Tower stands on, with plots either side for other businesses (see
 * shared/mainstreet.ts). E at a plot's FOR LEASE board, or at the map board in Friday Park, opens the
 * Main Street window: the plan of the street and who's where, where street admins claim a plot for a
 * business, change what stands on it and give it back (ui.ts). The street itself is drawn on the
 * floors by world.ts (the mainStreet street fixture) and from the roof bar by roof.ts.
 */
import { PLOTS, type Claimable } from '../../../shared/mainstreet';
import type { Ctx, Hint } from '../../core/context';
import { aside, hintTitle, key, onE } from '../../core/hint';
import { store } from '../../state';
import { mainStreetRoof } from './roof';
import { openStreetWindow, type StreetWindow } from './ui';

// The kinds of thing you can use that this defines (see InteractKinds in world/types.ts), and the plot
// a plot's board is for.
declare module '../../world/types' {
  interface InteractKinds {
    plotsign: true;
    streetboard: true;
  }
  interface Interactable {
    /** Which plot a plot's board (FOR LEASE, or a claimed plot's) is for. */
    plot?: Claimable;
  }
}

export interface MainStreetDeps {
  /** How many storeys the roof stands on (see features/rooftop): Main Street is that far below it. */
  roofFloors(): number;
}

export function installMainStreet(ctx: Ctx, deps: MainStreetDeps) {
  /** The Main Street window, once it's been opened. */
  let open: StreetWindow | null = null;

  /** Opens the Main Street window, on plot `plot` when it's given (or picks it out in the one that's open). */
  function openStreet(plot?: Claimable) {
    if (open?.isOpen()) return open.show(plot);
    open = openStreetWindow(ctx, plot);
  }

  // A plot's board says whose it is, and to a street admin at one that's for lease, that E claims it. The
  // hint bar asks every frame you face it, so the hint is made again only when one of those changes.
  let last: { plot: Claimable; name: string | undefined; admin: boolean; hint: Hint } | null = null;
  ctx.interactions.define('plotsign', {
    reach: 4,
    hint: (it) => {
      const plot = it.plot ?? 'P2';
      const name = store.plotCard(plot)?.name;
      const admin = store.streetAdmin();
      if (last && last.plot === plot && last.name === name && last.admin === admin) return last.hint;
      const parts = [hintTitle(`🏙️ ${PLOTS[plot].name}`), aside(name ?? 'For lease'), key('E', admin && !name ? 'Claim it' : 'Main Street')];
      last = { plot, name, admin, hint: { k: `${plot}|${name ?? ''}|${admin}`, parts } };
      return last.hint;
    },
    use: onE((it) => openStreet(it.plot)),
  });
  let board: Hint | null = null;
  ctx.interactions.define('streetboard', {
    reach: 4,
    hint: () => (board ??= { k: '', parts: [hintTitle('🗺️ Main Street'), aside("who's where"), key('E', 'Open')] }),
    use: onE(() => openStreet()),
  });

  mainStreetRoof(ctx, deps);
  return { openStreet };
}
