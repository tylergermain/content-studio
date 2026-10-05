import * as THREE from 'three';
import { puttCell } from '../../../shared/mainstreet';
import { heightAt } from '../../../shared/minigolf/physics';
import type { Hole } from '../../../shared/minigolf/types';
import type { StreetBox } from '../outside';
import { mesh, textPlane, toon } from '../toon';
import type { Collider } from '../types';
import { cupFlag } from './arcade';
import { archPosts, buildArch } from './arch';
import { buildFelt } from './felt';
import { buildHills } from './hill';
import { buildLoop, loopFeet } from './loop';
import { clearOf, feltUnder, turnedBox } from './shapes';
import { buildWalls } from './walls';
import { buildMill, type MillView } from './windmill';

// One of Putt Street's holes, built from its numbers (shared/minigolf/course.ts) on its cell of lawn:
// the felt and what's on it, the walls, the windmill, the loop, the hill and its tunnels, the arch, a
// sign by the tee with its number, name and par, and flowers wherever the hole leaves room. What a
// person can't walk through is in `colliders`, and what a golf ball off the balcony bounces off, in
// `obstacles`. Everything is in the street frame, y 0 the street. What never moves and has no picture
// on it goes into `statics`, for the whole course's to be merged into a few draw calls at once.

const LAWN = toon('#86c96a');
const EDGING = toon('#9c6b46');
const SIGN_POST = toon('#8a5a3b');
const LEAVES = toon('#4f9e48');
const FLOWERS = ['#ff8fab', '#ffd166', '#c77dff', '#fffaf3', '#ff7a45'].map((c) => toon(c));

export interface HoleView {
  /** What moves or has a picture on it: the windmill, the signs. Its still parts are in the `statics` it was given. */
  group: THREE.Group;
  /** What people bump into, in the street frame (bottom 0 is the street). */
  colliders: Collider[];
  /** What a golf ball off the balcony bounces off (see setObstacleBoxes in world/outside.ts). */
  obstacles: StreetBox[];
  /** The windmill's sails, turned to office time `officeMs`. */
  update(officeMs: number): void;
}

/** Hole `hole` on its cell; what never moves goes into `statics`, unmerged (see mergeByMaterial). */
export function buildHole(hole: Hole, statics: THREE.Group): HoleView {
  const group = new THREE.Group();
  group.add(cupFlag(hole));
  const parts = statics;
  const colliders: Collider[] = [];
  const obstacles: StreetBox[] = [];

  // Its cell of lawn, edged with timber, under the felt.
  const cell = puttCell(hole.n);
  const w = cell.maxX - cell.minX;
  const d = cell.maxZ - cell.minZ;
  const cx = (cell.minX + cell.maxX) / 2;
  const cz = (cell.minZ + cell.maxZ) / 2;
  parts.add(mesh(new THREE.BoxGeometry(w, 0.02, d), LAWN, cx, 0.01, cz, false));
  for (const [ex, ez, ew, ed] of [
    [cx, cell.minZ, w + 0.1, 0.1],
    [cx, cell.maxZ, w + 0.1, 0.1],
    [cell.minX, cz, 0.1, d],
    [cell.maxX, cz, 0.1, d],
  ])
    parts.add(mesh(new THREE.BoxGeometry(ew, 0.06, ed), EDGING, ex, 0.03, ez, false));

  buildFelt(hole, parts);
  buildWalls(hole, parts);
  buildHills(hole, parts);
  for (const h of hole.hills ?? []) {
    const top = feltUnder(hole, h.x, h.z) + h.height;
    colliders.push({ minX: h.x - h.rx * 0.8, maxX: h.x + h.rx * 0.8, minZ: h.z - h.rz * 0.8, maxZ: h.z + h.rz * 0.8, bottom: 0, top });
  }
  for (const c of hole.cones ?? []) {
    const r = c.r * 0.68;
    colliders.push({ minX: c.x - r, maxX: c.x + r, minZ: c.z - r, maxZ: c.z + r, bottom: 0, top: c.h + c.height });
  }
  if (hole.arch) {
    const a = hole.arch;
    buildArch(hole, a, parts);
    const posts = archPosts(a);
    for (const p of posts) colliders.push({ minX: p.x - 0.15, maxX: p.x + 0.15, minZ: p.z - 0.15, maxZ: p.z + 0.15, bottom: 0, top: feltUnder(hole, a.x, a.z) + a.height });
    obstacles.push({ minX: Math.min(posts[0].x, posts[1].x) - 0.3, maxX: Math.max(posts[0].x, posts[1].x) + 0.3, minZ: Math.min(posts[0].z, posts[1].z) - 0.3, maxZ: Math.max(posts[0].z, posts[1].z) + 0.3, top: a.height });
  }
  if (hole.loop) {
    buildLoop(hole, hole.loop, parts);
    const top = feltUnder(hole, hole.loop.entry.x, hole.loop.entry.z) + hole.loop.r;
    for (const f of loopFeet(hole.loop)) colliders.push({ minX: f.x - 0.07, maxX: f.x + 0.07, minZ: f.z - 0.07, maxZ: f.z + 0.07, bottom: 0, top });
  }
  let mill: MillView | null = null;
  if (hole.mill) {
    const m = hole.mill;
    mill = buildMill(hole, m);
    group.add(mill.group);
    const box = turnedBox(m.x, m.z, m.base, m.yaw);
    const top = feltUnder(hole, m.x, m.z, m.base / 2) + m.height;
    colliders.push({ ...box, bottom: 0, top });
    obstacles.push({ ...box, top });
  }

  // A sign beside the tee: the hole's number, its name and par.
  const spot = signSpot(hole);
  if (spot) {
    parts.add(mesh(new THREE.BoxGeometry(0.07, 0.75, 0.07), SIGN_POST, spot.x, 0.375, spot.z));
    colliders.push({ minX: spot.x - 0.06, maxX: spot.x + 0.06, minZ: spot.z - 0.06, maxZ: spot.z + 0.06, bottom: 0, top: 0.8 });
    // Both ways, so it reads from the path as well as from the tee.
    const facing = Math.atan2(hole.tee.x - spot.x, hole.tee.z - spot.z);
    for (const turn of [0, Math.PI]) {
      const sign = textPlane(`${hole.n} · ${hole.name} · Par ${hole.par}`, { bg: '#2b2d42', color: '#fffaf3', size: 44, border: '#2fbf71' });
      sign.scale.setScalar(0.62);
      sign.rotation.y = facing + turn;
      sign.position.set(spot.x + Math.sin(facing + turn) * 0.006, 0.82, spot.z + Math.cos(facing + turn) * 0.006);
      group.add(sign);
    }
  }

  // Flowers in the lawn wherever the hole leaves room: its corners and the middles of its sides.
  const inset = 0.75;
  for (const [fx, fz] of [
    [cell.minX + inset, cell.minZ + inset],
    [cell.maxX - inset, cell.minZ + inset],
    [cell.minX + inset, cell.maxZ - inset],
    [cell.maxX - inset, cell.maxZ - inset],
    [cx, cell.minZ + inset],
    [cx, cell.maxZ - inset],
    [cell.minX + inset, cz],
    [cell.maxX - inset, cz],
  ]) {
    if (!clearOf(hole, fx, fz, 0.75) || (spot && Math.hypot(spot.x - fx, spot.z - fz) < 1)) continue;
    flowerBed(parts, fx, fz, hole.n * 7 + fx);
  }

  return { group, colliders, obstacles, update: (officeMs) => mill?.update(officeMs) };
}

/** A round bed of leaves with a handful of flowers in it at (x, z); `seed` picks their colors. */
function flowerBed(parts: THREE.Group, x: number, z: number, seed: number) {
  parts.add(mesh(new THREE.SphereGeometry(0.42, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.55, 1), LEAVES, x, 0.02, z));
  for (let i = 0; i < 6; i++) {
    const a = seed * 1.7 + i * 1.05;
    const r = i === 0 ? 0 : 0.24;
    parts.add(mesh(new THREE.SphereGeometry(0.07, 8, 6), FLOWERS[Math.abs(Math.floor(seed + i)) % FLOWERS.length], x + Math.cos(a) * r, 0.24 - r * 0.25, z + Math.sin(a) * r, false));
  }
}

/**
 * Where a hole's sign stands: off the felt beside the tee, to one side of it (not behind, where the
 * camera stands to putt from the tee, nor in front, along the line).
 */
function signSpot(hole: Hole): { x: number; z: number } | null {
  const back = Math.atan2(hole.tee.x - hole.cup.x, hole.tee.z - hole.cup.z);
  const cell = puttCell(hole.n);
  for (const dist of [0.9, 1.2, 1.6, 2.1])
    for (const turn of [1.57, -1.57, 1.2, -1.2, 1.95, -1.95, 0.9, -0.9, 2.3, -2.3]) {
      const x = hole.tee.x + Math.sin(back + turn) * dist;
      const z = hole.tee.z + Math.cos(back + turn) * dist;
      if (x < cell.minX + 0.3 || x > cell.maxX - 0.3 || z < cell.minZ + 0.3 || z > cell.maxZ - 0.3) continue;
      if (heightAt(hole, x, z) === null && clearOf(hole, x, z, 0.25)) return { x, z };
    }
  return null;
}
