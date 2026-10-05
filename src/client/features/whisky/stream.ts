/**
 * The whisky running from the decanter's lip into the glass (see world.ts): a thin round stream that
 * leaves the lip the way the neck points and falls into the glass in a curve, thinner where it lands.
 * It runs from the lip to the glass when it starts, and its tail falls in after it at the end. Its
 * shape is written into the same buffers each frame.
 */
import * as THREE from 'three';
import { LIQUID_ORDER, liquid } from '../../world/office/whisky-liquid';

/** Rings along it, and corners round each. */
const RINGS = 9;
const SIDES = 6;
/** How thick it is at the lip, and where it lands. */
const AT_LIP = 0.0034;
const LANDING = 0.0021;

const p = new THREE.Vector3();
const tangent = new THREE.Vector3();
const across = new THREE.Vector3();
const over = new THREE.Vector3();
const out = new THREE.Vector3();
const bend = new THREE.Vector3();
const SIDEWAYS = new THREE.Vector3(1, 0, 0);
const FORWARD = new THREE.Vector3(0, 0, 1);

export class Stream {
  readonly mesh: THREE.Mesh;
  private readonly pos = new Float32Array(RINGS * SIDES * 3);
  private readonly nor = new Float32Array(RINGS * SIDES * 3);

  constructor() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nor, 3).setUsage(THREE.DynamicDrawUsage));
    const index: number[] = [];
    for (let j = 0; j < RINGS - 1; j++)
      for (let i = 0; i < SIDES; i++) {
        const a = j * SIDES + i;
        const b = j * SIDES + ((i + 1) % SIDES);
        index.push(a, b, a + SIDES, b, b + SIDES, a + SIDES);
      }
    g.setIndex(index);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
    this.mesh = new THREE.Mesh(g, liquid().stream);
    this.mesh.renderOrder = LIQUID_ORDER;
    this.mesh.castShadow = false;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
  }

  /**
   * Runs it from `lip`, leaving the way `along` points, to `to` (in its parent's frame), from `from`
   * of the way down it to `until` (0 to 1: the part of it that's running now).
   */
  set(lip: THREE.Vector3, along: THREE.Vector3, to: THREE.Vector3, from: number, until: number) {
    this.mesh.visible = until > from + 0.01;
    if (!this.mesh.visible) return;
    // A curve that leaves the lip along the neck and bends down into the glass.
    bend.copy(lip).addScaledVector(along, Math.min(0.03, lip.distanceTo(to) * 0.35));
    for (let j = 0; j < RINGS; j++) {
      const u = from + ((until - from) * j) / (RINGS - 1);
      const a = (1 - u) * (1 - u);
      const b = 2 * u * (1 - u);
      const c = u * u;
      p.set(0, 0, 0).addScaledVector(lip, a).addScaledVector(bend, b).addScaledVector(to, c);
      tangent
        .set(0, 0, 0)
        .addScaledVector(lip, -2 * (1 - u))
        .addScaledVector(bend, 2 - 4 * u)
        .addScaledVector(to, 2 * u)
        .normalize();
      across.crossVectors(tangent, Math.abs(tangent.x) < 0.9 ? SIDEWAYS : FORWARD).normalize();
      over.crossVectors(tangent, across);
      const r = AT_LIP + (LANDING - AT_LIP) * u;
      for (let i = 0; i < SIDES; i++) {
        const t = (i / SIDES) * Math.PI * 2;
        out.copy(across).multiplyScalar(Math.cos(t)).addScaledVector(over, Math.sin(t));
        const k = (j * SIDES + i) * 3;
        this.nor[k] = out.x;
        this.nor[k + 1] = out.y;
        this.nor[k + 2] = out.z;
        this.pos[k] = p.x + out.x * r;
        this.pos[k + 1] = p.y + out.y * r;
        this.pos[k + 2] = p.z + out.z * r;
      }
    }
    const g = this.mesh.geometry;
    g.getAttribute('position').needsUpdate = true;
    g.getAttribute('normal').needsUpdate = true;
  }
}
