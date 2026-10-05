import * as THREE from 'three';
import type { Piece } from '../../../shared/furniture';
import { PROJECT_SIZE } from '../../../shared/project-rooms';
import { mesh, roundedBox, textPlane, toon } from '../toon';
import { box } from './materials';
import type { Builders } from './furniture-kit';

// A project room as it looks (see shared/project-rooms.ts): the floor it marks out, a pale wash of its
// paint with a band of the paint itself round the edge, and the room's name lying on the floor just in
// from its front edge, so whoever walks in reads it. It all lies flat, like a rug: desks stand on it.

/** How wide the band round its edge is, how far in from the front its name lies, and how much of the floor the name may take. */
const ROOM = { band: 0.16, name: { inset: 0.7, w: 0.6, h: 0.9 } } as const;

/** `color` mixed `k` of the way to white: the wash over the room's floor. */
const pale = (color: string, k: number) => `#${new THREE.Color(color).lerp(new THREE.Color('#ffffff'), k).getHexString()}`;

function projectRoom(p: Piece, color: string, lift: number): THREE.Group {
  const w = p.w ?? PROJECT_SIZE.min;
  const d = p.d ?? PROJECT_SIZE.min;
  const g = new THREE.Group();
  const y = 0.008 + lift;
  g.add(mesh(roundedBox(w, 0.012, d, 0.2), toon(pale(color, 0.55)), 0, y, 0, false));
  const band = toon(color);
  for (const sz of [-1, 1]) g.add(mesh(box(w, 0.014, ROOM.band), band, 0, y + 0.002, sz * (d / 2 - ROOM.band / 2), false));
  for (const sx of [-1, 1]) g.add(mesh(box(ROOM.band, 0.014, d - 2 * ROOM.band), band, sx * (w / 2 - ROOM.band / 2), y + 0.002, 0, false));
  const name = textPlane(p.text || 'Project', { color: '#2b2d42', size: 72 });
  const room = { w: w * ROOM.name.w, h: Math.min(ROOM.name.h, d / 4) };
  name.scale.setScalar(Math.min(room.w / name.geometry.parameters.width, room.h / name.geometry.parameters.height));
  // Lying face up, read from the front (+z): its top toward the room's middle.
  name.rotation.x = -Math.PI / 2;
  name.position.set(0, y + 0.012, d / 2 - ROOM.name.inset);
  // Its texture and its material are this room's own (see disposePiece in furniture.ts).
  name.userData.letters = true;
  g.add(name);
  return g;
}

export const PROJECT_BUILDERS: Builders = {
  'project-room': projectRoom,
};
