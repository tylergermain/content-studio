/**
 * Main Street on the floors: a street fixture (see world/office/ground.ts), built into the street under
 * every floor, that draws the plots as store.street has them: a FOR LEASE board and survey stakes on a
 * plot that's free, a building site or a shell on one that's claimed, and Friday Park round golf's
 * hole 1 with Friday One's heliport and the map board. What it draws is world/mainstreet/'s; this keeps
 * it in step with the store and puts what's in the way and what there is to use into the floor.
 */
import { STREET_Y, streetBelow } from '../../../shared/layout';
import { noOutline } from '../../core/outline';
import { store } from '../../state';
import { WALL, golfBoxes, type StreetSolid } from '../../world/mainstreet/layout';
import { buildMainStreet } from '../../world/mainstreet/street';
import { keep, type Fixture, type StreetSite } from '../../world/office/fixture';
import { setObstacleBoxes } from '../../world/outside';
import type { Collider, Interactable } from '../../world/types';

export const mainStreet: Fixture<never, StreetSite> = (site) => {
  const view = buildMainStreet({ night: site.get('night'), lamps: { base: STREET_Y }, built: noOutline });
  view.group.position.y = STREET_Y;
  site.ground.add(view.group);

  // What's in the way and what there is to use come and go with the plots, so they're kept in the
  // floor's own lists here, rather than with the street's (which only go down a storey per floor for
  // what was there when the floor was built), and moved down with the street here too.
  /** How far below the floor you're on the street is. */
  let street = STREET_Y;
  const colliders = new Map<StreetSolid, Collider>();
  let spots: readonly Interactable[] = [];
  const place = (s: StreetSolid, c: Collider) => {
    c.bottom = street + s.bottom;
    c.top = s.top >= WALL ? WALL : street + s.top;
  };
  /** The floor's colliders and interactables as the street has them now. */
  const sync = () => {
    const now = new Set(view.solids());
    for (const [s, c] of colliders) {
      if (now.has(s)) continue;
      keep(site.colliders, [c], false);
      colliders.delete(s);
    }
    for (const s of now) {
      if (colliders.has(s)) continue;
      const c: Collider = { minX: s.minX, maxX: s.maxX, minZ: s.minZ, maxZ: s.maxZ, top: 0 };
      if (s.fence) c.fence = true;
      place(s, c);
      colliders.set(s, c);
      keep(site.colliders, [c], true);
    }
    keep(site.interactables, spots, false);
    spots = view.spots();
    for (const it of spots) it.y = street;
    keep(site.interactables, spots, true);
  };
  sync();

  // Built again only when the businesses on the street change, not each time a floor's view says the same.
  let shown = '';
  const show = () => {
    const key = JSON.stringify(store.street.cards);
    if (key === shown) return;
    shown = key;
    if (view.show(store.street.cards)) sync();
    // A golf ball off the balcony bounces off what stands on the plots.
    setObstacleBoxes('mainstreet', golfBoxes(store.street.cards));
  };
  store.on('street', show);
  show();

  return {
    update: (t) => view.update(store.officeNow(), t),
    setLevel: (index) => {
      street = streetBelow(index);
      for (const [s, c] of colliders) place(s, c);
      for (const it of spots) it.y = street;
    },
  };
};
