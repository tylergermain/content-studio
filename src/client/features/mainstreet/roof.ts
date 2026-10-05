/**
 * Main Street from the roof bar: the roof city (world/city.ts) leaves Main Street's six blocks empty
 * (onMain in shared/mainstreet.ts), and this draws them as the floors do: the plots, their sites and
 * shells, and Friday Park, in a group of its own `roofDrop(roofFloors())` under the roof, shown while
 * you're up there.
 *
 * It's the floors' own builders (world/mainstreet/, golf's buildGreen, Putt Street's buildPuttStreet),
 * built the first time you go up and following the street and the floors from then on. None of it
 * lights a lamp (see lampless): the sky's lamps are the floors', placed once, and already all taken.
 */
import * as THREE from 'three';
import { STREET_Y, roofDrop } from '../../../shared/layout';
import { PLOTS } from '../../../shared/mainstreet';
import type { Ctx } from '../../core/context';
import { noOutline } from '../../core/outline';
import { store } from '../../state';
import { flatPaint, lampless } from '../../world/mainstreet/kit';
import { ROOF_LIFT } from '../../world/mainstreet/layout';
import { buildMainStreet, type MainStreetView } from '../../world/mainstreet/street';
import { mesh } from '../../world/toon';
import { buildGreen, type Green } from '../golf/world';
import { buildPuttStreet, type PuttStreetView } from '../minigolf/world';
import type { MainStreetDeps } from './index';

export function mainStreetRoof(ctx: Ctx, deps: MainStreetDeps): void {
  const group = new THREE.Group();
  group.visible = false;
  let view: MainStreetView | null = null;
  let green: Green | null = null;
  let putt: PuttStreetView | null = null;

  /**
   * As far down as the street is from the roof, which goes up with a floor past the tower's height (and
   * ROOF_LIFT over the roof city's ground there).
   */
  const place = () => {
    group.position.y = ROOF_LIFT - roofDrop(deps.roofFloors());
  };

  function build() {
    const night = lampless(ctx.office.night);
    view = buildMainStreet({ night, lamps: null, built: noOutline });
    group.add(view.group);
    // The roof city's ground is pavement under every block: Friday Park and Putt Street get the grass
    // the floors have everywhere (a few centimeters under the street, as theirs is).
    const grass = flatPaint('#a7d98b');
    for (const id of ['P5', 'P6'] as const) {
      const b = PLOTS[id].box;
      group.add(mesh(new THREE.PlaneGeometry(b.maxX - b.minX, b.maxZ - b.minZ).rotateX(-Math.PI / 2), grass, (b.minX + b.maxX) / 2, -0.03, (b.minZ + b.maxZ) / 2, false));
    }
    // Golf's hole 1, which builds itself at the bottom floor's street (STREET_Y): lifted to this one's 0.
    const golf = new THREE.Group();
    golf.position.y = -STREET_Y;
    green = buildGreen(golf, [], night);
    group.add(golf);
    putt = buildPuttStreet(null);
    group.add(putt.group);
    view.show(store.street.cards);
    place();
    ctx.scene.add(group);
    noOutline(group);
  }

  store.on('street', () => view?.show(store.street.cards));
  store.on('floors', place);
  ctx.ticks.add('env', ({ t }) => {
    const up = ctx.upTop();
    if (up && !view) build();
    if (group.visible !== up) group.visible = up;
    if (!up || !view) return;
    const now = store.officeNow();
    view.update(now, t);
    putt?.update(now);
    green?.update(t);
  });
}
