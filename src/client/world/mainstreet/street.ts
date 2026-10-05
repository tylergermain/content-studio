import * as THREE from 'three';
import { CLAIMABLE, type Claimable } from '../../../shared/mainstreet';
import type { BusinessCard } from '../../../shared/protocol';
import type { NightParts } from '../outside';
import type { Interactable } from '../types';
import { makeStreetKit } from './kit';
import { boardSpot, craneMotion, kerbSolids, parkSolids, plotSolids, signSpot, type CraneMotion, type StreetSolid } from './layout';
import { buildLease, buildLot } from './lot';
import { buildPark } from './park';
import { buildShell } from './shell';
import { buildSite, type SiteView } from './site';

// Main Street, drawn once for each place it's seen from: under every floor (features/mainstreet/world.ts)
// and from the roof bar (features/mainstreet/roof.ts). The three plots a business can claim, each a
// lawn with a kerb, and on it whatever stands there by the street's cards (see shared/protocol/street.ts):
// its FOR LEASE board while it's free, a building site or a shell once it's claimed; and Friday Park's
// heliport, path, benches and map board round golf's hole 1. A plot is rebuilt only when its card
// changes, and the map repainted with it.

export interface MainStreetOptions {
  /** Where the bulbs and the glowing windows go (and the lamps, with `lamps`). */
  night: NightParts;
  /**
   * The floors' copy: the floodlight and the map board's light are lamps at night, `base` being the
   * street's y in the frame the night's lamps are in (STREET_Y). The roof bar's copy has none.
   */
  lamps: { base: number } | null;
  /** Something new was built into the group (a plot, once its card changed): to fix up the way the rest of it is. */
  built?(obj: THREE.Object3D): void;
}

export interface MainStreetView {
  /** In the street frame: y 0 is the street. */
  group: THREE.Group;
  /** What's in the way, as it stands now: the kerbs, the park's, and each plot's. */
  solids(): readonly StreetSolid[];
  /**
   * What there is to use: the map board, and each plot's sign (its FOR LEASE board, a site's gate or
   * a shell's doors). x and z are the street frame's; y is for whoever puts them in a floor to set.
   */
  spots(): readonly Interactable[];
  /** Puts `cards` on their plots. True if anything changed, so its solids and spots did. */
  show(cards: readonly BusinessCard[]): boolean;
  /** The cranes, on the office's clock `officeMs`, and the windsock, `t` in seconds. */
  update(officeMs: number, t: number): void;
}

/** What stands on one plot now. */
interface OnPlot {
  /** Its card as JSON, or '' while it's for lease: what it was built from. */
  key: string;
  group: THREE.Group;
  solids: StreetSolid[];
  spot: Interactable;
  site: SiteView | null;
  dispose(): void;
}

export function buildMainStreet(opts: MainStreetOptions): MainStreetView {
  const kit = makeStreetKit(opts.night);
  const group = new THREE.Group();
  const statics: StreetSolid[] = [];
  for (const plot of CLAIMABLE) {
    group.add(buildLot(plot));
    statics.push(...kerbSolids(plot));
  }
  const park = buildPark(kit, opts.lamps);
  group.add(park.group);
  statics.push(...parkSolids());
  const mapSpot: Interactable = { kind: 'streetboard', ...boardSpot(), radius: 2.4 };
  park.board.userData.interact = mapSpot;

  const plots = new Map<Claimable, OnPlot>();
  let solids: StreetSolid[] = [];
  let spots: Interactable[] = [];
  /** The sites, whose cranes turn each frame. */
  let sites: { plot: Claimable; site: SiteView }[] = [];

  /** Plot `plot` with `card` on it (or nothing, for lease). */
  function build(plot: Claimable, card: BusinessCard | undefined): OnPlot {
    const stage = card?.stage ?? null;
    const spot: Interactable = { kind: 'plotsign', plot, ...signSpot(plot, stage), radius: 2.4 };
    const solids = plotSolids(plot, stage);
    if (!card) {
      const lease = buildLease(plot);
      lease.face.userData.interact = spot;
      return { key: '', group: lease.group, solids, spot, site: null, dispose: lease.dispose };
    }
    const site = card.stage === 'site' ? buildSite(card, kit) : null;
    const view = site ?? buildShell(card, kit);
    // Anything of it you look at says what's there, and E opens the window on its plot.
    view.group.userData.interact = spot;
    return { key: JSON.stringify(card), group: view.group, solids, spot, site, dispose: view.dispose };
  }

  function show(cards: readonly BusinessCard[]): boolean {
    let changed = false;
    for (const plot of CLAIMABLE) {
      const card = cards.find((c) => c.plot === plot);
      const key = card ? JSON.stringify(card) : '';
      const was = plots.get(plot);
      if (was && was.key === key) continue;
      if (was) {
        group.remove(was.group);
        was.dispose();
      }
      const now = build(plot, card);
      plots.set(plot, now);
      group.add(now.group);
      opts.built?.(now.group);
      changed = true;
    }
    if (!changed) return false;
    solids = [...statics, ...[...plots.values()].flatMap((p) => p.solids)];
    spots = [mapSpot, ...[...plots.values()].map((p) => p.spot)];
    sites = [...plots].flatMap(([plot, p]) => (p.site ? [{ plot, site: p.site }] : []));
    park.repaint(cards);
    return true;
  }
  show([]);

  const motion: CraneMotion = { slew: 0, trolley: 0, hook: 0 };
  return {
    group,
    solids: () => solids,
    spots: () => spots,
    show,
    update(officeMs, t) {
      for (let i = 0; i < sites.length; i++) sites[i].site.crane.pose(craneMotion(sites[i].plot, officeMs, motion));
      park.update(t);
    },
  };
}
