import * as THREE from 'three';
import { mesh, roundedBox, toon } from '../toon';
import { BLACK, screenMesh, type Builders, type BuiltPiece } from './furniture-kit';
import { box } from './materials';

// The furniture's builder for the market board (see furniture.ts, and shared/furniture.ts for what the
// kind is and how much floor it takes). The stock ticker's bar is built with the studio's other things
// (furniture-studio.ts); what both of them show is painted by features/studio.

/** The market board's face: 1.44 by 0.8, its middle 1.06 up. */
export const MARKET_BOARD = { w: 1.44, h: 0.8, y: 1.06 } as const;

/**
 * A market board: a screen on a stand, as high as you stand, facing the front (+z). `screen` is its
 * face, which the floor's prices are put up on as a table (features/studio).
 */
function marketBoard(color: string): BuiltPiece {
  const g = new THREE.Group();
  const frame = toon(color);
  const { w, h, y } = MARKET_BOARD;
  // Its foot, and the two posts up to the screen.
  g.add(mesh(roundedBox(1.3, 0.05, 0.28, 0.06), frame, 0, 0.025, 0));
  for (const sx of [-1, 1]) g.add(mesh(box(0.06, y - h / 2, 0.06), frame, sx * 0.46, (y - h / 2) / 2 + 0.02, -0.01));
  const bezel = mesh(roundedBox(w + 0.1, 0.07, h + 0.1, 0.04), frame, 0, y, 0);
  bezel.rotation.x = Math.PI / 2;
  g.add(bezel);
  // The back of it: a plate where its works are.
  g.add(mesh(roundedBox(0.7, 0.4, 0.04, 0.02), toon(BLACK), 0, y, -0.05));
  const screen = screenMesh(w, h, '#0a0d12');
  screen.position.set(0, y, 0.04);
  g.add(screen);
  return { group: g, screen };
}

export const TICKER_BUILDERS: Builders = {
  'ticker-screen': (_p, color) => marketBoard(color),
};
