import * as THREE from 'three';
import { toon } from '../toon';

// Whisky as it looks in glass, for the whisky cabinet (furniture-whisky.ts) and what features/whisky
// pours: a deep amber you can see a little way into, darker the deeper it is, under a lighter gold
// surface that lies level. It's drawn before the glass round it (LIQUID_ORDER, GLASS_ORDER), so the
// glass's tint and edge are over it, as they would be.

/** The order the whisky and the glass round it are drawn in, among the see-through things: the whisky first. */
export const LIQUID_ORDER = 1;
export const GLASS_ORDER = 2;

/** Its colours: at the bottom of a glass, where the light's come through the most of it, part way up, and its surface. */
export const AMBER = { deep: new THREE.Color('#8e3806'), mid: new THREE.Color('#c46a14'), top: '#dc9a3e' } as const;
/** How much of what's behind it shows through: a little. */
const OPACITY = 0.88;

let mats: { side: THREE.MeshToonMaterial; shaded: THREE.MeshToonMaterial; top: THREE.MeshToonMaterial; stream: THREE.MeshToonMaterial } | null = null;

/**
 * The whisky's materials, shared by every glass of it: `side` coloured by its vertices (deeper toward
 * the bottom, see dramGeometry), `shaded` the same amber all over (the bottle's, which has no vertex
 * colours), `top` its surface, and `stream` the thin run of it from the decanter's lip.
 */
export function liquid() {
  if (mats) return mats;
  const side = toon('#ffffff', { emissive: '#2c1303' }).clone();
  side.vertexColors = true;
  const shaded = toon('#b85c0a', { emissive: '#4a1c00' }).clone();
  const top = toon(AMBER.top, { emissive: '#4a2c0a' }).clone();
  const stream = toon('#c27c2e', { emissive: '#3c1a02' }).clone();
  for (const m of [side, shaded, top, stream]) {
    m.transparent = true;
    m.opacity = OPACITY;
    m.userData.outlineParameters = { visible: false };
  }
  top.opacity = 0.86;
  stream.opacity = 0.9;
  // A faint line round the whisky's sides, so its edge shows through the glass.
  side.userData.outlineParameters = shaded.userData.outlineParameters = { color: [0.38, 0.18, 0.04], alpha: 0.55, thickness: 0.0018 };
  mats = { side, shaded, top, stream };
  return mats;
}

/** The colour whisky `depth` metres under its surface looks, into `out`. */
export function amberAt(depth: number, out: THREE.Color): THREE.Color {
  const k = Math.min(1, Math.max(0, depth / 0.09));
  return out.copy(AMBER.mid).lerp(AMBER.deep, k);
}

/**
 * A dram in a rocks glass: a round column `r` across and `depth` deep standing on y = 0 (the glass's
 * floor), its sides deeper amber toward the bottom (group 0) and its surface a lighter gold (group 1).
 * Scaling it in y fills the glass that far.
 */
export function dramGeometry(r: number, depth: number, segs = 24): THREE.BufferGeometry {
  const rows = [0, 0.45, 0.85, 1];
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const c = new THREE.Color();
  for (const k of rows) {
    // Lighter toward the top, as the depth of it under the surface shrinks.
    amberAt((1 - k) * depth * 1.6 + 0.004, c);
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      pos.push(Math.sin(a) * r, k * depth, Math.cos(a) * r);
      nor.push(Math.sin(a), 0, Math.cos(a));
      col.push(c.r, c.g, c.b);
    }
  }
  const index: number[] = [];
  const w = segs + 1;
  for (let j = 0; j < rows.length - 1; j++)
    for (let i = 0; i < segs; i++) {
      const a = j * w + i;
      index.push(a, a + 1, a + w, a + 1, a + w + 1, a + w);
    }
  const sides = index.length;
  // The surface: a fan from its middle, facing up.
  const mid = pos.length / 3;
  pos.push(0, depth, 0);
  nor.push(0, 1, 0);
  col.push(1, 1, 1);
  const ring = mid + 1;
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    pos.push(Math.sin(a) * r, depth, Math.cos(a) * r);
    nor.push(0, 1, 0);
    col.push(1, 1, 1);
  }
  for (let i = 0; i < segs; i++) index.push(mid, ring + i, ring + i + 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(index);
  g.addGroup(0, sides, 0);
  g.addGroup(sides, index.length - sides, 1);
  return g;
}

/** A dram as a mesh (see dramGeometry), drawn before the glass it's in and casting no shadow. */
export function dramMesh(geometry: THREE.BufferGeometry): THREE.Mesh {
  const m = liquid();
  const mesh = new THREE.Mesh(geometry, [m.side, m.top]);
  mesh.renderOrder = LIQUID_ORDER;
  mesh.castShadow = false;
  return mesh;
}
