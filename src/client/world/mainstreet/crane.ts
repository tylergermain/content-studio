import * as THREE from 'three';
import { CRANE } from '../../../shared/mainstreet';
import { mergeByMaterial, mesh, toon } from '../toon';
import type { StreetKit } from './kit';
import { CRANE_YARD, type CraneMotion } from './layout';

// A building site's tower crane, in toon yellow: a lattice mast on a concrete footing in a fenced yard,
// and on top of it, flat-topped (nothing over the jib, so all of it stays inside the solids Friday One
// keeps clear of, see businessBoxes), the part that slews round: the jib out one way with its trolley
// and hook, the counter-jib the other with its concrete counterweights, and the operator's cab. Red
// lights on the jib's tip and the counter-jib's end, for the helicopter at night.

/** Where the mast stops and the slewing part sits on it (over the street), and how wide the mast is. */
const MAST_TOP = 31.6;
const SLEW_Y = 32.1;
const MAST_W = 1.7;
/** The jib's chords: the two along its bottom (half as far apart), and the one along its top, over the slewing ring. */
const JIB_SIDE = 0.55;
const JIB_LOW = 0.1;
const JIB_HIGH = 1.3;

/** The parts of a crane that move: the slewing part, the trolley out along the jib, and the hook block with its cables. */
export interface CraneView {
  group: THREE.Group;
  /** Puts it where it is in its round (see craneMotion). */
  pose(m: CraneMotion): void;
  dispose(): void;
}

const UP = new THREE.Vector3(0, 1, 0);

/** A square bar `t` thick from `a` to `b`, into `into`. */
function bar(into: THREE.Group, a: THREE.Vector3, b: THREE.Vector3, t: number, mat: THREE.Material) {
  const d = new THREE.Vector3().subVectors(b, a);
  const m = mesh(new THREE.BoxGeometry(t, d.length(), t), mat, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2, false);
  m.quaternion.setFromUnitVectors(UP, d.normalize());
  into.add(m);
}

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** A tower crane, its mast's foot at the group's origin (on the street). */
export function buildCrane(kit: StreetKit): CraneView {
  const yellow = toon('#f4c430');
  const ink = toon('#2b2d42');
  const concrete = toon('#c4c7cc');
  const white = toon('#f5f6f2');
  const group = new THREE.Group();

  // The footing, the fence round the yard, and the mast: four chords, braced across each face.
  const still = new THREE.Group();
  still.add(mesh(new THREE.BoxGeometry(4.2, 0.8, 4.2), concrete, 0, 0.4, 0));
  const y = CRANE_YARD;
  for (const [x0, z0, x1, z1] of [
    [-y, -y, y, -y],
    [y, -y, y, y],
    [y, y, -y, y],
    [-y, y, -y, -y],
  ]) {
    for (const h of [0.55, 1.1]) bar(still, v(x0, h, z0), v(x1, h, z1), 0.05, yellow);
    for (let k = 0; k < 4; k++) still.add(mesh(new THREE.BoxGeometry(0.07, 1.15, 0.07), ink, x0 + ((x1 - x0) * k) / 4, 0.575, z0 + ((z1 - z0) * k) / 4, false));
  }
  const half = MAST_W / 2;
  const foot = 0.8;
  const n = 16;
  const step = (MAST_TOP - foot) / n;
  for (const [cx, cz] of [
    [-half, -half],
    [half, -half],
    [half, half],
    [-half, half],
  ])
    bar(still, v(cx, foot, cz), v(cx, MAST_TOP, cz), 0.16, yellow);
  for (let k = 0; k < n; k++) {
    const y0 = foot + k * step;
    const y1 = y0 + step;
    const s = k % 2 ? 1 : -1;
    for (const [ax, az, bx, bz] of [
      [-half, half, half, half],
      [half, half, half, -half],
      [half, -half, -half, -half],
      [-half, -half, -half, half],
    ]) {
      bar(still, v(ax, y1, az), v(bx, y1, bz), 0.08, yellow);
      bar(still, s > 0 ? v(ax, y0, az) : v(bx, y0, bz), s > 0 ? v(bx, y1, bz) : v(ax, y1, az), 0.07, yellow);
    }
  }
  still.add(mesh(new THREE.CylinderGeometry(1.15, 1.15, SLEW_Y - MAST_TOP, 16), ink, 0, (MAST_TOP + SLEW_Y) / 2, 0));
  group.add(mergeByMaterial(still));

  // What slews round on top: the jib along +z, the counter-jib along -z.
  const turning = new THREE.Group();
  const jib = CRANE.jib;
  const tip = v(0, JIB_HIGH, jib);
  for (const sx of [-1, 1]) bar(turning, v(sx * JIB_SIDE, JIB_LOW, -0.6), v(sx * JIB_SIDE, JIB_LOW, jib), 0.12, yellow);
  bar(turning, v(0, JIB_HIGH, -0.2), tip, 0.12, yellow);
  const jn = 20;
  for (let k = 0; k <= jn; k++) {
    const z = (jib * k) / jn;
    const z2 = (jib * (k + 0.5)) / jn;
    bar(turning, v(-JIB_SIDE, JIB_LOW, z), v(JIB_SIDE, JIB_LOW, z), 0.06, yellow);
    if (k === jn) break;
    for (const sx of [-1, 1]) {
      bar(turning, v(sx * JIB_SIDE, JIB_LOW, z), v(0, JIB_HIGH, z2), 0.06, yellow);
      bar(turning, v(0, JIB_HIGH, z2), v(sx * JIB_SIDE, JIB_LOW, (jib * (k + 1)) / jn), 0.06, yellow);
    }
  }
  // The counter-jib: a walkway between two chords, its machinery, and the counterweights at its end.
  const back = -CRANE.counter;
  for (const sx of [-1, 1]) {
    bar(turning, v(sx * 0.6, 0.15, 0.6), v(sx * 0.6, 0.15, back), 0.14, yellow);
    bar(turning, v(sx * 0.6, 1.05, 0.2), v(sx * 0.6, 1.05, back + 2.4), 0.05, yellow);
  }
  turning.add(mesh(new THREE.BoxGeometry(1.2, 0.05, -back - 0.6), concrete, 0, 0.2, back / 2 + 0.3, false));
  turning.add(mesh(new THREE.BoxGeometry(1.3, 1.05, 2), yellow, 0, 0.75, -3));
  for (let k = 0; k < 3; k++) turning.add(mesh(new THREE.BoxGeometry(1.9, 1.15, 0.55), concrete, 0, 0.8, back + 0.4 + k * 0.6));
  // The cab, hung off the slewing ring beside the jib's foot.
  turning.add(mesh(new THREE.BoxGeometry(1.4, 1.7, 1.6), white, 1.35, -0.6, 0.6));
  turning.add(mesh(new THREE.BoxGeometry(1.42, 0.9, 1.3), toon('#33415c'), 1.35, -0.35, 0.72, false));
  turning.add(mesh(new THREE.CylinderGeometry(1.15, 1.15, 0.2, 16), yellow, 0, 0.1, 0));
  // Warning lights at either end, big enough to show from the roof bar at night.
  turning.add(mesh(new THREE.SphereGeometry(0.3, 10, 8), kit.red, 0, JIB_HIGH + 0.2, jib - 0.2, false));
  turning.add(mesh(new THREE.SphereGeometry(0.3, 10, 8), kit.red, 0, 1.55, back + 0.3, false));
  const slew = mergeByMaterial(turning);
  slew.position.y = SLEW_Y;
  group.add(slew);

  // The trolley on the jib's bottom chords, and the hook block hanging from it on two cables.
  const trolley = new THREE.Group();
  trolley.add(mesh(new THREE.BoxGeometry(1.25, 0.32, 1.1), ink, 0, JIB_LOW - 0.12, 0));
  slew.add(trolley);
  const cableGeo = new THREE.CylinderGeometry(0.025, 0.025, 1, 5).translate(0, -0.5, 0);
  const cables = [-0.18, 0.18].map((x) => {
    const c = mesh(cableGeo, ink, x, JIB_LOW - 0.28, 0, false);
    trolley.add(c);
    return c;
  });
  const hook = new THREE.Group();
  hook.add(mesh(new THREE.BoxGeometry(0.5, 0.65, 0.34), yellow, 0, 0, 0));
  hook.add(mesh(new THREE.TorusGeometry(0.16, 0.05, 6, 12, Math.PI * 1.4), ink, 0, -0.5, 0, false));
  // A bundle of steel on its slings, on its way somewhere.
  hook.add(mesh(new THREE.BoxGeometry(0.03, 1.1, 0.03), ink, 0, -1.1, 0, false));
  hook.add(mesh(new THREE.BoxGeometry(3, 0.3, 0.5), toon('#a4553f'), 0, -1.75, 0));
  trolley.add(hook);

  return {
    group,
    pose(m) {
      slew.rotation.y = m.slew;
      trolley.position.z = m.trolley;
      const drop = m.hook;
      hook.position.y = JIB_LOW - 0.28 - drop;
      for (const c of cables) c.scale.y = drop;
    },
    dispose() {
      group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    },
  };
}
