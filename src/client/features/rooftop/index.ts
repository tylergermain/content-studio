/**
 * Up on the roof: the roof itself, built the first time anyone goes up there and standing on top of
 * the tower (as many storeys as TOWER has, or as there are floors if that's more), its mast, and
 * everything up there moving to the DJ's set. The bar, the DJ's booth and the games up there are
 * features/bar's and features/bargames'.
 */
import type * as THREE from 'three';
import { roofDrop } from '../../../shared/layout';
import type { Ctx } from '../../core/context';
import { builtFloors, floorStoreys, floorWings } from '../../core/floors';
import { noOutline } from '../../core/outline';
import { djFrame, djTime } from '../../dnb';
import { store } from '../../state';
import { setStoreys, TOWER } from '../../world/facade';
import { buildMast } from './mast';
import { buildRooftop, type Rooftop } from './world';

export interface RooftopDeps {
  /** The office's lights, which the roof's strobes flash as a drop lands. */
  ambient: THREE.AmbientLight;
  hemi: THREE.HemisphereLight;
}

export function installRooftop(ctx: Ctx, deps: RooftopDeps) {
  /** Up on the roof: built the first time anyone goes up there. */
  let roof: Rooftop | null = null;
  function theRoof(): Rooftop {
    if (!roof) {
      roof = buildRooftop(ctx.office.night, roofFloors());
      roof.setFloors(roofFloors(), floorWings(builtFloors()));
      roof.group.add(buildMast(ctx.office.night));
      roof.group.visible = false;
      roof.games.onDrop = (at) => ctx.sound.toss('drop', at);
      ctx.scene.add(roof.group);
      noOutline(roof.group);
    }
    return roof;
  }
  /** How many storeys the roof stands on: the tower's, or every floor that's built if there are more. */
  function roofFloors(): number {
    return Math.max(TOWER.storeys, builtFloors().length);
  }
  /**
   * Floors come and go, or get a new name or paint: the storeys under the roof show it, the roof goes
   * up with a floor past the tower's height, and the street's that much further down from it.
   */
  function syncRoof() {
    setStoreys(floorStoreys(builtFloors()));
    if (!roof) return;
    const floors = roofFloors();
    roof.setFloors(floors, floorWings(builtFloors()));
    if (ctx.upTop()) ctx.sky.setRoof(true, roofDrop(floors));
  }
  store.on('floors', syncRoof);
  /** How far into the DJ's set it is, on the office's clock, so everyone up there hears the same bar. */
  const djAt = () => djTime(store.officeNow());
  ctx.ticks.add('env', ({ dt, t }) => {
    if (ctx.upTop() && roof) {
      // Everything up there moves to the DJ's set; strobes flash the whole roof as a drop lands.
      const strobe = roof.update(t, dt, djFrame(djAt()), { dark: ctx.sky.lampsOn, motion: !ctx.reduceMotion.matches });
      deps.ambient.intensity += strobe * 1.5;
      deps.hemi.intensity += strobe * 0.8;
    }
  });

  return { roof: () => roof, theRoof, roofFloors, syncRoof, djAt };
}
