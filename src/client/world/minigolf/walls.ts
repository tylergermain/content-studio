import * as THREE from 'three';
import { BALL_R, type Hole, type Wall } from '../../../shared/minigolf/types';
import { mesh, toon } from '../toon';
import { feltUnder, stripGeometry } from './shapes';

// What a hole's ball bounces off: the white kerbs round its felt (low enough to step over), timber
// rails, stone walls, and the round rubber bumpers. A wall stands on the felt at its foot all along
// it, so one beside a ramp climbs with it. Into `parts`, merged afterwards (see hole.ts).

/** How each kind of wall looks: its color and how thick it's drawn (the ball bounces off its middle line, a ball's width from it). */
const LOOKS: Record<NonNullable<Wall['look']>, { mat: THREE.Material; thick: number; cap?: THREE.Material }> = {
  kerb: { mat: toon('#fffaf3'), thick: 0.1 },
  rail: { mat: toon('#9c6b46'), thick: 0.09, cap: toon('#7a4e2f') },
  stone: { mat: toon('#a9a39a'), thick: 0.16, cap: toon('#8d877e') },
  house: { mat: toon('#fffaf3'), thick: 0.12 },
};
const BUMPER = toon('#ef476f');
const BUMPER_CAP = toon('#fffaf3');
const BUMPER_BAND = toon('#ffd166');

/** `hole`'s walls and bumpers, into `parts`. The mill's house is the windmill's own (see windmill.ts), so its walls are left to it. */
export function buildWalls(hole: Hole, parts: THREE.Group) {
  const under = (x: number, z: number) => feltUnder(hole, x, z);
  for (const w of hole.walls) {
    if (w.look === 'house' && hole.mill) continue;
    const look = LOOKS[w.look ?? 'kerb'];
    // Never lower than the ball it's there to stop.
    const height = Math.max(w.height, BALL_R * 1.6);
    parts.add(mesh(stripGeometry(w.pts, (x, z) => under(x, z) + height, look.thick), look.mat, 0, 0, 0, false));
    // A capping stone or a rail's top board, a little wider, along the top.
    if (look.cap) parts.add(mesh(stripGeometry(w.pts, (x, z) => under(x, z) + height + 0.025, look.thick + 0.03, (x, z) => under(x, z) + height - 0.03), look.cap, 0, 0, 0, false));
  }
  for (const b of hole.bumpers ?? []) {
    const y = under(b.x, b.z);
    const h = 0.2;
    parts.add(mesh(new THREE.CylinderGeometry(b.r, b.r, h, 20), BUMPER, b.x, y + h / 2, b.z, false));
    parts.add(mesh(new THREE.CylinderGeometry(b.r * 1.04, b.r * 1.04, 0.035, 20), BUMPER_BAND, b.x, y + h * 0.55, b.z, false));
    parts.add(mesh(new THREE.CylinderGeometry(b.r * 0.82, b.r, 0.04, 20), BUMPER_CAP, b.x, y + h + 0.02, b.z, false));
  }
}
