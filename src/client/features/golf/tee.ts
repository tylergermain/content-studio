import * as THREE from 'three';
import { BALCONY } from '../../../shared/layout';
import { TEES, pinFrom, teeBays } from '../../../shared/tees';
import type { Collider, Interactable } from '../../world/types';
import type { Fixture } from '../../world/office/fixture';
import { mergeByMaterial, mesh, toon } from '../../world/toon';

// The driving tees out on the balcony (see TEES in shared/tees.ts): each bay a square of turf, a ball
// on a tee and a bag of clubs. The office's own is always out; the second, east of the doors, only on
// a floor whose room has two (see world/office/room-options.ts), for two people to tee off together.

/** The ball's radius. A real one's is 2.1 cm; this one's bigger, so it can be seen from the tee. */
export const BALL_R = 0.05;
/** The turf mat, and the tee on it. */
const MAT_H = 0.03;
const TEE_H = 0.015;
/** The golfer stands this far from the ball, square to the line. */
export const STANCE = 0.57;

const TEE_BALLS = TEES.map((t) => new THREE.Vector3(t.ball.x, MAT_H + TEE_H + BALL_R, t.ball.z));
const PINS = TEES.map((_, i) => pinFrom(i));

/** The ball on bay `bay`'s tee, ready to hit. */
export function teeBall(bay: number): THREE.Vector3 {
  return TEE_BALLS[bay] ?? TEE_BALLS[0];
}

/** Which way from bay `bay`'s tee the pin is. */
export function pinYaw(bay: number): number {
  return (PINS[bay] ?? PINS[0]).yaw;
}

/** From bay `bay`'s tee to the pin, along the ground. */
export function pinDistance(bay: number): number {
  return (PINS[bay] ?? PINS[0]).distance;
}

/** Where the golfer on bay `bay` stands for a shot heading `yaw`, and which way they face: across the line, with the hole on their left. */
export function stance(yaw: number, bay: number): { x: number; z: number; facing: number } {
  const ball = teeBall(bay);
  return { x: ball.x + Math.cos(yaw) * STANCE, z: ball.z - Math.sin(yaw) * STANCE, facing: yaw - Math.PI / 2 };
}

/** A square of green stripes, mown two ways, for the fairway and a tee's mat. */
export function mownTexture(light: string, dark: string, stripes: number, border?: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  for (let i = 0; i < stripes; i++) {
    g.fillStyle = i % 2 ? dark : light;
    g.fillRect(0, (i * 128) / stripes, 128, 128 / stripes + 1);
  }
  if (border) {
    g.strokeStyle = border;
    g.lineWidth = 6;
    g.strokeRect(5, 5, 118, 118);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function golfBall(): THREE.Mesh {
  return mesh(new THREE.SphereGeometry(BALL_R, 14, 10), toon('#ffffff'), 0, 0, 0, false);
}

export interface TeeBayView {
  /** The ball waiting on the tee; hidden from the moment it's hit until the next one's teed up. */
  ball: THREE.Mesh;
}

export interface Tee {
  /** The bays, by number (see TEES). */
  bays: readonly TeeBayView[];
  /** How many of them the floor you're on has out: the rest are put away. */
  out(): number;
}

declare module '../../world/types' {
  interface Interactable {
    /** Which of TEES (shared/tees.ts), for a golf tee. */
    bay?: number;
  }
  interface OfficeHandles {
    /** The golf tees on the balcony (the hole across the street they're hit at is `green`). */
    tee: Tee;
  }
}

interface Bay extends TeeBayView {
  root: THREE.Group;
  it: Interactable;
  /** Its bag, which is in the way. */
  collider: Collider;
}

/**
 * Bay `i`: a square of turf (its sides `turf`), a ball on a tee, a pair of tee markers along its
 * front, and a golf bag leaning on the wall behind it.
 */
function buildBay(i: number, turf: THREE.Material[]): Bay {
  const { x, z, size, ball: b, bag: at } = TEES[i];
  const it: Interactable = { kind: 'golf', x, z, radius: 1.5, bay: i };
  const root = new THREE.Group();
  const mat = new THREE.Mesh(new THREE.BoxGeometry(size, MAT_H, size), turf);
  mat.position.set(x, MAT_H / 2, z);
  mat.receiveShadow = true;
  mat.userData.interact = it;
  root.add(mat);

  const parts = new THREE.Group();
  parts.add(mesh(new THREE.CylinderGeometry(0.012, 0.006, TEE_H + 0.02, 8), toon('#ffd166'), b.x, MAT_H + (TEE_H + 0.02) / 2 - 0.01, b.z, false));
  // Tee markers: a red ball either side, a little in front of the ball.
  for (const s of [-1, 1]) parts.add(mesh(new THREE.SphereGeometry(0.06, 12, 8), toon('#ef476f'), b.x + s * 0.55, MAT_H + 0.05, z + size / 2 - 0.12));
  // The bag: leaning back on the wall, three clubs sticking out of the top. Each bay's has its own colors.
  const [cloth, band] = i % 2 ? ['#2a6f4e', '#ffd166'] : ['#1d3557', '#ef476f'];
  const bag = new THREE.Group();
  bag.add(mesh(new THREE.CylinderGeometry(0.17, 0.15, 0.85, 14), toon(cloth), 0, 0.43, 0));
  bag.add(mesh(new THREE.CylinderGeometry(0.175, 0.175, 0.1, 14), toon(band), 0, 0.62, 0));
  bag.add(mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.05, 14), toon('#fffaf3'), 0, 0.86, 0));
  for (const [cx, cz, tilt] of [
    [-0.06, 0.04, -0.12],
    [0.05, 0.05, 0.1],
    [0, -0.06, 0.02],
  ]) {
    const club = new THREE.Group();
    club.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.5, 6), toon('#adb5bd'), 0, 0.25, 0, false));
    club.add(mesh(new THREE.BoxGeometry(0.1, 0.07, 0.05), toon('#8d99ae'), 0.03, 0.52, 0));
    club.position.set(cx, 0.8, cz);
    club.rotation.z = tilt;
    bag.add(club);
  }
  bag.rotation.x = -0.14;
  bag.position.set(at.x, 0, at.z);
  parts.add(bag);
  const merged = mergeByMaterial(parts);
  for (const m of merged.children) m.userData.interact = it;
  root.add(merged);

  const ball = golfBall();
  ball.position.copy(teeBall(i));
  ball.userData.interact = it;
  root.add(ball);
  return { root, it, ball, collider: { minX: at.x - 0.2, maxX: at.x + 0.2, minZ: BALCONY.minZ, maxZ: at.z + 0.2, top: 1 } };
}

/** The golf tees, out on the balcony: as many as the floor you're on has (see RoomOptions.tees). */
export const tee: Fixture<'tee'> = (site) => {
  const side = toon('#3f8f45');
  const top = new THREE.MeshToonMaterial({ map: mownTexture('#7ed957', '#6cc24a', 6, '#fffaf3'), gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap });
  const bays = TEES.map((_, i) => buildBay(i, [side, side, top, side, side, side]));
  for (const b of bays) {
    site.group.add(b.root);
    site.interactables.push(b.it);
  }
  let out = 0;
  site.get('room').on((room) => {
    out = teeBays(room.tees);
    bays.forEach((b, i) => {
      const show = i < out;
      b.root.visible = show;
      b.it.off = !show;
      const at = site.colliders.indexOf(b.collider);
      if (show && at < 0) site.colliders.push(b.collider);
      else if (!show && at >= 0) site.colliders.splice(at, 1);
    });
  });
  return { handle: { tee: { bays, out: () => out } } };
};
