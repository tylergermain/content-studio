import * as THREE from 'three';
import { PUTT } from '../../../shared/mainstreet';
import { mergeByMaterial, mesh, textPlane, toon } from '../toon';
import type { Collider } from '../types';
import { PaintedBoard } from './boards';

// Putt Street's kiosk, inside the gate by the street: a little hut with PUTT STREET up on its roof for
// Main Street to see, and on the course side a service hatch under a striped awning, the live
// scorecard board, and under it the rack of putters and balls where you pick one up (the `puttrack`
// you use, see features/minigolf). In the street frame, y 0 the street.

const WALL = toon('#fffaf3');
const TRIM = toon('#2fbf71');
const INK = toon('#2b2d42');
const ROOF = toon('#3d405b');
const WOOD = toon('#9c6b46');
const DARK = toon('#1f2433');
const STRIPE = toon('#fffaf3');
const SHAFT = toon('#ced4da');
const BALLS = ['#ef476f', '#ffd166', '#06d6a0', '#118ab2', '#c77dff', '#ff8fab'].map((c) => toon(c));

/** How tall the hut's walls are, and the top of the sign on its roof (what Friday One keeps clear of). */
export const KIOSK_WALLS = 2.8;
export const KIOSK_TOP = 4.6;

export interface Kiosk {
  group: THREE.Group;
  colliders: Collider[];
  /** The rack's meshes, for the putter rack you use to be found by pointing at them. */
  rack: THREE.Object3D[];
  /** The live scorecard, painted from the rounds going on (see paintRounds in boards.ts). */
  board: PaintedBoard;
}

/** The kiosk; what never moves and has no picture on it goes into `statics`, unmerged (the rack is merged on its own, to be pointed at). */
export function buildKiosk(statics: THREE.Group): Kiosk {
  const k = PUTT.kiosk;
  const group = new THREE.Group();
  const parts = statics;
  const w = k.maxX - k.minX;
  const d = k.maxZ - k.minZ;
  const cx = (k.minX + k.maxX) / 2;
  const cz = (k.minZ + k.maxZ) / 2;
  const H = KIOSK_WALLS;

  // The hut, on a low step, with a green band round its top and a roof that overhangs it.
  parts.add(mesh(new THREE.BoxGeometry(w + 0.2, 0.12, d + 0.2), INK, cx, 0.06, cz));
  parts.add(mesh(new THREE.BoxGeometry(w, H, d), WALL, cx, H / 2, cz));
  parts.add(mesh(new THREE.BoxGeometry(w + 0.04, 0.3, d + 0.04), TRIM, cx, H - 0.15, cz));
  parts.add(mesh(new THREE.BoxGeometry(w + 0.7, 0.16, d + 0.9), ROOF, cx, H + 0.08, cz + 0.1));
  // Corner posts in ink.
  for (const x of [k.minX, k.maxX]) for (const z of [k.minZ, k.maxZ]) parts.add(mesh(new THREE.BoxGeometry(0.14, H, 0.14), INK, x, H / 2, z));

  // The service hatch on the course side, west of the board, under a striped awning.
  const back = k.maxZ;
  const hx = k.minX + 1.25;
  parts.add(mesh(new THREE.BoxGeometry(1.9, 1.0, 0.04), DARK, hx, 1.55, back + 0.01, false));
  parts.add(mesh(new THREE.BoxGeometry(2.2, 0.08, 0.42), WOOD, hx, 1.02, back + 0.2));
  for (let i = 0; i < 7; i++) {
    const stripe = mesh(new THREE.BoxGeometry(2.3 / 7, 0.04, 0.9), i % 2 ? STRIPE : TRIM, hx - 1.15 + (2.3 / 7) * (i + 0.5), 2.25, back + 0.42);
    stripe.rotation.x = 0.42;
    parts.add(stripe);
  }
  // A door on the east of the course side.
  parts.add(mesh(new THREE.BoxGeometry(0.9, 2.05, 0.04), WOOD, k.maxX - 0.9, 1.08, back + 0.01));

  // The rack: a timber stand of putters with a basket of balls, in front of the wall under the board.
  const rack = new THREE.Group();
  const r = PUTT.rack;
  rack.add(mesh(new THREE.BoxGeometry(1.5, 0.08, 0.28), WOOD, r.x, 0.9, r.z - 0.05));
  rack.add(mesh(new THREE.BoxGeometry(1.5, 0.08, 0.28), WOOD, r.x, 0.12, r.z - 0.05));
  for (const s of [-1, 1]) rack.add(mesh(new THREE.BoxGeometry(0.08, 0.98, 0.3), WOOD, r.x + s * 0.72, 0.49, r.z - 0.05));
  for (let i = 0; i < 8; i++) {
    const x = r.x - 0.6 + (i * 1.2) / 7;
    const club = new THREE.Group();
    club.add(mesh(new THREE.CylinderGeometry(0.012, 0.01, 0.92, 6), SHAFT, 0, 0.5, 0, false));
    club.add(mesh(new THREE.CylinderGeometry(0.02, 0.018, 0.2, 6), INK, 0, 0.92, 0, false));
    club.add(mesh(new THREE.BoxGeometry(0.11, 0.03, 0.03), BALLS[i % BALLS.length], 0.03, 0.05, 0, false));
    club.position.set(x, 0.02, r.z - 0.02);
    club.rotation.z = 0.06 * (i % 2 ? 1 : -1);
    rack.add(club);
  }
  // A basket of balls on the hut's step, beside the rack.
  rack.add(mesh(new THREE.CylinderGeometry(0.2, 0.16, 0.26, 12), WOOD, r.x + 1.05, 0.13, r.z - 0.05));
  for (let i = 0; i < 9; i++) rack.add(mesh(new THREE.SphereGeometry(0.05, 8, 6), BALLS[i % BALLS.length], r.x + 1.05 + Math.cos(i * 2.2) * 0.1 * (i % 3), 0.28 + (i % 2) * 0.03, r.z - 0.05 + Math.sin(i * 2.2) * 0.1 * (i % 3), false));
  const rackMerged = mergeByMaterial(rack);
  group.add(rackMerged);

  // The live scorecard board over the rack, facing the course.
  const board = new PaintedBoard(3.0, 1.5);
  board.group.position.set(r.x, 1.12, back + 0.03);
  group.add(board.group);

  // PUTT STREET on the roof, facing the street, with a ball on a tee beside it.
  const sign = textPlane('PUTT STREET', { bg: '#2fbf71', color: '#fffaf3', size: 96, border: '#2b2d42' });
  const sw = (sign.geometry.parameters as { width: number }).width;
  sign.scale.setScalar(Math.min(1.5, (w - 1.2) / sw));
  sign.position.set(cx, H + 0.95, k.minZ + 0.25);
  sign.rotation.y = Math.PI;
  group.add(sign);
  parts.add(mesh(new THREE.BoxGeometry(w - 0.6, 1.3, 0.1), INK, cx, H + 0.9, k.minZ + 0.32));
  parts.add(mesh(new THREE.SphereGeometry(0.42, 16, 12), WALL, k.maxX - 0.4, H + 1.7, k.minZ + 0.5));
  parts.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.6, 8), TRIM, k.maxX - 0.4, H + 1.05, k.minZ + 0.5));
  // And a smaller one over the hatch, facing the course.
  const back2 = textPlane('⛳ PUTTERS · SCORECARDS', { bg: '#fffaf3', color: '#2b2d42', size: 44, border: '#2fbf71' });
  back2.scale.setScalar(0.62);
  back2.position.set(hx, H - 0.15, back + 0.05);
  group.add(back2);

  const colliders: Collider[] = [
    { minX: k.minX - 0.1, maxX: k.maxX + 0.1, minZ: k.minZ - 0.1, maxZ: k.maxZ + 0.1, bottom: 0, top: KIOSK_TOP },
    { minX: r.x - 0.8, maxX: r.x + 1.3, minZ: back, maxZ: r.z + 0.12, bottom: 0, top: 1.0 },
  ];
  return { group, colliders, rack: [rackMerged], board };
}
