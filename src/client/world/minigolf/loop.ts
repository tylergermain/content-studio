import * as THREE from 'three';
import { BALL_R, LOOP_WIDTH, type Hole, type Loop, type XZ } from '../../../shared/minigolf/types';
import { mesh, toon } from '../toon';
import { feltUnder } from './shapes';

// The Loop (hole 5): a steel loop-the-loop standing on the felt. The ball goes in at its foot heading
// its way, round the inside of a track `r` round (its middle a ball's radius in from it, as the office
// rolls it: placeInLoop in shared/minigolf/physics.ts), and comes out at the foot again `offset` to the
// right, still heading the same way: one turn of a helix, upright along the heading, sliding sideways
// as it goes round so the way out misses the way in. The track is a ladder of steel, its two rails as
// far apart as the track is wide and rungs across, so the ball can be seen all the way round.

const STEEL = toon('#c9d1d9');
const RUNG = toon('#9aa5b1');
const FOOT = toon('#3d405b');

/** The way the ball goes in and comes out, along the felt: 0 is down +z. */
const dirOf = (loop: Loop) => ({ x: Math.sin(loop.yaw), z: Math.cos(loop.yaw) });
/** The right of the heading, as you look along it (see shared/minigolf/types.ts): where the way out is. */
const rightOf = (loop: Loop) => ({ x: -Math.cos(loop.yaw), z: Math.sin(loop.yaw) });

/**
 * Where the middle of the ball is `u` of the way round `loop` (0 going in, 1 coming out) on felt at
 * `base`; `out` meters further from the circle's middle (its track is a ball's radius out) and
 * `across` to the right of that.
 */
export function loopPoint(loop: Loop, base: number, u: number, into = new THREE.Vector3(), out = 0, across = 0): THREE.Vector3 {
  const d = dirOf(loop);
  const s = rightOf(loop);
  const a = u * Math.PI * 2;
  const r = loop.r - BALL_R + out;
  const along = Math.sin(a) * r;
  const side = loop.offset * u + across;
  return into.set(loop.entry.x + d.x * along + s.x * side, base + loop.r - Math.cos(a) * r, loop.entry.z + d.z * along + s.z * side);
}

/** The loop's legs: where they stand on the felt, outside the track either side, at its front and back. */
export function loopFeet(loop: Loop): XZ[] {
  const d = dirOf(loop);
  const s = rightOf(loop);
  const half = (loop.width ?? LOOP_WIDTH) / 2;
  const sides = [Math.min(0, loop.offset) - half - 0.12, Math.max(0, loop.offset) + half + 0.12];
  const feet: XZ[] = [];
  // Just outside the track's front and back, so the ball going round passes inside the braces.
  const reach = loop.r + 0.09;
  for (const along of [-reach, reach]) for (const side of sides) feet.push({ x: loop.entry.x + d.x * along + s.x * side, z: loop.entry.z + d.z * along + s.z * side });
  return feet;
}

/** `hole`'s loop-the-loop, into `parts`: the track's two rails with rungs across, on four legs braced across the top of each pair. */
export function buildLoop(hole: Hole, loop: Loop, parts: THREE.Group) {
  const base = feltUnder(hole, loop.entry.x, loop.entry.z);
  const half = (loop.width ?? LOOP_WIDTH) / 2;
  // Under the ball as it goes round: the track is a ball's radius further out than its middle, the rails just outside it.
  const under = BALL_R + 0.016;
  for (const across of [-half, half]) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 72; i++) pts.push(loopPoint(loop, base, i / 72, new THREE.Vector3(), under, across));
    parts.add(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 180, 0.016, 6, false), STEEL, 0, 0, 0, false));
  }
  // Rungs across it, but for the bottom of the turn, where it's the chutes' felt it runs on.
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  for (let i = 2; i < 34; i++) {
    const u = i / 36;
    loopPoint(loop, base, u, a, under + 0.008, -half);
    loopPoint(loop, base, u, b, under + 0.008, half);
    const len = a.distanceTo(b);
    const rung = mesh(new THREE.CylinderGeometry(0.008, 0.008, len, 5), RUNG, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2, false);
    rung.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    parts.add(rung);
  }
  // The legs, from the felt up to the circle's middle height, and a brace across the top of each pair.
  const top = base + loop.r;
  const feet = loopFeet(loop);
  for (const f of feet) {
    parts.add(mesh(new THREE.CylinderGeometry(0.025, 0.03, top - base, 8), FOOT, f.x, base + (top - base) / 2, f.z));
    parts.add(mesh(new THREE.BoxGeometry(0.14, 0.03, 0.14), FOOT, f.x, base + 0.015, f.z, false));
  }
  for (const [p, q] of [
    [feet[0], feet[1]],
    [feet[2], feet[3]],
  ]) {
    const len = Math.hypot(q.x - p.x, q.z - p.z);
    const brace = mesh(new THREE.BoxGeometry(len, 0.03, 0.03), FOOT, (p.x + q.x) / 2, top, (p.z + q.z) / 2);
    brace.rotation.y = -Math.atan2(q.z - p.z, q.x - p.x);
    parts.add(brace);
  }
}
