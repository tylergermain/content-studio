import * as THREE from 'three';
import type { Theme } from '../../../shared/protocol';
import { elfBoot, elfHat, elfWorker } from '../costumes';
import type { WorkerRig } from './rig';

// Dressing a worker up for a holiday.

/**
 * Dresses a worker up for a holiday (an elf for Christmas), or in just its own skin, `color` (null).
 * What it puts on goes in `outfit`, for taking off again.
 */
export function dressUp(rig: WorkerRig, theme: Theme | null, color: string, outfit: THREE.Object3D[]) {
  const wear = (parent: THREE.Object3D, o: THREE.Object3D) => {
    o.traverse((m) => ((m as THREE.Mesh).castShadow = true));
    parent.add(o);
    outfit.push(o);
  };
  rig.skin.color.set(color);
  if (theme === 'christmas') {
    wear(rig.body, elfHat());
    wear(rig.body, elfWorker(rig.skin));
    for (const f of rig.feet) wear(f, elfBoot());
  }
}
