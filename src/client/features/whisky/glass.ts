import * as THREE from 'three';
import { glass as crystal, whisky } from '../../world/office/furniture-whisky';

// The rocks glass a dram is held in, built in code (the cabinet's own are whisky.glb's, see
// world/office/furniture-whisky.ts, and look the same): cut crystal with a heavy base and the whisky in
// it, which goes down as it's sipped. The whisky is round, a soft amber, its surface a shade lighter
// than its sides, the way light lies on a liquid, with no hard line round it.

/** Its size, as the model's glasses: radius at the rim, height, its solid base, and a full dram's depth. */
const R = 0.041;
const H = 0.085;
const FLOOR = 0.014;
const DRAM = 0.032;
/** Round enough that its rim and the whisky's surface read as circles, not an octagon. */
const SEGS = 24;

let mats: { wall: THREE.Material; base: THREE.Material; side: THREE.Material; top: THREE.Material } | null = null;
function materials() {
  if (mats) return mats;
  const side = whisky('#c27c2e');
  side.userData.outlineParameters = { visible: false };
  const top = whisky('#d9a253');
  top.userData.outlineParameters = { visible: false };
  mats = { wall: crystal('#e2eff8', 0.32), base: crystal('#d6e8f5', 0.5), side, top };
  return mats;
}

export interface HeldGlass {
  group: THREE.Group;
  /** How full it is, 0 (drained) to 1 (a fresh dram). */
  fill(level: number): void;
  /** Lets go of its shapes (its materials are every glass's). */
  dispose(): void;
}

/** A rocks glass with a dram in it, standing on y = 0, `scale` times life size. */
export function heldGlass(scale = 1): HeldGlass {
  const m = materials();
  const group = new THREE.Group();
  const v = (x: number, y: number) => new THREE.Vector2(x, y);
  // Up the outside, over the rim and down the inside to the base: one lathe.
  const wall = new THREE.Mesh(new THREE.LatheGeometry([v(R - 0.004, 0), v(R - 0.002, 0.003), v(R, H), v(R - 0.003, H), v(R - 0.004, FLOOR + 0.002)], SEGS), m.wall);
  wall.geometry.computeVertexNormals();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.005, R - 0.005, FLOOR, SEGS), m.base);
  base.position.y = FLOOR / 2;
  // A column one metre tall standing on its own foot, so its height is how full the glass is: its
  // sides in the deeper amber, its surface (the cylinder's top cap, group 1) in the lighter.
  const whiskyMesh = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.0045, R - 0.0045, 1, SEGS).translate(0, 0.5, 0), [m.side, m.top, m.side]);
  whiskyMesh.position.y = FLOOR + 0.002;
  for (const mesh of [wall, base, whiskyMesh]) {
    mesh.castShadow = false;
    group.add(mesh);
  }
  group.scale.setScalar(scale);
  return {
    group,
    fill(level) {
      whiskyMesh.visible = level > 0.01;
      whiskyMesh.scale.y = DRAM * Math.max(0.01, level);
    },
    dispose() {
      group.removeFromParent();
      for (const mesh of [wall, base, whiskyMesh]) mesh.geometry.dispose();
    },
  };
}
