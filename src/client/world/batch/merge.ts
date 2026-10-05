/**
 * Merging the parts of a batch into one geometry, in the world's own coordinates (see batcher.ts): the
 * positions and normals each part's mesh had where it stood, its uvs if its material has a picture, and
 * its colour in every vertex if it's a plain one (as mergeByColor in world/toon.ts does for the
 * scenery). Indexed, with only the vertices each part uses, and a mirrored part's triangles turned back
 * round (three turns a mirrored mesh's faces as it draws it, which a merged one no longer is). Also what
 * a plain batch is drawn with, and a stand-in for one to compile its shader on ahead of time.
 */
import * as THREE from 'three';
import type { AnyMaterial } from './facts';

/** One part of a mesh: the triangles of `geometry` from `start` for `count` (indices, or vertices if it has none), placed by `matrix`. */
export interface MergePart {
  geometry: THREE.BufferGeometry;
  start: number;
  count: number;
  matrix: THREE.Matrix4;
  /** Its plain colour, for a plain batch. */
  color?: THREE.Color;
}

/** What goes in each vertex: uvs, and colour (each part's plain one, the geometry's own, or none). */
export interface MergeOptions {
  uv: boolean;
  color: 'plain' | 'vertex' | null;
}

/** The range of a mesh's geometry its group `g` draws (all of it for -1), as three works it out from the draw range. */
export function rangeOf(geometry: THREE.BufferGeometry, g: number): { start: number; count: number } {
  const total = geometry.index ? geometry.index.count : geometry.attributes.position.count;
  const dr = geometry.drawRange;
  const group = g >= 0 ? geometry.groups[g] : { start: 0, count: Infinity };
  const start = Math.max(group.start, dr.start, 0);
  const end = Math.min(group.start + group.count, dr.start + dr.count, total);
  // Whole triangles only.
  const count = Math.max(0, Math.floor((end - start) / 3) * 3);
  return { start, count };
}

let remap = new Int32Array(0);
const normalMatrix = new THREE.Matrix3();

/** The parts as one geometry. */
export function mergeParts(parts: readonly MergePart[], opts: MergeOptions): THREE.BufferGeometry {
  // First the sizes: each part's vertices (those its triangles use, marked -1 while counted) and its indices.
  let vertices = 0;
  let indices = 0;
  for (const p of parts) {
    const n = p.geometry.attributes.position.count;
    if (remap.length < n) remap = new Int32Array(Math.max(n, remap.length * 2));
    const src = p.geometry.index?.array;
    let used = 0;
    for (let i = p.start; i < p.start + p.count; i++) {
      const v = src ? src[i] : i;
      if (remap[v] === 0) {
        remap[v] = -1;
        used++;
      }
    }
    for (let i = p.start; i < p.start + p.count; i++) remap[src ? src[i] : i] = 0;
    vertices += used;
    indices += p.count;
  }

  const position = new Float32Array(vertices * 3);
  const normal = new Float32Array(vertices * 3);
  const uv = opts.uv ? new Float32Array(vertices * 2) : null;
  const color = opts.color ? new Float32Array(vertices * 3) : null;
  const index = vertices > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);

  let vOut = 0;
  let iOut = 0;
  for (const p of parts) {
    const g = p.geometry;
    const src = g.index?.array;
    const pos = g.attributes.position;
    const nor = g.attributes.normal;
    const tex = opts.uv ? g.attributes.uv : undefined;
    const col = opts.color === 'vertex' ? g.attributes.color : undefined;
    const e = p.matrix.elements;
    normalMatrix.getNormalMatrix(p.matrix);
    const ne = normalMatrix.elements;
    const flip = p.matrix.determinant() < 0;
    // Where each of the part's vertices went, plus one (0: not yet).
    const take = (v: number): number => {
      const at = remap[v];
      if (at > 0) return at - 1;
      const o = vOut++;
      remap[v] = o + 1;
      const x = pos.getX(v);
      const y = pos.getY(v);
      const z = pos.getZ(v);
      position[o * 3] = e[0] * x + e[4] * y + e[8] * z + e[12];
      position[o * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      position[o * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      const nx = nor.getX(v);
      const ny = nor.getY(v);
      const nz = nor.getZ(v);
      let mx = ne[0] * nx + ne[3] * ny + ne[6] * nz;
      let my = ne[1] * nx + ne[4] * ny + ne[7] * nz;
      let mz = ne[2] * nx + ne[5] * ny + ne[8] * nz;
      const len = Math.hypot(mx, my, mz) || 1;
      mx /= len;
      my /= len;
      mz /= len;
      normal[o * 3] = mx;
      normal[o * 3 + 1] = my;
      normal[o * 3 + 2] = mz;
      if (uv && tex) {
        uv[o * 2] = tex.getX(v);
        uv[o * 2 + 1] = tex.getY(v);
      }
      if (color) {
        if (col) {
          color[o * 3] = col.getX(v);
          color[o * 3 + 1] = col.getY(v);
          color[o * 3 + 2] = col.getZ(v);
        } else if (p.color) {
          color[o * 3] = p.color.r;
          color[o * 3 + 1] = p.color.g;
          color[o * 3 + 2] = p.color.b;
        }
      }
      return o;
    };
    for (let i = p.start; i < p.start + p.count; i += 3) {
      const a = take(src ? src[i] : i);
      const b = take(src ? src[i + 1] : i + 1);
      const c = take(src ? src[i + 2] : i + 2);
      index[iOut++] = a;
      index[iOut++] = flip ? c : b;
      index[iOut++] = flip ? b : c;
    }
    // Ready for the next part (the same geometry may come again, placed elsewhere).
    for (let i = p.start; i < p.start + p.count; i++) remap[src ? src[i] : i] = 0;
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(position, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  if (uv) out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (color) out.setAttribute('color', new THREE.BufferAttribute(color, 3));
  out.setIndex(new THREE.BufferAttribute(index, 1));
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

/** A plain batch's material: the plain one it was made from, white, coloured by its vertices. */
export function plainMaterial(from: THREE.Material): THREE.Material {
  const m = from.clone() as AnyMaterial;
  m.color?.setRGB(1, 1, 1);
  m.vertexColors = true;
  m.name = `batched ${from.name}`.trim();
  return m;
}

/**
 * A stand-in for a merged mesh drawn with `material`: one triangle with what a merged one has in its
 * vertices (positions, normals, colours), for compiling the material's shader before any is drawn
 * (three picks a shader by the material and by what the geometry has, so this one is the batch's).
 */
export function probeOf(material: THREE.Material): THREE.Mesh {
  const g = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'color']) g.setAttribute(name, new THREE.BufferAttribute(new Float32Array(9), 3));
  return new THREE.Mesh(g, material);
}
