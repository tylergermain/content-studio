import * as THREE from 'three';
import { PUTT } from '../../../shared/mainstreet';
import { STREET_Y } from '../../../shared/layout';
import { bulb, tree, type NightParts } from '../outside';
import { canvasTexture } from '../texture';
import { mesh, textPlane, toon } from '../toon';
import type { Collider } from '../types';

// Putt Street's grounds round its nine holes: gravel paths everywhere between the cells, a white
// picket fence round the plot with its gate on the street side under a sign, a tree in each corner,
// and two lanterns where the paths cross, which are the course's two lamps at night. In the street
// frame, y 0 the street.

const PICKET = toon('#fffaf3');
const RAIL = toon('#ece4d6');
const POST = toon('#3d405b');
const LANTERN = toon('#2b2d42');

/** How far apart the pickets are, and each one's size. */
const GAP = 0.2;
const PICKET_W = 0.07;

/** Gravel: pale, with darker and lighter stones scattered through it. */
function gravelTexture(): THREE.CanvasTexture {
  const t = canvasTexture(256, 256, (g) => {
    g.fillStyle = PUTT.gravel;
    g.fillRect(0, 0, 256, 256);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 1400; i++) {
      const v = rnd();
      g.fillStyle = v < 0.45 ? '#d8c8b0' : v < 0.8 ? '#f6ecdc' : '#c2b096';
      g.beginPath();
      g.arc(rnd() * 256, rnd() * 256, 0.8 + rnd() * 1.8, 0, Math.PI * 2);
      g.fill();
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(16, 16);
  return t;
}

export interface Grounds {
  group: THREE.Group;
  colliders: Collider[];
}

/**
 * The fence, the gate, the gravel, the corner trees and the lanterns; `night` takes the lanterns' bulbs
 * and lamps (none without it). What never moves and has no picture on it goes into `statics`, unmerged.
 */
export function buildGrounds(night: NightParts | null, statics: THREE.Group): Grounds {
  const group = new THREE.Group();
  const parts = statics;
  const colliders: Collider[] = [];
  const f = PUTT.fence;
  const H = f.height;

  // Gravel over the whole plot inside the fence: the paths between the cells.
  const gravel = new THREE.Mesh(
    new THREE.BoxGeometry(f.maxX - f.minX, 0.012, f.maxZ - f.minZ),
    new THREE.MeshToonMaterial({ map: gravelTexture(), gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap }),
  );
  gravel.position.set((f.minX + f.maxX) / 2, 0.006, (f.minZ + f.maxZ) / 2);
  gravel.receiveShadow = true;
  group.add(gravel);

  // The fence: a run of pickets on two rails along each side, the street side's split by the gate.
  const runs: [number, number, number, number][] = [
    [f.minX, f.minZ, PUTT.gate.minX, f.minZ],
    [PUTT.gate.maxX, f.minZ, f.maxX, f.minZ],
    [f.maxX, f.minZ, f.maxX, f.maxZ],
    [f.maxX, f.maxZ, f.minX, f.maxZ],
    [f.minX, f.maxZ, f.minX, f.minZ],
  ];
  for (const [x0, z0, x1, z1] of runs) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.round(len / GAP));
    const along = Math.abs(x1 - x0) > Math.abs(z1 - z0);
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n;
      const z = z0 + ((z1 - z0) * i) / n;
      // Every tenth one a post, a little taller.
      const post = i % 10 === 0 || i === n;
      const ph = post ? H + 0.08 : H;
      const w = post ? 0.11 : PICKET_W;
      parts.add(mesh(new THREE.BoxGeometry(along ? w : 0.035, ph - 0.06, along ? 0.035 : w), PICKET, x, (ph - 0.06) / 2, z));
      parts.add(mesh(new THREE.ConeGeometry(w * 0.72, 0.09, 4).rotateY(Math.PI / 4), PICKET, x, ph - 0.03, z, false));
    }
    for (const y of [0.25, H - 0.22]) {
      const rail = mesh(new THREE.BoxGeometry(along ? len : 0.03, 0.06, along ? 0.03 : len), RAIL, (x0 + x1) / 2, y, (z0 + z1) / 2);
      rail.position.x += along ? 0 : 0.035;
      rail.position.z += along ? 0.035 : 0;
      parts.add(rail);
    }
    colliders.push({ minX: Math.min(x0, x1) - 0.05, maxX: Math.max(x0, x1) + 0.05, minZ: Math.min(z0, z1) - 0.05, maxZ: Math.max(z0, z1) + 0.05, bottom: 0, top: H, fence: true });
  }

  // The gate: two posts and a sign over the way in, facing the street.
  const gx0 = PUTT.gate.minX;
  const gx1 = PUTT.gate.maxX;
  const gz = f.minZ;
  const gateH = 3.1;
  for (const x of [gx0, gx1]) {
    parts.add(mesh(new THREE.BoxGeometry(0.22, gateH, 0.22), POST, x, gateH / 2, gz));
    parts.add(mesh(new THREE.SphereGeometry(0.16, 12, 8), toon('#2fbf71'), x, gateH + 0.12, gz));
    colliders.push({ minX: x - 0.13, maxX: x + 0.13, minZ: gz - 0.13, maxZ: gz + 0.13, bottom: 0, top: gateH });
  }
  parts.add(mesh(new THREE.BoxGeometry(gx1 - gx0 + 0.3, 0.12, 0.16), POST, (gx0 + gx1) / 2, gateH - 0.1, gz));
  for (const s of [-1, 1]) {
    const sign = textPlane('⛳ PUTT STREET · MINI GOLF', { bg: '#2fbf71', color: '#fffaf3', size: 72, border: '#2b2d42' });
    sign.scale.setScalar(0.95);
    sign.position.set((gx0 + gx1) / 2, gateH - 0.55, gz + s * 0.07);
    sign.rotation.y = s < 0 ? Math.PI : 0;
    group.add(sign);
  }

  // A tree in each corner, where the paths are widest.
  for (const [tx, tz, s] of [
    [f.minX + 1.9, f.minZ + 2.2, 0.8],
    [f.maxX - 1.6, f.maxZ - 1.4, 0.85],
    [f.minX + 1.8, f.maxZ - 1.4, 0.75],
    [f.maxX - 1.5, f.minZ + 4.6, 0.7],
  ]) {
    const t = tree(s);
    t.position.set(tx, 0, tz);
    parts.add(t);
    colliders.push({ minX: tx - 0.3 * s, maxX: tx + 0.3 * s, minZ: tz - 0.3 * s, maxZ: tz + 0.3 * s, bottom: 0, top: 2.2 * s });
  }

  // The two lanterns where the paths cross: the course's lamps at night.
  const glass = night ? bulb(night, '#fff1c9') : toon('#fff1c9', { emissive: '#ffe2a0' });
  for (const { x, z } of PUTT.lamps) {
    const top = 3.4;
    parts.add(mesh(new THREE.CylinderGeometry(0.17, 0.21, 0.35, 10), LANTERN, x, 0.175, z));
    parts.add(mesh(new THREE.CylinderGeometry(0.055, 0.07, top, 8), LANTERN, x, top / 2, z));
    parts.add(mesh(new THREE.CylinderGeometry(0.2, 0.14, 0.42, 6), glass, x, top + 0.21, z, false));
    parts.add(mesh(new THREE.ConeGeometry(0.28, 0.24, 6), LANTERN, x, top + 0.54, z));
    colliders.push({ minX: x - 0.17, maxX: x + 0.17, minZ: z - 0.17, maxZ: z + 0.17, bottom: 0, top: top + 0.6 });
    if (!night) continue;
    // In the bottom floor's frame, down by the street: further down the higher your floor is (see Lamp.ground).
    night.halos.push({ at: new THREE.Vector3(x, STREET_Y + top + 0.2, z), size: 2, color: '#ffe2a0', ground: true });
    night.lamps.push({ x, y: STREET_Y + top - 0.2, z, reach: 11, color: '#ffd89a', power: 3.6, ground: true });
  }

  return { group, colliders };
}
