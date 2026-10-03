import * as THREE from 'three';
import { glass as crystal, WHISKY_SIZES } from '../../world/office/furniture-whisky';
import { GLASS_ORDER, dramGeometry, dramMesh } from '../../world/office/whisky-liquid';

// The rocks glass a dram is held in, built in code (the cabinet's own are whisky.glb's, see
// world/office/furniture-whisky.ts, and look the same): cut crystal with a heavy base and the whisky in
// it, which goes down as it's sipped. The whisky is as it is in the glasses on the tray (whisky-liquid.ts):
// round, see-through amber, deeper toward the bottom, under a lighter, level surface.

/** Its size, as the model's glasses: radius at the rim, height, and its solid base. */
export const GLASS = { r: 0.041, h: 0.085, floor: 0.014 } as const;
/** Round enough that its rim and the whisky's surface read as circles, not an octagon. */
const SEGS = 24;

let mats: { wall: THREE.Material; base: THREE.Material } | null = null;
let dram: THREE.BufferGeometry | null = null;
function materials() {
  mats ??= { wall: crystal('#e2eff8', 0.32), base: crystal('#d6e8f5', 0.5) };
  return mats;
}

export interface HeldGlass {
  group: THREE.Group;
  /** How full it is, 0 (drained) to 1 (a fresh dram). */
  fill(level: number): void;
  /** Lets go of its shapes (its materials are every glass's, and so is the whisky's shape). */
  dispose(): void;
}

/** A rocks glass with a dram in it, standing on y = 0, `scale` times life size. */
export function heldGlass(scale = 1): HeldGlass {
  const { r: R, h: H, floor: FLOOR } = GLASS;
  const m = materials();
  const group = new THREE.Group();
  const v = (x: number, y: number) => new THREE.Vector2(x, y);
  // Up the outside, over the rim and down the inside to the base: one lathe.
  const wall = new THREE.Mesh(new THREE.LatheGeometry([v(R - 0.004, 0), v(R - 0.002, 0.003), v(R, H), v(R - 0.003, H), v(R - 0.004, FLOOR + 0.002)], SEGS), m.wall);
  wall.geometry.computeVertexNormals();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.005, R - 0.005, FLOOR, SEGS), m.base);
  base.position.y = FLOOR / 2;
  wall.renderOrder = base.renderOrder = GLASS_ORDER;
  // The whisky stands on the glass's floor; its height is how full the glass is.
  const whisky = dramMesh((dram ??= dramGeometry(WHISKY_SIZES.glassInside, WHISKY_SIZES.dram, SEGS)));
  whisky.position.y = FLOOR + 0.002;
  for (const mesh of [wall, base, whisky]) {
    mesh.castShadow = false;
    group.add(mesh);
  }
  group.scale.setScalar(scale);
  return {
    group,
    fill(level) {
      whisky.visible = level > 0.01;
      whisky.scale.y = Math.max(0.01, level);
    },
    dispose() {
      group.removeFromParent();
      wall.geometry.dispose();
      base.geometry.dispose();
    },
  };
}
