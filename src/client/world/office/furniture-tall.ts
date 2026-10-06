import * as THREE from 'three';
import { pieceLength, type Piece } from '../../../shared/furniture';
import { WALL_HEIGHT } from '../../../shared/layout';
import { mesh, textPlane, toon } from '../toon';
import type { Builders, BuiltPiece } from './furniture-kit';
import { box, GLASS, glassPane } from './materials';

// The builders for the walls that go up to the ceiling (see shared/furniture.ts: 'tall-wall', 'tall-glass' and
// 'glass-door'), built in code since each is as long as it's laid down: a painted wall with its skirting, glass
// in a slim frame with a transom at door height and a frosted band at eye level, and an automatic door whose
// leaves slide apart as anyone comes up to it (furnish.ts hands it to the office's doors), under the room's
// name lit up. Each runs a couple of centimetres past its ends, so where two meet there's no seam of light.

/** A color `k` times as bright: a wall's skirting is a shade of its paint, as the low walls' are. */
const shade = (color: string, k: number) => `#${new THREE.Color(color).multiplyScalar(k).getHexString()}`;
const SKIRT = 0.1;
/** The rail across glass and doors alike: where a door's head is, and the transom glass starts over it. */
const TRANSOM = 2.6;
const RAIL = 0.06;
const POST = 0.05;
/** The frosted band across the glass at eye level, so nobody walks into it. */
const BAND = { y: 1.05, h: 0.14 };
const OVERRUN = 0.02;
const FROST = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide });

/** A painted wall from the floor to the ceiling, `color` its paint and its skirting a shade darker. */
function tallWall(p: Piece, color: string): THREE.Group {
  const g = new THREE.Group();
  const len = pieceLength(p) + 2 * OVERRUN;
  const d = 0.14;
  g.add(mesh(box(len, WALL_HEIGHT - SKIRT, d - 0.02), toon(color), 0, SKIRT + (WALL_HEIGHT - SKIRT) / 2, 0));
  g.add(mesh(box(len, SKIRT, d), toon(shade(color, 0.8)), 0, SKIRT / 2, 0));
  return g;
}

/** Plain glass `w` by `h` with its middle at (x, y): the transom's, over the rail. */
function pane(w: number, h: number, x: number, y: number): THREE.Mesh {
  return mesh(new THREE.PlaneGeometry(w, h), GLASS, x, y, 0, false);
}

/**
 * Glass from the floor to the ceiling, `len` long: posts no more than 1.6 apart, rails along the floor, at the
 * transom and along the ceiling in `color`, glass with a glint below the transom and plain above it, and the
 * frosted band. `skip` is a stretch along it that's left open (a door's way through).
 */
function glassRun(g: THREE.Group, len: number, color: string, depth = 0.1) {
  const frame = toon(color);
  const bays = Math.max(1, Math.ceil(len / 1.6));
  const bay = len / bays;
  g.add(mesh(box(len + 2 * OVERRUN, RAIL, depth), frame, 0, RAIL / 2, 0));
  g.add(mesh(box(len + 2 * OVERRUN, RAIL, depth), frame, 0, TRANSOM, 0));
  g.add(mesh(box(len + 2 * OVERRUN, RAIL, depth), frame, 0, WALL_HEIGHT - RAIL / 2, 0));
  for (let i = 0; i <= bays; i++) g.add(mesh(box(POST, WALL_HEIGHT, depth), frame, -len / 2 + i * bay, WALL_HEIGHT / 2, 0));
  const low = TRANSOM - RAIL / 2 - RAIL, high = WALL_HEIGHT - RAIL - (TRANSOM + RAIL / 2);
  for (let i = 0; i < bays; i++) {
    const x = -len / 2 + (i + 0.5) * bay;
    const w = bay - POST;
    const lower = glassPane(w, low);
    lower.position.set(x, RAIL + low / 2, 0);
    g.add(lower);
    g.add(pane(w, high, x, TRANSOM + RAIL / 2 + high / 2));
    g.add(mesh(new THREE.PlaneGeometry(w, BAND.h), FROST, x, BAND.y, 0.004, false));
  }
}

function tallGlass(p: Piece, color: string): THREE.Group {
  const g = new THREE.Group();
  glassRun(g, pieceLength(p), color);
  return g;
}

/**
 * An automatic glass door, the 'glass-door' kind's 1.4 m: two framed leaves that slide apart past the glass on
 * either side (show(open), 0 shut to 1 open), its posts and the rail over it in `color`, the transom glass up to
 * the ceiling, and `text` lit on a sign over the way through, on both sides, and on a blade sign out from its front
 * (its +z: the hallway's side). Nothing of it is in the way.
 */
function glassDoor(p: Piece, color: string): BuiltPiece {
  const g = new THREE.Group();
  const W = 1.4;
  const frame = toon(color);
  const leafH = TRANSOM - RAIL / 2 - 0.02;
  const leafW = W / 2 + 0.02;
  // Its posts, the rail at the transom and along the ceiling, and the glass between them.
  for (const sx of [-1, 1]) g.add(mesh(box(POST, WALL_HEIGHT, 0.12), frame, sx * (W / 2 - POST / 2), WALL_HEIGHT / 2, 0));
  g.add(mesh(box(W, RAIL * 2, 0.12), frame, 0, TRANSOM, 0));
  g.add(mesh(box(W, RAIL, 0.12), frame, 0, WALL_HEIGHT - RAIL / 2, 0));
  const high = WALL_HEIGHT - RAIL - (TRANSOM + RAIL);
  g.add(pane(W - 2 * POST, high, 0, TRANSOM + RAIL + high / 2));
  // The leaves, on the near side of the line the glass is on so they slide past it.
  const leaves = [-1, 1].map((sx) => {
    const leaf = new THREE.Group();
    const stile = 0.045;
    for (const ex of [-1, 1]) leaf.add(mesh(box(stile, leafH, 0.04), frame, ex * (leafW / 2 - stile / 2), leafH / 2, 0));
    leaf.add(mesh(box(leafW, 0.07, 0.04), frame, 0, 0.035, 0));
    leaf.add(mesh(box(leafW, 0.045, 0.04), frame, 0, leafH - 0.0225, 0));
    const glass = glassPane(leafW - 2 * stile, leafH - 0.12);
    glass.position.set(0, 0.07 + (leafH - 0.12) / 2, 0);
    leaf.add(glass);
    leaf.add(mesh(new THREE.PlaneGeometry(leafW - 2 * stile, BAND.h), FROST, 0, BAND.y, 0.004, false));
    // The pull, by the meeting edge.
    leaf.add(mesh(box(0.025, 0.5, 0.06), toon('#c9ccd3'), -sx * (leafW / 2 - 0.12), 1.05, 0));
    leaf.position.set(sx * (leafW / 2 - 0.02), 0, 0.07);
    leaf.traverse((o) => (o.userData.noBatch = true));
    g.add(leaf);
    return { leaf, sx, shut: leaf.position.x };
  });
  // The room's name, lit, over the way through: on both sides.
  for (const side of [1, -1]) {
    const sign = textPlane(p.text || 'Room', { bg: '#1f2233', color: '#ffffff', size: 64, border: '#ffd166' });
    const s = Math.min((W + 0.5) / sign.geometry.parameters.width, 0.34 / sign.geometry.parameters.height);
    sign.scale.setScalar(s);
    sign.position.set(0, TRANSOM + 0.3, side * 0.075);
    if (side < 0) sign.rotation.y = Math.PI;
    // Its texture and its material are this door's own (see disposePiece in furniture.ts).
    sign.userData.letters = true;
    g.add(sign);
  }
  // And a blade sign by the door on its front (+z), out across the way past it, to read from down the hallway.
  const blade = textPlane(p.text || 'Room', { bg: '#1f2233', color: '#ffffff', size: 56, border: '#ffd166' });
  const bs = Math.min(0.7 / blade.geometry.parameters.width, 0.26 / blade.geometry.parameters.height);
  for (const side of [1, -1]) {
    const face = side > 0 ? blade : blade.clone();
    face.scale.setScalar(bs);
    face.rotation.y = side * (Math.PI / 2);
    face.position.set(W / 2 + side * 0.006, TRANSOM + 0.62, 0.45);
    face.userData.letters = true;
    g.add(face);
  }
  g.add(mesh(box(0.02, 0.02, 0.3), toon(color), W / 2, TRANSOM + 0.82, 0.25));
  const show = (k: number) => {
    const e = k * k * (3 - 2 * k);
    for (const l of leaves) l.leaf.position.x = l.shut + l.sx * e * (leafW - 0.08);
  };
  return { group: g, door: { show } };
}

export const TALL_BUILDERS: Builders = {
  'tall-wall': (p, color) => tallWall(p, color),
  'tall-glass': (p, color) => tallGlass(p, color),
  'glass-door': (p, color) => glassDoor(p, color),
};
