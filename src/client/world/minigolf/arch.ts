import * as THREE from 'three';
import { TOWER } from '../../../shared/tower';
import type { Arch, Hole, XZ } from '../../../shared/minigolf/types';
import { mesh, toon } from '../toon';
import { feltUnder } from './shapes';

// Friday Finale's arch (hole 9): Friday Tower in miniature over the lane, two ink posts and on top of
// them the tower's three bars, stacked and shifted like the Friday Labs mark, in Friday green.

const POST = toon('#2b2d42');
const BARS = ['#2fbf71', '#27a862', '#36d17e'].map((c) => toon(c));
/** How wide the tower's floors are across (its bars are drawn to this, scaled to the arch). */
const SPAN = 36.6;
/** A post's side, and each bar's depth. */
const POST_W = 0.2;
const BAR_H = 0.2;

/** Where the arch's two posts stand: either side of the lane, `width` apart. */
export function archPosts(a: Arch): XZ[] {
  const sx = Math.cos(a.yaw);
  const sz = -Math.sin(a.yaw);
  return [-1, 1].map((s) => ({ x: a.x + (sx * s * a.width) / 2, z: a.z + (sz * s * a.width) / 2 }));
}

/** `hole`'s arch, into `parts`. */
export function buildArch(hole: Hole, a: Arch, parts: THREE.Group) {
  const g = new THREE.Group();
  const base = feltUnder(hole, a.x, a.z);
  g.position.set(a.x, base, a.z);
  // Its local x runs across the lane, so the ball goes under it along local z.
  g.rotation.y = a.yaw;
  const top = a.height - BARS.length * BAR_H;
  for (const s of [-1, 1]) {
    g.add(mesh(new THREE.BoxGeometry(POST_W, top, POST_W), POST, (-s * a.width) / 2, top / 2, 0));
    g.add(mesh(new THREE.BoxGeometry(POST_W + 0.08, 0.06, POST_W + 0.08), POST, (-s * a.width) / 2, 0.03, 0, false));
  }
  // The bars, bottom to top, each as long as the tower's is, scaled from its floors to the arch.
  const k = (a.width + POST_W) / SPAN;
  TOWER.bars.forEach((bar, i) => {
    const len = (bar.maxX - bar.minX) * k;
    // The tower's west is on the left looking at it from the street, as on the lane looking along it.
    const mid = -((bar.minX + bar.maxX) / 2) * k;
    g.add(mesh(new THREE.BoxGeometry(len, BAR_H - 0.02, POST_W + 0.1), BARS[i % BARS.length], mid, top + i * BAR_H + BAR_H / 2, 0));
  });
  parts.add(g);
}
