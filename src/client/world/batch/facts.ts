/**
 * What batching reads of a material and of a mesh (see plan.ts, which decides from it, and batcher.ts):
 * everything that would make a merged mesh draw differently from the meshes it's made of.
 */
import * as THREE from 'three';
import type { MaterialFacts, MeshFacts } from './plan';

const PLAIN_MATS = new Set(['MeshToonMaterial', 'MeshBasicMaterial', 'MeshLambertMaterial']);
const MAPS = ['map', 'alphaMap', 'lightMap', 'aoMap', 'emissiveMap', 'bumpMap', 'normalMap', 'displacementMap', 'specularMap', 'envMap', 'matcap'] as const;
/** Maps a merged mesh can't keep (they need more of the geometry than it has, or another uv). */
const SPECIAL_MAPS = new Set(['lightMap', 'aoMap', 'bumpMap', 'normalMap', 'displacementMap']);

export type AnyMaterial = THREE.Material & Partial<Record<(typeof MAPS)[number], THREE.Texture | null>> & {
  color?: THREE.Color;
  emissive?: THREE.Color;
  emissiveIntensity?: number;
  gradientMap?: THREE.Texture | null;
  flatShading?: boolean;
  fog?: boolean;
  wireframe?: boolean;
  defines?: Record<string, unknown>;
};

/** What plan.ts needs to know of a material. */
export function materialFacts(m: AnyMaterial): MaterialFacts {
  let textured = false;
  let special = !!(m.alphaHash || m.alphaToCoverage || (m.clippingPlanes && m.clippingPlanes.length) || m.stencilWrite);
  for (const k of MAPS) {
    const t = m[k];
    if (!t) continue;
    textured = true;
    if (SPECIAL_MAPS.has(k) || t.channel !== 0) special = true;
  }
  // A shader of its own, or bits added to one, isn't the material as a copy of it would be.
  if (m.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile || m.customProgramCacheKey !== THREE.Material.prototype.customProgramCacheKey) special = true;
  if ((m as THREE.ShaderMaterial).isShaderMaterial) special = true;
  const look = [
    m.side,
    m.flatShading ? 'flat' : '',
    m.fog === false ? 'nofog' : '',
    m.toneMapped ? '' : 'raw',
    m.emissive ? `e${m.emissive.getHexString()}x${m.emissiveIntensity ?? 1}` : '',
    PLAIN_MATS.has(m.type) && 'gradientMap' in m ? `g${m.gradientMap?.uuid ?? '-'}` : '',
    m.alphaTest ? `a${m.alphaTest}` : '',
    m.polygonOffset ? `o${m.polygonOffsetFactor},${m.polygonOffsetUnits}` : '',
    m.dithering ? 'd' : '',
    m.depthFunc,
    m.shadowSide ?? '',
    JSON.stringify(m.userData.outlineParameters ?? null),
    // The toon's own TOON, and anything added to it.
    JSON.stringify(m.defines ?? null),
  ].join('|');
  return {
    id: m.uuid,
    type: m.type,
    visible: m.visible,
    transparent: m.transparent,
    blending: m.blending,
    depthTest: m.depthTest,
    depthWrite: m.depthWrite,
    colorWrite: m.colorWrite,
    wireframe: !!m.wireframe,
    special,
    textured,
    vertexColors: m.vertexColors,
    glows: !!m.emissive && m.emissive.getHex() !== 0,
    look,
  };
}

/** What plan.ts needs to know of a mesh, given what's over it (`kept`, `groupOrder`). */
export function meshFacts(o: THREE.Mesh, kept: boolean, groupOrder: number): MeshFacts {
  const g = o.geometry;
  const attrs = g?.attributes ?? {};
  const mesh = !!o.isMesh && !(o as THREE.SkinnedMesh).isSkinnedMesh && !(o as THREE.InstancedMesh).isInstancedMesh && !(o as unknown as THREE.BatchedMesh).isBatchedMesh && !!g?.attributes;
  return {
    mesh,
    layers: o.layers.mask,
    frustumCulled: o.frustumCulled,
    renderOrder: o.renderOrder,
    groupOrder,
    hooked: o.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender || o.onAfterRender !== THREE.Object3D.prototype.onAfterRender,
    kept,
    castShadow: o.castShadow,
    receiveShadow: o.receiveShadow,
    normals: !!attrs.normal && attrs.normal.itemSize === 3,
    uvs: !!attrs.uv && attrs.uv.itemSize === 2,
    colors: !!attrs.color && attrs.color.itemSize === 3,
    extra: !attrs.position || attrs.position.itemSize !== 3 || Object.keys(g?.morphAttributes ?? {}).length > 0 || !!attrs.skinIndex,
  };
}
