import * as THREE from 'three';
import { mesh, roundedBox, toon } from '../toon';
import { BLACK, screenMesh, type Builders, type BuiltPiece } from './furniture-kit';
import { box } from './materials';

// The furniture's builders for the studio's own things (see furniture.ts, and shared/furniture.ts for
// what each kind is and how much floor it takes): what a content team works at and with.

/**
 * A video screen on a stand: a 16:9 face `screen` plays the floor's videos on (features/screens), 1.98 by
 * 1.11, its middle 1.22 up, facing the front (+z).
 */
function videoScreen(color: string): BuiltPiece {
  const g = new THREE.Group();
  const frame = toon(color);
  g.add(mesh(roundedBox(1.5, 0.05, 0.46, 0.06), frame, 0, 0.025, 0));
  for (const sx of [-1, 1]) g.add(mesh(box(0.07, 0.62, 0.07), frame, sx * 0.5, 0.33, 0));
  const bezel = mesh(roundedBox(2.1, 0.08, 1.23, 0.05), frame, 0, 1.22, 0);
  bezel.rotation.x = Math.PI / 2;
  g.add(bezel);
  const screen = screenMesh(1.98, 1.11);
  screen.position.set(0, 1.22, 0.045);
  g.add(screen);
  return { group: g, screen };
}

/**
 * A stock ticker hung from the ceiling: a long dark bar at head height with a face either side, which
 * the market's prices slide along (features/studio). Each face is 5.84 by 0.3, UV 0 to 1 across it.
 */
function tickerBar(): BuiltPiece {
  const g = new THREE.Group();
  const y = 2.42;
  g.add(mesh(roundedBox(6, 0.4, 0.14, 0.04), toon(BLACK), 0, y, 0));
  // The cords it hangs by, up to the ceiling.
  for (const sx of [-1, 1]) g.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 4.2, 6), toon(BLACK), sx * 2.6, y + 0.2 + 2.1, 0, false));
  const ticker = [1, -1].map((side) => {
    const face = screenMesh(5.84, 0.3, '#0a0d12');
    face.position.set(0, y, side * 0.072);
    if (side < 0) face.rotation.y = Math.PI;
    g.add(face);
    return face;
  });
  return { group: g, ticker };
}

export const STUDIO_BUILDERS: Builders = {
  screen: (_p, color) => videoScreen(color),
  ticker: () => tickerBar(),
};
