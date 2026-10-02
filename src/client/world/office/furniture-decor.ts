import * as THREE from 'three';
import { FRAMES, FRAME_BORDER, pictureSize } from '../../../shared/decor';
import { kindDef, type Piece } from '../../../shared/furniture';
import { PAINTING } from '../../../shared/hangings';
import { blankTexture, buildFrame, showTexture } from '../frames';
import { mesh, textPlane, toon } from '../toon';
import type { Builders, BuiltPiece } from './furniture-kit';
import { box } from './materials';

// The furniture's builders for what makes a room of a stretch of wall (see furniture.ts, and
// shared/furniture.ts for what each kind is and how much floor it takes): a painting on it, and the
// doorway through it. Both are built in code: a painting is one of the office's frames (world/frames.ts),
// and a doorway is a few boxes the size of the walls in rooms.glb, which it stands in a row with.

/** How far a painting's frame stands off its wall: what the pictures people hang do (features/hanging), clear of a wall's wood. */
const OFF_WALL = 0.005;
/**
 * How far its back reaches behind the wall's face. A wall the builder put up is a little thinner than
 * its skirting, which is where its face is counted (see wallFaces in shared/wall-faces.ts): the back
 * fills that gap, so the frame lies on the wall and doesn't float off it. In an outside wall it's out of sight.
 */
const BACK = 0.03;

/**
 * A painting: one of the floor's pictures in a frame, the shape and size the piece says (see hangSize in
 * shared/hangings.ts), its origin on the wall's face and its middle `lift` up. `screen` is its picture,
 * for whoever loads the image to show on it (features/hanging); with no picture chosen it's a bare canvas.
 */
function painting(p: Piece): BuiltPiece {
  const { w, h } = pictureSize(p.size ?? PAINTING.size, p.aspect ?? PAINTING.aspect);
  const kind = p.frame ?? PAINTING.frame;
  const { group: frame, picture } = buildFrame(w, h, kind);
  frame.position.set(0, p.lift ?? PAINTING.lift, OFF_WALL);
  // A picture with no frame round it has no back either: it's straight on the wall.
  const paint = (FRAMES[kind] ?? FRAMES[0]).color;
  if (paint) frame.add(mesh(box(w + 2 * FRAME_BORDER, h + 2 * FRAME_BORDER, BACK), toon(paint), 0, 0, -BACK / 2));
  if (!p.media) showTexture(picture, blankTexture(), w / h);
  // Its material is this painting's own, the image on it isn't (see disposePiece in furniture.ts).
  picture.userData.own = true;
  const group = new THREE.Group();
  group.add(frame);
  return { group, screen: picture };
}

/** A doorway's frame (the `doorway` kind's footprint, and a wall's height in rooms.glb): how wide and high the way through is. */
const DOOR = { w: 1.2, h: 2.6, d: 0.14, open: { w: 1, h: 2.1 } };
/** A wall's skirting board and its cap (SKIRT and CAP in build_rooms.py), which a doorway carries on across its posts and its header. */
const SKIRT = 0.1;
const CAP = 0.035;
/** How thick the lining round the way through is. */
const LINING = 0.03;

/** A color `k` times as bright: a doorway's trim is a shade of its paint, as a wall's is (see furniture-rooms.ts). */
const shade = (color: string, k: number) => `#${new THREE.Color(color).multiplyScalar(k).getHexString()}`;

/**
 * A doorway: a frame to walk through, standing in a row of walls where they leave a gap, in the walls'
 * paint (`color`), with `text` over the way through on both sides: the room's name. Nothing of it is in
 * the way (see KindDef.top), and its skirting, cap and thickness are a wall's, so the row reads as one wall.
 */
function doorway(color: string, text: string): THREE.Group {
  const g = new THREE.Group();
  const wall = toon(color);
  const trim = toon(shade(color, 0.84));
  // The wall itself is a little thinner than its trim, which stands proud of it.
  const body = DOOR.d - 0.04;
  const post = (DOOR.w - DOOR.open.w) / 2;
  const head = DOOR.h - DOOR.open.h;
  for (const sx of [-1, 1]) {
    const x = sx * (DOOR.open.w / 2 + post / 2);
    g.add(mesh(box(post, DOOR.open.h, body), wall, x, DOOR.open.h / 2, 0));
    g.add(mesh(box(post, SKIRT, DOOR.d), trim, x, SKIRT / 2, 0));
    // The lining down each side of the way through.
    g.add(mesh(box(LINING, DOOR.open.h, DOOR.d), trim, sx * (DOOR.open.w / 2 + LINING / 2), DOOR.open.h / 2, 0));
  }
  g.add(mesh(box(DOOR.w, head - CAP, body), wall, 0, DOOR.open.h + (head - CAP) / 2, 0));
  g.add(mesh(box(DOOR.w, CAP, DOOR.d - 0.02), trim, 0, DOOR.h - CAP / 2, 0));
  // And across its top.
  g.add(mesh(box(DOOR.open.w + 2 * LINING, LINING, DOOR.d), trim, 0, DOOR.open.h + LINING / 2, 0));
  // The room's name over the door: dark letters on light paint, light ones on dark.
  const c = new THREE.Color(color);
  const ink = c.r * 0.299 + c.g * 0.587 + c.b * 0.114 > 0.6 ? '#2b2d42' : '#fffaf3';
  const room = { w: DOOR.w - 0.14, h: head - CAP - LINING - 0.12 };
  for (const side of [1, -1]) {
    const label = textPlane(text, { color: ink, size: 72 });
    label.scale.setScalar(Math.min(room.w / label.geometry.parameters.width, room.h / label.geometry.parameters.height));
    label.position.set(0, DOOR.open.h + LINING + (head - CAP - LINING) / 2, side * (body / 2 + 0.003));
    // Its texture and its material are this doorway's own (see disposePiece in furniture.ts).
    label.userData.letters = true;
    if (side < 0) label.rotation.y = Math.PI;
    g.add(label);
  }
  return g;
}

export const DECOR_BUILDERS: Builders = {
  painting: (p) => painting(p),
  doorway: (p, color) => doorway(color, p.text ?? kindDef(p.kind).text ?? ''),
};
