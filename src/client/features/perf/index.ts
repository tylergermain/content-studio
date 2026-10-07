/**
 * The office drawn as fast as it can be on a laptop or a desktop, and looking the same. Glass is drawn in one
 * pass where that looks the same (sweepGlass), and the office's still meshes are batched (core/office-batcher.ts,
 * world/batch: a floor's thousands of draw calls down to a few hundred), drawn exactly as they were. Everything
 * else is as it always is: the toon outline, the sun's shadows every frame, every lamp, the scenery out to the
 * haze and the pictures at full size. A headset's page batches as its own quality profile says (features/vr),
 * and a VR session's profile puts batching back as it found it. ?batch=0 in the address leaves it off, to compare.
 */
import * as THREE from 'three';
import type { Ctx } from '../../core/context';
import type { Parts } from '../../core/parts';
import { officeBatcher } from '../../core/office-batcher';

/** How often the scene is looked over for new glass (ms), besides whenever the floor's furniture changes. */
const SWEEP_MS = 3000;

/** Whether a mesh's geometry is flat: no thickness at all along one of its axes (a pane, a sign, a plane). */
function flat(g: THREE.BufferGeometry): boolean {
  if (!g.boundingBox) g.computeBoundingBox();
  const b = g.boundingBox;
  if (!b) return false;
  return b.max.x - b.min.x < 1e-4 || b.max.y - b.min.y < 1e-4 || b.max.z - b.min.z < 1e-4;
}

/**
 * Glass and the like drawn in one pass rather than two. Three draws a see-through material that's seen from
 * both sides twice over, its back faces and then its front, so the near side of a closed shape blends over
 * the far side; and it marks the material changed each time, so every pane of glass costs it its shader
 * program worked out twice a frame. A flat pane has no far side of its own to go behind, so drawn in one
 * pass it looks just the same: every such material that's only ever on flat meshes is (forceSinglePass), and
 * so is one whose drawing order can't show (see evenly). Anything else see-through with depth to it is left
 * drawing twice.
 */
export function sweepGlass(scene: THREE.Object3D, judged: WeakMap<THREE.Material, boolean>) {
  const seen = new Map<THREE.Material, boolean>();
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry) return;
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      if (!mat || !mat.transparent || mat.side !== THREE.DoubleSide || mat.forceSinglePass || judged.get(mat) === false) continue;
      seen.set(mat, (seen.get(mat) ?? true) && flat(m.geometry));
    }
  });
  for (const [mat, onlyFlat] of seen) {
    const ok = onlyFlat || evenly(mat);
    judged.set(mat, ok);
    if (ok) mat.forceSinglePass = true;
  }
}

/**
 * Whether drawing `mat` over itself comes out the same in any order: unlit, one color all over (no picture,
 * no colors per vertex) and not hiding what's behind it (no depth written). The same color laid over itself
 * twice is the same color whichever goes first, so merged panes of glass (world/batch) look just as they did.
 */
function evenly(mat: THREE.Material): boolean {
  const b = mat as THREE.MeshBasicMaterial;
  return !!b.isMeshBasicMaterial && !b.map && !b.alphaMap && !b.vertexColors && !mat.depthWrite;
}

export function installPerf(ctx: Ctx, parts: Pick<Parts, 'stage' | 'rooftop'>) {
  // Glass in one pass, everywhere (headsets too): see sweepGlass.
  const judged = new WeakMap<THREE.Material, boolean>();
  let swept = { at: -Infinity, version: -1 };
  ctx.ticks.add('pre', ({ now }) => {
    const version = ctx.office.furniture.version;
    if (now - swept.at < SWEEP_MS && version === swept.version) return;
    swept = { at: now, version };
    sweepGlass(ctx.scene, judged);
  });
  // A headset's page has a quality profile of its own, which says whether it batches (features/vr).
  if (/\bQuest\b|OculusBrowser/i.test(navigator.userAgent) || /[?&]batch=0\b/.test(location.search)) return;
  officeBatcher(ctx, parts).enable(true);
}
