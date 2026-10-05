import * as THREE from 'three';
import type { Hole, Hill, Tunnel, XZ } from '../../../shared/minigolf/types';
import { mesh, toon } from '../toon';
import { feltUnder } from './shapes';

// Three Tunnels (hole 6): a grassy hill the ball can't roll up, with stone-trimmed mouths at its foot,
// and where each tunnel lets the ball out again, a pipe's end facing the way it comes out.

const GRASS = toon('#5fae4f');
const GRASS_DARK = toon('#4a9440');
const STONE = toon('#b8b1a6');
const MOUTH = toon('#14171f');
const PETALS = ['#ffd166', '#ff8fab', '#fffaf3'].map((c) => toon(c));

/** The hill a tunnel's mouth is at the foot of, if any. */
function hillOf(hole: Hole, at: XZ): Hill | undefined {
  return (hole.hills ?? []).find((h) => ((at.x - h.x) / (h.rx + 0.6)) ** 2 + ((at.z - h.z) / (h.rz + 0.6)) ** 2 <= 1);
}

/** A stone-trimmed arch `r` across, its dark opening facing `yaw` (0 down +z), standing on the felt at (x, y, z). */
function arch(parts: THREE.Group, x: number, y: number, z: number, yaw: number, r: number) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = yaw;
  g.add(mesh(new THREE.CircleGeometry(r, 18, 0, Math.PI), MOUTH, 0, 0.002, -0.01, false));
  g.add(mesh(new THREE.TorusGeometry(r + 0.03, 0.035, 6, 18, Math.PI), STONE, 0, 0, 0));
  parts.add(g);
}

/** How wide a tunnel's mouth is drawn: at least wide enough to see the ball go in. */
const mouthR = (t: Tunnel) => Math.min(0.32, Math.max(0.12, t.r));

/** `hole`'s hills and the tunnels through them, into `parts`. */
export function buildHills(hole: Hole, parts: THREE.Group) {
  for (const h of hole.hills ?? []) {
    const base = feltUnder(hole, h.x, h.z);
    const dome = new THREE.SphereGeometry(1, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    dome.scale(h.rx, h.height, h.rz);
    parts.add(mesh(dome, GRASS, h.x, base, h.z));
    // A darker band round its foot, and a few tufts and flowers up it.
    const foot = new THREE.CylinderGeometry(1, 1, 0.06, 28, 1, true);
    foot.scale(h.rx * 1.005, 1, h.rz * 1.005);
    parts.add(mesh(foot, GRASS_DARK, h.x, base + 0.03, h.z, false));
    for (let i = 0; i < 9; i++) {
      const a = i * 2.4 + 0.3;
      const k = 0.35 + (i % 3) * 0.17;
      const fx = h.x + Math.cos(a) * h.rx * k;
      const fz = h.z + Math.sin(a) * h.rz * k;
      const fy = base + h.height * Math.sqrt(Math.max(0, 1 - k * k));
      parts.add(mesh(new THREE.SphereGeometry(0.06, 6, 4), PETALS[i % PETALS.length], fx, fy + 0.03, fz, false));
    }
  }
  for (const t of hole.tunnels ?? []) {
    const r = mouthR(t);
    // A mouth faces out from its hill's middle (or back toward the tee, with no hill round it).
    const hill = hillOf(hole, t.mouth);
    const from = hill ?? hole.tee;
    const outward = hill ? Math.atan2((t.mouth.x - from.x) / (hill.rx * hill.rx), (t.mouth.z - from.z) / (hill.rz * hill.rz)) : Math.atan2(hole.tee.x - t.mouth.x, hole.tee.z - t.mouth.z);
    // Stood a little proud of the hill's foot, so the grass doesn't cover the opening.
    const mx = t.mouth.x + Math.sin(outward) * 0.05;
    const mz = t.mouth.z + Math.cos(outward) * 0.05;
    arch(parts, mx, feltUnder(hole, t.mouth.x, t.mouth.z), mz, outward, r);
    arch(parts, t.exit.x, feltUnder(hole, t.exit.x, t.exit.z), t.exit.z, t.yaw, Math.min(0.2, r));
  }
}
