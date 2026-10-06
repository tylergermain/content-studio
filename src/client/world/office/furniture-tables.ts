import * as THREE from 'three';
import type { Piece } from '../../../shared/furniture';
import { WALL_HEIGHT } from '../../../shared/layout';
import { TABLE } from '../../../shared/table-seats';
import { mesh, textPlane, toon } from '../toon';
import { screenMesh, type Builders, type BuiltPiece } from './furniture-kit';
import { box } from './materials';

// The builders for what a project table has over and on it (see shared/furniture.ts): its screen, on a post up
// out of the middle of the table with a face to each side so everyone at it sees the table's app (features/screens
// puts it on both), and its sign, hung from the ceiling on two cables with what the table's for lit on both faces.

/** The table screen's face, how high its middle is, and its bezel. */
const FACE = { w: 1.6, h: 0.9, y: 1.62 };
const BEZEL = 0.05;
/** How far down from the ceiling the hanging sign's middle is, and its panel. */
const SIGN = { y: 3.55, w: 2.6, h: 0.6, d: 0.06 };

function tableDisplay(color: string): BuiltPiece {
  const g = new THREE.Group();
  const frame = toon(color);
  const bottom = FACE.y - FACE.h / 2 - BEZEL;
  // A foot on the table top, and the post up to the screen.
  g.add(mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.03, 24), frame, 0, TABLE.height + 0.015, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, bottom - TABLE.height, 12), frame, 0, (TABLE.height + bottom) / 2, 0));
  g.add(mesh(box(FACE.w + 2 * BEZEL, FACE.h + 2 * BEZEL, 0.06), frame, 0, FACE.y, 0));
  const front = screenMesh(FACE.w, FACE.h);
  front.position.set(0, FACE.y, 0.031);
  g.add(front);
  const back = screenMesh(FACE.w, FACE.h);
  back.position.set(0, FACE.y, -0.031);
  back.rotation.y = Math.PI;
  g.add(back);
  return { group: g, screen: front, screenBack: back };
}

function tableSign(p: Piece, color: string): THREE.Group {
  const g = new THREE.Group();
  const steel = toon('#8d99ae');
  // Two cables from the ceiling.
  for (const sx of [-1, 1]) g.add(mesh(new THREE.CylinderGeometry(0.008, 0.008, WALL_HEIGHT - SIGN.y - SIGN.h / 2, 6), steel, sx * (SIGN.w / 2 - 0.25), (WALL_HEIGHT + SIGN.y + SIGN.h / 2) / 2, 0));
  g.add(mesh(box(SIGN.w, SIGN.h, SIGN.d), toon('#1f2233'), 0, SIGN.y, 0));
  // Its words, lit, on both faces, in the sign's colour round their edge.
  for (const side of [1, -1]) {
    const words = textPlane(p.text || 'Project', { bg: '#1f2233', color: '#ffffff', size: 72, border: color });
    words.scale.setScalar(Math.min((SIGN.w - 0.08) / words.geometry.parameters.width, (SIGN.h - 0.08) / words.geometry.parameters.height));
    words.position.set(0, SIGN.y, side * (SIGN.d / 2 + 0.003));
    if (side < 0) words.rotation.y = Math.PI;
    // Its texture and its material are this sign's own (see disposePiece in furniture.ts).
    words.userData.letters = true;
    g.add(words);
  }
  return g;
}

export const TABLE_BUILDERS: Builders = {
  'table-display': (_p, color) => tableDisplay(color),
  'table-sign': (p, color) => tableSign(p, color),
};
