import * as THREE from 'three';
import { mesh, toonUnique } from './toon';

// A parachute: what a worker sent home from a floor with no exit door comes down under
// (features/workers/leaving.ts), and what opens over you when you jump off the balcony
// (features/parachute). Striped gores in a dome, and the cords down to whoever hangs under it.

/** The colors a canopy comes in, striped with white. */
export const CANOPIES = ['#ef476f', '#ffd166', '#06d6a0', '#118ab2', '#8338ec', '#ff8a5b'] as const;

/** Seen from below too, so both sides of the fabric. */
const fabric = new Map<string, THREE.MeshToonMaterial>();
function cloth(color: string): THREE.MeshToonMaterial {
  let m = fabric.get(color);
  if (!m) {
    m = toonUnique(color);
    m.side = THREE.DoubleSide;
    fabric.set(color, m);
  }
  return m;
}
const CORD = new THREE.LineBasicMaterial({ color: '#2b2d42' });

/**
 * A parachute, to hang from someone's shoulders: striped gores in a dome over their head, and the
 * cords down to them. Its origin is where it's strapped on, `strap` up from the feet of whoever wears
 * it (a worker's shoulders), so it pops open (and crumples) from there.
 */
export function parachute(color: string, strap = 0.88): { group: THREE.Group; dome: THREE.Group } {
  const group = new THREE.Group();
  group.position.y = strap;
  const dome = new THREE.Group();
  const R = 1.35;
  const rim = 1.15;
  const gores = 10;
  for (let i = 0; i < gores; i++) {
    const geo = new THREE.SphereGeometry(R, 3, 5, (i / gores) * Math.PI * 2, (Math.PI * 2) / gores, 0, rim);
    dome.add(mesh(geo, cloth(i % 2 ? '#fffaf3' : color), 0, 0, 0, false));
  }
  dome.scale.y = 0.62;
  dome.position.y = 1.25;
  group.add(dome);
  // A cord from each seam at the rim down to a shoulder.
  const ends: number[] = [];
  const rimY = 1.25 + R * Math.cos(rim) * 0.62;
  for (let i = 0; i < gores; i++) {
    const a = (i / gores) * Math.PI * 2;
    const x = Math.sin(a) * R * Math.sin(rim);
    const z = Math.cos(a) * R * Math.sin(rim);
    ends.push(x, rimY, z, x < 0 ? -0.24 : 0.24, 0, 0.02);
  }
  const cords = new THREE.BufferGeometry();
  cords.setAttribute('position', new THREE.Float32BufferAttribute(ends, 3));
  group.add(new THREE.LineSegments(cords, CORD));
  return { group, dome };
}

/** Takes a parachute down for good: its geometry goes (the materials are shared, by color). */
export function disposeParachute(chute: { group: THREE.Group }) {
  chute.group.removeFromParent();
  chute.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
}
