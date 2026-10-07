import * as THREE from 'three';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';

// Rays through big meshes, fast. Three tests a ray against every triangle of every mesh whose bounds it passes
// through, so the crosshair's ray (core: input/pointer.ts) through the street, the lawn or a merged run of walls
// (thousands of triangles, tens of meters across) costs as much near as far. A bounding volume hierarchy
// (three-mesh-bvh) finds the few triangles a ray could hit in a few dozen tests. A big mesh that isn't skinned
// or morphed gets one when a ray first comes near it (wantTree), built a mesh a frame (buildTrees) so nothing
// stalls, and again whenever its positions change. It's built to the side ("indirect"), never touching the
// geometry itself, so the batcher (world/batch), which watches geometry for changes, sees none. Every ray in
// the office goes through it: a mesh with no tree is tested as three always has.

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

/** A mesh with more triangles than this gets a tree. */
const BIG = 400;
/** The version of the positions each tree was built from. */
const builtAt = new WeakMap<THREE.BufferGeometry, number>();
const queue = new Set<THREE.BufferGeometry>();

const triangles = (g: THREE.BufferGeometry) => (g.index ? g.index.count : (g.attributes.position?.count ?? 0)) / 3;
/** How many times a geometry's positions have changed (an interleaved one's buffer's). */
const versionOf = (a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute) => ((a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute ? (a as THREE.InterleavedBufferAttribute).data.version : (a as THREE.BufferAttribute).version);

/** Asks for a tree for `o`'s geometry, if it's a big mesh that keeps its shape: built soon (see buildTrees). */
export function wantTree(o: THREE.Object3D) {
  const m = o as THREE.Mesh;
  if (!m.isMesh || (m as THREE.SkinnedMesh).isSkinnedMesh || (m as THREE.InstancedMesh).isInstancedMesh) return;
  const g = m.geometry;
  if (!g?.attributes.position || Object.keys(g.morphAttributes).length || triangles(g) < BIG) return;
  const at = builtAt.get(g);
  if (at === versionOf(g.attributes.position) && g.boundsTree) return;
  // Its positions changed since its tree was built: that one's wrong now.
  if (g.boundsTree) g.disposeBoundsTree();
  queue.add(g);
}

/** Builds the next tree asked for, if any: one a frame. */
export function buildTrees() {
  const g = queue.values().next().value;
  if (!g) return;
  queue.delete(g);
  const pos = g.attributes.position;
  if (!pos || (g.boundsTree && builtAt.get(g) === versionOf(pos))) return;
  g.computeBoundsTree({ indirect: true, targetLeafSize: 10 });
  builtAt.set(g, versionOf(pos));
}
