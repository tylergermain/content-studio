import * as THREE from 'three';
import { millAngle, millOpen } from '../../../shared/minigolf/physics';
import type { Hole, Mill } from '../../../shared/minigolf/types';
import { mergeByMaterial, mesh, toon } from '../toon';
import { feltUnder } from './shapes';

// The Windmill (hole 2): a white house with an ink roof, a tunnel through its foot that the ball
// rolls through, and four Friday-green sails turning on the office's clock (millAngle), the same
// clock the office rolls the ball on, so a sail on screen is where it is for the ball. The sails sweep
// down across the tunnel's mouth on the side the ball comes from: a sail stands right over it in the
// middle of each stretch the office counts the mouth as shut (millOpen).

/** How high the tunnel through the house is, and how much of the house is wall under its roof. */
const TUNNEL_H = 0.3;
const WALLS = 0.62;

const WHITE = toon('#fffaf3');
const ROOF = toon('#2b2d42');
const DARK = toon('#1f2433');
const TRIM = toon('#d9d2c5');
const GLASS = toon('#bfe3ff');
const SPAR = toon('#8a5a3b');
const SAIL = toon('#2fbf71');
const SAIL_LINE = toon('#e9fbe9');

export interface MillView {
  /** The house and its sails, in the street frame. */
  group: THREE.Group;
  /** Turns the sails to where they are at office time `officeMs`. */
  update(officeMs: number): void;
}

/** Which way the house's front faces (+1 along its yaw, or -1): toward the tee, the side the ball comes in by. */
export function millFront(hole: Hole, mill: Mill): 1 | -1 {
  const dx = Math.sin(mill.yaw);
  const dz = Math.cos(mill.yaw);
  return (hole.tee.x - mill.x) * dx + (hole.tee.z - mill.z) * dz >= 0 ? 1 : -1;
}

/** Hole `hole`'s windmill. */
export function buildMill(hole: Hole, mill: Mill): MillView {
  const group = new THREE.Group();
  const base = feltUnder(hole, mill.x, mill.z, mill.base / 2);
  group.position.set(mill.x, base, mill.z);
  // Turned so its tunnel runs along its local z, the front (the tee's side) at +z.
  const front = millFront(hole, mill);
  group.rotation.y = mill.yaw + (front < 0 ? Math.PI : 0);
  const half = mill.base / 2;
  const tunnel = Math.min(mill.tunnel, mill.base * 0.6);
  const wallH = mill.height * WALLS;
  const roofH = mill.height - wallH;

  const parts = new THREE.Group();
  // Either side of the tunnel, and over it: the house with a way through its foot.
  const side = half - tunnel / 2;
  for (const s of [-1, 1]) parts.add(mesh(new THREE.BoxGeometry(side, wallH, mill.base), WHITE, s * (tunnel / 2 + side / 2), wallH / 2, 0));
  parts.add(mesh(new THREE.BoxGeometry(tunnel, wallH - TUNNEL_H, mill.base), WHITE, 0, TUNNEL_H + (wallH - TUNNEL_H) / 2, 0));
  // The tunnel's dark lining, and a trim round each of its mouths.
  for (const s of [-1, 1]) parts.add(mesh(new THREE.BoxGeometry(0.012, TUNNEL_H, mill.base - 0.02), DARK, s * (tunnel / 2 - 0.006), TUNNEL_H / 2, 0, false));
  parts.add(mesh(new THREE.BoxGeometry(tunnel, 0.012, mill.base - 0.02), DARK, 0, TUNNEL_H - 0.006, 0, false));
  for (const s of [-1, 1]) {
    const z = s * (half + 0.015);
    parts.add(mesh(new THREE.BoxGeometry(tunnel + 0.16, 0.08, 0.03), TRIM, 0, TUNNEL_H + 0.04, z));
    for (const x of [-1, 1]) parts.add(mesh(new THREE.BoxGeometry(0.08, TUNNEL_H, 0.03), TRIM, x * (tunnel / 2 + 0.04), TUNNEL_H / 2, z));
  }
  // A band under the eaves, and the roof: a pyramid of ink, overhanging a little.
  parts.add(mesh(new THREE.BoxGeometry(mill.base + 0.06, 0.1, mill.base + 0.06), TRIM, 0, wallH - 0.05, 0));
  const roof = new THREE.ConeGeometry((mill.base / Math.SQRT2) * 1.18, roofH, 4, 1);
  roof.rotateY(Math.PI / 4);
  parts.add(mesh(roof, ROOF, 0, wallH + roofH / 2, 0));
  // Windows: one up each side, and a round one high on the back.
  for (const s of [-1, 1]) {
    parts.add(mesh(new THREE.BoxGeometry(0.03, 0.42, 0.34), GLASS, s * (half + 0.012), wallH * 0.58, 0, false));
    parts.add(mesh(new THREE.BoxGeometry(0.04, 0.5, 0.06), TRIM, s * (half + 0.02), wallH * 0.58, 0, false));
  }
  parts.add(mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.03, 16).rotateX(Math.PI / 2), GLASS, 0, wallH * 0.7, -half - 0.012, false));
  // The sails' axle, out of the front under the eaves.
  const hubY = wallH - 0.32;
  parts.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.12, 12).rotateX(Math.PI / 2), DARK, 0, hubY, half + 0.04));
  group.add(mergeByMaterial(parts));

  // The sails, each a spar with a green sail on its lattice, from the hub down to just over the felt,
  // close in to the face: the office has a sail across the mouth stop the ball at the face itself.
  const sails = new THREE.Group();
  sails.position.set(0, hubY, half + 0.08);
  const reach = hubY - 0.06;
  const blades = Math.max(1, Math.round(mill.blades));
  const each = (Math.PI * 2) / blades;
  const sailParts = new THREE.Group();
  for (let k = 0; k < blades; k++) {
    const blade = new THREE.Group();
    blade.rotation.z = k * each;
    blade.add(mesh(new THREE.BoxGeometry(0.07, reach, 0.05), SPAR, 0, -reach / 2, 0));
    const len = reach - 0.45;
    const width = Math.min(0.5, mill.base * 0.22);
    // Centered on its spar, so the sail over the mouth covers all of it.
    blade.add(mesh(new THREE.BoxGeometry(width, len, 0.025), SAIL, 0, -0.4 - len / 2, -0.02));
    // The lattice: a few white battens across the sail.
    for (let i = 1; i < 5; i++) blade.add(mesh(new THREE.BoxGeometry(width + 0.02, 0.025, 0.035), SAIL_LINE, 0, -0.4 - (len * i) / 5, 0.012, false));
    sailParts.add(blade);
  }
  sailParts.add(mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.12, 16).rotateX(Math.PI / 2), DARK, 0, 0, 0.02));
  sails.add(mergeByMaterial(sailParts));
  group.add(sails);
  // A sail points straight down over the mouth halfway through each stretch the office counts it as shut.
  const offset = shutMiddle(mill);
  return {
    group,
    update(officeMs) {
      sails.rotation.z = millAngle(mill, officeMs) - offset;
    },
  };
}

/**
 * How far round the sails are (millAngle) halfway through a stretch the office counts the mouth as shut
 * (millOpen), less a whole sail's turn: what's taken off the angle to draw a sail straight down then.
 * Found by asking millOpen itself, round one sail's turn, so the drawing keeps step with the office's
 * rule whatever it is; 0 when the mouth is never shut.
 */
export function shutMiddle(mill: Mill): number {
  const each = (Math.PI * 2) / Math.max(1, Math.round(mill.blades));
  const turnMs = (mill.period * 1000) / Math.max(1, Math.round(mill.blades));
  const N = 720;
  // The shut stretch's middle, as a mean of where round the sail's turn it's shut (wrapped, so a stretch either side of 0 counts as one).
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < N; i++) {
    const ms = (turnMs * i) / N;
    if (millOpen(mill, ms)) continue;
    const a = ((millAngle(mill, ms) % each) / each) * Math.PI * 2;
    sx += Math.cos(a);
    sy += Math.sin(a);
  }
  if (!sx && !sy) return 0;
  return ((Math.atan2(sy, sx) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * each;
}
