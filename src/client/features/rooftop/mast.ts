import * as THREE from 'three';
import { ELEVATOR, ELEVATOR_FRONT, FLOOR, WALL_HEIGHT, WALL_T } from '../../../shared/layout';
import { bulb, type NightParts } from '../../world/outside';
import { mergeByMaterial, mesh, toon } from '../../world/toon';

// The mast on the elevator's housing up on the roof (world.ts has the housing, and the red beacon at
// the mast's top): a steel pole tapering up from a plinth, braced at its foot, with step bolts up it,
// two collars and a small red light on each. The tower draws the same mast, plainer, for seeing it
// from down below (world/tower.ts); this one is the roof's own, for standing under it.

/** Where it stands (on the housing's roof, over the shaft), how tall it is, and how thick at its foot and top. */
export const MAST = {
  x: ELEVATOR.x,
  z: (FLOOR.minZ - WALL_T + ELEVATOR_FRONT) / 2,
  foot: WALL_HEIGHT + 0.3,
  height: 14,
  r0: 0.22,
  r1: 0.06,
} as const;

/** The collars, as a share of the way up, and how far out each reaches. */
const COLLARS: readonly [number, number][] = [
  [0.3, 0.55],
  [0.62, 0.42],
];

export function buildMast(night: NightParts): THREE.Group {
  const parts = new THREE.Group();
  const steel = toon('#b8c1cc');
  const steelDark = toon('#8d99ae');
  const { x, z, foot, height, r0, r1 } = MAST;
  /** How thick the pole is `h` up from its foot. */
  const r = (h: number) => r0 + (r1 - r0) * (h / height);

  // The plinth on the housing's roof, and the pole.
  parts.add(mesh(new THREE.BoxGeometry(0.9, 0.35, 0.9), steelDark, x, foot + 0.175, z));
  parts.add(mesh(new THREE.CylinderGeometry(r1, r0, height, 10), steel, x, foot + height / 2, z));

  // Three struts from the plinth's corners to 2.4 m up the pole.
  const brace = 2.4;
  for (const a of [Math.PI / 4, (Math.PI * 5) / 4, (Math.PI * 7) / 4]) {
    const from = new THREE.Vector3(x + Math.cos(a) * 0.55, foot + 0.35, z + Math.sin(a) * 0.55);
    const to = new THREE.Vector3(x + Math.cos(a) * r(brace), foot + brace, z + Math.sin(a) * r(brace));
    const strut = mesh(new THREE.CylinderGeometry(0.035, 0.035, from.distanceTo(to), 6), steelDark, 0, 0, 0);
    strut.position.copy(from).add(to).multiplyScalar(0.5);
    strut.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
    parts.add(strut);
  }

  // The collars, each with a small red light at its south edge, where it shows from the deck.
  const red = bulb(night, '#ff5d5d', 0.5);
  for (const [at, out] of COLLARS) {
    const y = foot + height * at;
    parts.add(mesh(new THREE.CylinderGeometry(out, out, 0.14, 12), steelDark, x, y, z, false));
    parts.add(mesh(new THREE.SphereGeometry(0.08, 8, 6), red, x, y + 0.12, z + out - 0.08, false));
  }

  // Step bolts up it, out to either side in turn: the way up for whoever changes the beacon's bulb.
  for (let h = 1.2, side = 1; h < height - 0.8; h += 0.4, side = -side) {
    parts.add(mesh(new THREE.BoxGeometry(0.2, 0.025, 0.025), steelDark, x + side * (r(h) + 0.1), foot + h, z, false));
  }

  return mergeByMaterial(parts);
}
