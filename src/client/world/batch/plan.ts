/**
 * Which of the office's meshes are drawn together, and in which batch (see batcher.ts): the pure half,
 * with no three.js in it, so tests/batch.test.ts reads it as it is.
 *
 * A mesh that never moves or changes is drawn with the others of its kind near it, as one merged mesh: a
 * few draw calls for a part of the room instead of hundreds. Its kind is what it's drawn with: one
 * plain colour on a lit or unlit material with no picture and no glow (the colour kept in the merged
 * mesh's vertices, as mergeByColor does for the scenery), or else the very material it has, so
 * whatever changes it (the sky turning a lamp's glow up at dusk) changes the merged mesh too. Near it is its
 * region, a cell of the building CELL metres across and BAND high, so what's out of view is still left
 * out by the camera. What's see-through, drawn in an order of its own, skinned, instanced or drawn with
 * a trick of its own is never batched; whether something moves or changes, batcher.ts finds out by
 * watching it.
 */

/** How wide and deep a region is, in metres. */
export const CELL = 8;
/** How high a region is: about a storey, so the street, the office floor and its deck are apart. */
export const BAND = 4;
/** A part bigger than this (its bounding sphere's radius) is in no one cell: it goes in its kind's 'big' region. */
export const BIG = 6;

/** The region a part is in, by the middle of its bounding sphere in the world and its radius. */
export function regionKey(x: number, y: number, z: number, radius: number): string {
  if (radius > BIG) return 'big';
  return `${Math.floor(x / CELL)},${Math.floor(y / BAND)},${Math.floor(z / CELL)}`;
}

/** What batching needs to know of a material (see factsOf in batcher.ts). */
export interface MaterialFacts {
  /** Which material it is (its uuid). */
  id: string;
  type: string;
  visible: boolean;
  transparent: boolean;
  /** Normal blending (three's NormalBlending, 1), the only one an opaque mesh is drawn with. */
  blending: number;
  depthTest: boolean;
  depthWrite: boolean;
  colorWrite: boolean;
  wireframe: boolean;
  /** alphaHash, alphaToCoverage or clipping planes: drawn in a way of its own. */
  special: boolean;
  /** It has a picture of some kind (a map, a bump, an environment...), besides the toon's own shading ramp. */
  textured: boolean;
  /** It colours by its vertices already. */
  vertexColors: boolean;
  /** It glows (its emissive colour isn't black): a lamp, a window at night, which the sky turns up and down. */
  glows: boolean;
  /** Everything else that says how it looks, as text (its side, its glow, its outline...): one plain kind each. */
  look: string;
}

/** The kinds of material whose meshes can be one merged mesh whatever their colour: lit or unlit, with no picture. */
const PLAIN = new Set(['MeshToonMaterial', 'MeshBasicMaterial', 'MeshLambertMaterial']);

/**
 * The kind a material draws with, for batching: `plain` (one colour each, kept in the vertices) with
 * the rest of its look as the key, or its own material (the key is its id); null for one that's never
 * batched (see-through, drawn in an order of its own, or not drawn at all).
 */
export function materialKind(m: MaterialFacts): { key: string; plain: boolean } | null {
  if (!m.visible || m.transparent || m.blending !== 1 || !m.depthTest || !m.depthWrite || !m.colorWrite || m.wireframe || m.special) return null;
  if (PLAIN.has(m.type) && !m.textured && !m.vertexColors && !m.glows) return { key: `plain|${m.type}|${m.look}`, plain: true };
  return { key: `own|${m.id}`, plain: false };
}

/** What batching needs to know of a mesh, and of its geometry (see factsOf in batcher.ts). */
export interface MeshFacts {
  /** A plain Mesh: not skinned, instanced or batched already, not a line, points or a sprite. */
  mesh: boolean;
  /** On layer 0 alone, as everything the office draws is. */
  layers: number;
  frustumCulled: boolean;
  renderOrder: number;
  /** The renderOrder of the nearest Group over it, which three sorts by before its own. */
  groupOrder: number;
  /** It does something of its own as it's drawn (onBeforeRender). */
  hooked: boolean;
  /** Said to stay as it is (userData.noBatch, on it or over it). */
  kept: boolean;
  castShadow: boolean;
  receiveShadow: boolean;
  /** Its geometry has normals, uvs, vertex colours, and anything else (morphs, skinning, a second uv...). */
  normals: boolean;
  uvs: boolean;
  colors: boolean;
  extra: boolean;
}

/** Why a mesh is never batched, or null if it could be (when its materials can). */
export function meshVeto(m: MeshFacts): string | null {
  if (!m.mesh) return 'not a plain mesh';
  if (m.kept) return 'kept as it is';
  if (m.layers !== 1) return 'on a layer of its own';
  if (!m.frustumCulled) return 'never culled';
  if (m.renderOrder !== 0 || m.groupOrder !== 0) return 'drawn in an order of its own';
  if (m.hooked) return 'draws itself';
  if (!m.normals) return 'no normals';
  if (m.extra) return 'more to its geometry than a merged mesh keeps';
  return null;
}

/** One part of a mesh to batch: the whole of a single-material mesh, or one group of a multi-material one. */
export interface PartPlan {
  /** Which mesh, and which of its groups (-1 for the whole of it). */
  mesh: number;
  group: number;
  kind: { key: string; plain: boolean };
  /** Whether its material needs the geometry's uvs (it has a picture), and the geometry has them. */
  needsUv: boolean;
  hasUv: boolean;
  /** Whether its geometry colours its vertices (and its material uses them). */
  colored: boolean;
  castShadow: boolean;
  receiveShadow: boolean;
  region: string;
}

/** The batch a part goes in. Two parts in the same one are drawn together. */
export function batchKey(p: PartPlan): string {
  return `${p.kind.key}|${p.castShadow ? 'c' : '-'}${p.receiveShadow ? 'r' : '-'}|${p.colored ? 'v' : '-'}|${p.region}`;
}

/** Whether a part can be merged at all: one with a picture needs its uvs. */
export function partOk(p: PartPlan): boolean {
  return !p.needsUv || p.hasUv;
}

/**
 * The batches, from the parts of the meshes that can be batched (each mesh all of its parts, or none):
 * every key with its parts. A single-material mesh alone in its batch gains nothing and is left to
 * draw itself; a multi-material mesh's parts are all batched however few share their batch, since the
 * mesh can only stop drawing itself as a whole.
 */
export function planBatches(parts: readonly PartPlan[]): Map<string, PartPlan[]> {
  const meshes = new Map<number, PartPlan[]>();
  for (const p of parts) {
    const list = meshes.get(p.mesh);
    if (list) list.push(p);
    else meshes.set(p.mesh, [p]);
  }
  const out = new Map<string, PartPlan[]>();
  for (const list of meshes.values()) {
    if (!list.every(partOk)) continue;
    for (const p of list) {
      const key = batchKey(p);
      const batch = out.get(key);
      if (batch) batch.push(p);
      else out.set(key, [p]);
    }
  }
  // Alone in its batch, a part is worth it only as one of a multi-material mesh (whose group is 0 or
  // more): dropping the others leaves every mesh still all in or all out.
  for (const [key, list] of out) if (list.length === 1 && list[0].group < 0) out.delete(key);
  return out;
}
