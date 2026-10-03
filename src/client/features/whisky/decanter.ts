/**
 * The whisky in a decanter (see world.ts): whichever way the decanter is tipped, it lies level, filling
 * the bottom of it however that lies now. Lifted and tipped over a glass, it runs down toward the
 * neck, and as the dram goes out of it there's less. It's the inside of the decanter cut through by a
 * level plane at the height that holds as much as there is: the sides below the plane in a deeper amber
 * the deeper they are, and the plane itself, the surface, a lighter gold. Nothing is made anew as it
 * moves: the shape is written into the same buffers.
 */
import * as THREE from 'three';
import { LIQUID_ORDER, amberAt, liquid } from '../../world/office/whisky-liquid';

/** The inside of the decanter, [radius, height over its foot], from its floor up into its neck (within whisky.glb's glass). */
export const INSIDE: readonly (readonly [number, number])[] = [
  [0, 0.0145],
  [0.052, 0.0145],
  [0.0535, 0.03],
  [0.0545, 0.128],
  [0.047, 0.155],
  [0.028, 0.177],
  [0.014, 0.188],
  [0.012, 0.216],
  [0, 0.216],
];
/** How high the whisky in it comes, standing on the tray (as whisky.glb has it): about half full. */
export const REST_LEVEL = 0.088;
const SEGS = 16;
const UP = new THREE.Vector3(0, 1, 0);

const v0 = new THREE.Vector3();
const cut1 = new THREE.Vector3();
const cut2 = new THREE.Vector3();
const n1 = new THREE.Vector3();
const n2 = new THREE.Vector3();
const crossed = new THREE.Vector3();
const color = new THREE.Color();

export class DecanterWhisky {
  readonly mesh: THREE.Mesh;
  /** All it holds, full to the neck (cubic metres, in the decanter's own frame). */
  readonly total: number;
  /** The inside's corners and their normals, and its triangles (three corners each, wound outward). */
  private readonly at: THREE.Vector3[] = [];
  private readonly normal: THREE.Vector3[] = [];
  private readonly tris: number[] = [];
  private readonly pos: Float32Array;
  private readonly nor: Float32Array;
  private readonly col: Float32Array;
  private readonly geometry = new THREE.BufferGeometry();
  /** Where the surface's edge runs, as the last cut found it: each pair a stretch of it, wound round the surface. */
  private readonly edge: THREE.Vector3[] = [];
  private laid = { x: NaN, y: NaN, z: NaN, fill: NaN };

  constructor() {
    // The inside, turned: a ring of corners at each height (a single one where it closes), wound outward.
    const rings: number[][] = [];
    for (const [r, h] of INSIDE) {
      const ring: number[] = [];
      for (let i = 0; i < (r > 0 ? SEGS : 1); i++) {
        const a = (i / SEGS) * Math.PI * 2;
        ring.push(this.at.push(new THREE.Vector3(Math.sin(a) * r, h, Math.cos(a) * r)) - 1);
        this.normal.push(new THREE.Vector3());
      }
      rings.push(ring);
    }
    for (let j = 0; j < rings.length - 1; j++) {
      const lo = rings[j];
      const hi = rings[j + 1];
      for (let i = 0; i < SEGS; i++) {
        const a = lo[i % lo.length];
        const b = lo[(i + 1) % lo.length];
        const c = hi[(i + 1) % hi.length];
        const d = hi[i % hi.length];
        if (a !== b) this.tris.push(a, b, d);
        if (c !== d) this.tris.push(b, c, d);
      }
    }
    // Smooth normals: each corner's faces, weighted by their size.
    for (let t = 0; t < this.tris.length; t += 3) {
      const [a, b, c] = [this.at[this.tris[t]], this.at[this.tris[t + 1]], this.at[this.tris[t + 2]]];
      crossed.subVectors(b, a).cross(v0.subVectors(c, a));
      for (let k = 0; k < 3; k++) this.normal[this.tris[t + k]].add(crossed);
    }
    for (const n of this.normal) n.normalize();
    // At most every triangle cut in two, and a triangle of the surface for each.
    const most = (this.tris.length / 3) * 3 * 3;
    this.pos = new Float32Array(most * 3);
    this.nor = new Float32Array(most * 3);
    this.col = new Float32Array(most * 3);
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('normal', new THREE.BufferAttribute(this.nor, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.addGroup(0, 0, 0);
    this.geometry.addGroup(0, 0, 1);
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.11, 0), 0.14);
    for (let i = 0; i < (this.tris.length / 3) * 2; i++) this.edge.push(new THREE.Vector3());
    this.total = this.cut(UP, Infinity, false);
    const m = liquid();
    this.mesh = new THREE.Mesh(this.geometry, [m.side, m.top]);
    this.mesh.renderOrder = LIQUID_ORDER;
    this.mesh.castShadow = false;
    this.mesh.name = 'whisky_decanter_level';
  }

  /** How much of all it holds is in it with the whisky up to `level` standing upright (0 to 1). */
  fillAt(level: number): number {
    return this.cut(UP, level, false) / this.total;
  }

  /**
   * How high the surface is, measured along `up` (the world's up, in the decanter's own frame), when
   * it holds `fill` of all it can: the height where what's under it is that much.
   */
  level(up: THREE.Vector3, fill: number): number {
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of this.at) {
      const h = up.dot(p);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    if (fill <= 0) return lo;
    if (fill >= 1) return hi;
    const want = fill * this.total;
    for (let i = 0; i < 22; i++) {
      const mid = (lo + hi) / 2;
      if (this.cut(up, mid, false) < want) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }

  /** Lays it level for `up` (the world's up in the decanter's own frame, a unit vector) holding `fill` of all it can. */
  lay(up: THREE.Vector3, fill: number) {
    const l = this.laid;
    if (Math.abs(up.x - l.x) < 1e-5 && Math.abs(up.y - l.y) < 1e-5 && Math.abs(up.z - l.z) < 1e-5 && Math.abs(fill - l.fill) < 1e-5) return;
    Object.assign(l, { x: up.x, y: up.y, z: up.z, fill });
    this.mesh.visible = fill > 0.002;
    if (!this.mesh.visible) return;
    this.cut(up, this.level(up, fill), true);
  }

  /** Writes corner `p` of a triangle of it, its normal `q`, `depth` under the surface (or the surface's own, -1). */
  private put(n: number, p: THREE.Vector3, q: THREE.Vector3, depth: number) {
    const k = n * 3;
    this.pos[k] = p.x;
    this.pos[k + 1] = p.y;
    this.pos[k + 2] = p.z;
    this.nor[k] = q.x;
    this.nor[k + 1] = q.y;
    this.nor[k + 2] = q.z;
    if (depth >= 0) amberAt(depth, color);
    else color.setRGB(1, 1, 1);
    this.col[k] = color.r;
    this.col[k + 1] = color.g;
    this.col[k + 2] = color.b;
  }

  /**
   * Cuts the inside through with the plane `up`·p = `level`, keeping what's under it: its volume, and
   * (with `write`) the shape itself into the mesh's buffers.
   */
  private cut(up: THREE.Vector3, level: number, write: boolean): number {
    const { at, tris, normal, edge } = this;
    let volume = 0;
    let n = 0;
    let edges = 0;
    const emit = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, na: THREE.Vector3, nb: THREE.Vector3, nc: THREE.Vector3) => {
      volume += a.dot(crossed.crossVectors(b, c)) / 6;
      if (!write) return;
      this.put(n++, a, na, level - up.dot(a));
      this.put(n++, b, nb, level - up.dot(b));
      this.put(n++, c, nc, level - up.dot(c));
    };
    /** Where the plane crosses from corner i (height over it si) to corner j (sj), into `out`, and the normal there into `nOut`. */
    const cross = (i: number, si: number, j: number, sj: number, out: THREE.Vector3, nOut: THREE.Vector3) => {
      const k = si / (si - sj);
      out.lerpVectors(at[i], at[j], k);
      nOut.lerpVectors(normal[i], normal[j], k).normalize();
    };
    for (let t = 0; t < tris.length; t += 3) {
      const i0 = tris[t];
      const i1 = tris[t + 1];
      const i2 = tris[t + 2];
      const s0 = up.dot(at[i0]) - level;
      const s1 = up.dot(at[i1]) - level;
      const s2 = up.dot(at[i2]) - level;
      const count = (s0 <= 0 ? 1 : 0) + (s1 <= 0 ? 1 : 0) + (s2 <= 0 ? 1 : 0);
      if (count === 0) continue;
      if (count === 3) {
        emit(at[i0], at[i1], at[i2], normal[i0], normal[i1], normal[i2]);
        continue;
      }
      // Turned so the odd one out is first: the one under (one under), or the one over (two under).
      const odd = count === 1 ? (s0 <= 0 ? 0 : s1 <= 0 ? 1 : 2) : s0 > 0 ? 0 : s1 > 0 ? 1 : 2;
      const a = odd === 0 ? i0 : odd === 1 ? i1 : i2;
      const b = odd === 0 ? i1 : odd === 1 ? i2 : i0;
      const c = odd === 0 ? i2 : odd === 1 ? i0 : i1;
      const sa = odd === 0 ? s0 : odd === 1 ? s1 : s2;
      const sb = odd === 0 ? s1 : odd === 1 ? s2 : s0;
      const sc = odd === 0 ? s2 : odd === 1 ? s0 : s1;
      cross(a, sa, b, sb, cut1, n1);
      cross(c, sc, a, sa, cut2, n2);
      // The surface's edge runs the other way round from the sides' edge along it.
      if (count === 1) {
        // a under: the corner of it at a.
        emit(at[a], cut1, cut2, normal[a], n1, n2);
        edge[edges++].copy(cut2);
        edge[edges++].copy(cut1);
      } else {
        // a over: the rest of it, b and c under.
        emit(cut1, at[b], at[c], n1, normal[b], normal[c]);
        emit(cut1, at[c], cut2, n1, normal[c], n2);
        edge[edges++].copy(cut1);
        edge[edges++].copy(cut2);
      }
    }
    // The surface: what it adds to the volume (it lies on the plane, its outward side up), and a fan of it from its middle.
    let rim = 0;
    v0.set(0, 0, 0);
    for (let e = 0; e < edges; e += 2) {
      rim += up.dot(crossed.crossVectors(edge[e], edge[e + 1]));
      v0.add(edge[e]);
    }
    if (edges) volume += (level * rim) / 6;
    if (!write) return volume;
    const sides = n;
    if (edges) v0.divideScalar(edges / 2);
    for (let e = 0; e < edges; e += 2) {
      this.put(n++, v0, up, -1);
      this.put(n++, edge[e], up, -1);
      this.put(n++, edge[e + 1], up, -1);
    }
    const [side, top] = this.geometry.groups;
    side.count = sides;
    top.start = sides;
    top.count = n - sides;
    this.geometry.setDrawRange(0, n);
    for (const name of ['position', 'normal', 'color'] as const) {
      const attr = this.geometry.getAttribute(name) as THREE.BufferAttribute;
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, n * 3);
      attr.needsUpdate = true;
    }
    return volume;
  }
}

