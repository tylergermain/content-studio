import * as THREE from 'three';
import { glass as crystal } from '../../world/office/furniture-whisky';
import { toon } from '../../world/toon';

// The rocks glass a dram is held in, built in code (the cabinet's own are whisky.glb's, see
// world/office/furniture-whisky.ts, and look the same): cut crystal with a heavy base, a streak of light
// down it and the whisky in it, which goes down as it's sipped.

/** Its size, as the model's glasses: radius at the rim, height, its solid base, and a full dram's depth. */
const R = 0.041;
const H = 0.085;
const FLOOR = 0.014;
const DRAM = 0.032;

let mats: { wall: THREE.Material; base: THREE.Material; whisky: THREE.Material; glint: THREE.Material } | null = null;
function materials() {
  if (mats) return mats;
  const glint = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide });
  glint.userData.outlineParameters = { visible: false };
  mats = { wall: crystal('#e8f5ff', 0.32), base: crystal('#dcefff', 0.55), whisky: toon('#c8701c', { emissive: '#4a2208' }), glint };
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
  // Up the outside, over the rim and down the inside to the base: one lathe, its facets cut.
  const wall = new THREE.Mesh(new THREE.LatheGeometry([v(R - 0.004, 0), v(R - 0.002, 0.003), v(R, H), v(R - 0.003, H), v(R - 0.004, FLOOR + 0.002)], 12), m.wall);
  wall.geometry.computeVertexNormals();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.005, R - 0.005, FLOOR, 12), m.base);
  base.position.y = FLOOR / 2;
  // A column one metre tall standing on its own foot, so its height is how full the glass is.
  const whisky = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.0045, R - 0.0045, 1, 12).translate(0, 0.5, 0), m.whisky);
  whisky.position.y = FLOOR + 0.002;
  const glint = new THREE.Mesh(new THREE.PlaneGeometry(0.007, H * 0.72), m.glint);
  const a = -0.6;
  glint.position.set(Math.sin(a) * (R + 0.001), H * 0.52, Math.cos(a) * (R + 0.001));
  glint.rotation.y = a;
  for (const mesh of [wall, base, whisky, glint]) {
    mesh.castShadow = false;
    group.add(mesh);
  }
  group.scale.setScalar(scale);
  return {
    group,
    fill(level) {
      whisky.visible = level > 0.01;
      whisky.scale.y = DRAM * Math.max(0.01, level);
    },
    dispose() {
      group.removeFromParent();
      for (const mesh of [wall, base, whisky, glint]) mesh.geometry.dispose();
    },
  };
}
