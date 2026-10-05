import * as THREE from 'three';
import { palette, piece } from '../models';
import { toon } from '../toon';
import { BLACK, type Builders } from './furniture-kit';
import { PALETTE } from './materials';

// The furniture's builders for the plants that came with the studio (see furniture.ts, and
// shared/furniture.ts for what each kind is and how much floor it takes; the office's first plants are
// props.ts's). They're modelled in Blender (blender/scripts/build_greenery.py): each is a painted copy
// of one piece of greenery.glb (see piece()), its planter the root and everything that grows out of it
// hung under that as `<plant>_leaves`, as plants.glb has them.

/**
 * The greens, the soil and the bark are the first plants' (PLANT_COLORS in props.ts), with a pale green
 * for new leaves; the planters are white ceramic, cast stone and charcoal, on the studio's oak and steel.
 */
const GREENERY_COLORS = {
  Ceramic: '#f7f3ea',
  Stone: '#b9b4aa',
  Charcoal: '#3d405b',
  Oak: '#c9a36b',
  Steel: BLACK,
  Soil: '#6b4226',
  Bark: '#8a5a3b',
  Leaf: PALETTE.plant,
  LeafDark: PALETTE.plantDark,
  LeafLight: '#a8d672',
};
const paintGreenery = palette(GREENERY_COLORS);

/** A plant of greenery.glb in its planter, its origin on the floor under the planter's middle. */
function grown(part: string, own: Record<string, THREE.Material> = {}): THREE.Group {
  const g = new THREE.Group();
  g.add(piece('greenery', part, (name) => own[name] ?? paintGreenery(name)));
  return g;
}

export const GREENERY_BUILDERS: Builders = {
  'fiddle-leaf': () => grown('fiddle_leaf'),
  palm: () => grown('palm'),
  'bird-of-paradise': () => grown('bird_of_paradise'),
  pothos: () => grown('pothos'),
  // A long box of plants on two steel skids, the box in the piece's color.
  planter: (_p, color) => grown('planter', { Box: toon(color) }),
};
