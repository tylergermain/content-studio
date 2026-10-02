import * as THREE from 'three';
import { mesh, roundedBox, toon } from '../toon';
import { BLACK, screenMesh, type Builders, type BuiltPiece } from './furniture-kit';
import { box } from './materials';

// The furniture's builders for the screens that hang (see furniture.ts, and shared/furniture.ts for what
// each kind is and how much floor it takes). The one on a stand is furniture-studio.ts's.

/** How high the middle of a wall screen hangs: a standing person's eye level, a little over. */
const HUNG = 1.6;

/**
 * A video screen on the wall: the same 16:9 face as the one on a stand (1.98 by 1.11, facing the front,
 * +z), which `screen` plays the floor's videos on (features/screens), in a slim frame on a wall mount.
 * The frame is as deep as its footprint; the mount's arm reaches back past it to the wall, a hand's
 * width behind, so it still looks hung when the builder's grid leaves it just short of the wall (and is
 * inside the wall, out of sight, when it's pushed right up).
 */
function wallScreen(color: string): BuiltPiece {
  const g = new THREE.Group();
  const mount = toon(BLACK);
  g.add(mesh(box(0.14, 0.14, 0.18), mount, 0, HUNG, -0.1, false));
  g.add(mesh(box(0.5, 0.36, 0.02), mount, 0, HUNG, -0.19, false));
  const frame = mesh(roundedBox(2.1, 0.06, 1.23, 0.05), toon(color), 0, HUNG, 0.02);
  frame.rotation.x = Math.PI / 2;
  g.add(frame);
  const screen = screenMesh(1.98, 1.11);
  screen.position.set(0, HUNG, 0.055);
  g.add(screen);
  return { group: g, screen };
}

export const SCREENS_BUILDERS: Builders = {
  'wall-screen': (_p, color) => wallScreen(color),
};
