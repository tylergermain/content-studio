import * as THREE from 'three';
import { palette, piece } from '../models';
import { textPlane, toon, toonUnique } from '../toon';
import type { Builders, BuiltPiece } from './furniture-kit';

// The furniture's builders for one part of the catalog (see furniture.ts, and shared/furniture.ts for
// what each kind is and how much floor it takes): the things to play with. Each is a piece of play.glb,
// modelled in Blender (blender/scripts/build_play.py) and painted here by its materials' names, with the
// material called Paint in the piece's own color. What they do is features/playthings', which finds the
// parts that move by the names in PLAY_PARTS.

/** The parts of each piece the playthings move, by the names they have in play.glb. */
export const PLAY_PARTS = {
  /** The trampoline's mat, its origin at its middle: its vertices are pushed down under whoever lands. */
  mat: 'trampoline_mat',
  /** The punching bag on its chains, its origin at the hook it hangs from (BuiltPiece.swing). */
  bag: 'punching_bag_bag',
  /** The can that drops into the vending machine's tray. */
  can: 'vending_machine_can',
  /** Your paddle (its origin at the grip) and the ball on the ping-pong table. */
  paddle: 'ping_pong_paddle',
  ball: 'ping_pong_ball',
  /** The foosball table's eight rods, `foosball_rod_0` from the left end, each turning about its own z; and its ball. */
  rod: 'foosball_rod_',
  foosBall: 'foosball_ball',
  /** The prize wheel, turning about its hub's z, and the flapper over it, flicking about its pin's z. */
  wheel: 'prize_wheel_wheel',
  flapper: 'prize_wheel_flapper',
  /** The high striker's puck on its rail, and the bell it rings. */
  puck: 'high_striker_puck',
  bell: 'high_striker_bell',
} as const;

/** How many rods a foosball table has, and how many tiles a dance mat. */
export const FOOSBALL_RODS = 8;
export const DANCE_TILES = 9;

/**
 * What the prize wheel can land on, one for each of its wedges: wedge `i` runs from i/8 to (i+1)/8 of a
 * turn, counter-clockwise from the top as you face the wheel (the way build_play.py lays them out).
 */
export const WHEEL_PRIZES = [
  { icon: '☕', says: 'Coffee run: you’re buying' },
  { icon: '🕺', says: 'Dance break, right now' },
  { icon: '🍕', says: 'Pizza for lunch' },
  { icon: '🎤', says: 'You pick the music' },
  { icon: '🧘', says: 'Five-minute stretch' },
  { icon: '🏆', says: 'Give someone a shout-out' },
  { icon: '🍩', says: 'Snack round is on you' },
  { icon: '🎲', says: 'Spin again' },
] as const;

/** A dance mat's tiles as they're colored, Tile0 at the back left, row by row to Tile8 at the front right. */
export const TILE_COLORS = ['#ef476f', '#ffd166', '#06d6a0', '#118ab2', '#b388eb', '#ff9f1c', '#06d6a0', '#ef476f', '#ffd166'] as const;

// The colors build_play.py previews them in: the office's ink and steel, its wood, and the catalog's own brights.
const PLAY_COLORS = {
  Frame: '#3d405b',
  Chrome: '#adb5bd',
  Dark: '#2b2d42',
  White: '#f7f3ea',
  Wood: '#c98b5a',
  Red: '#ef476f',
  Blue: '#118ab2',
  Yellow: '#ffd166',
  Green: '#06d6a0',
  Felt: '#2a9d5f',
  Net: '#cfd8e3',
  Ball: '#ff9f1c',
  Brass: '#e9b949',
};
const paintPlay = palette(PLAY_COLORS);
const TILE = /^Tile(\d)$/;

/**
 * The piece called `part` in play.glb, painted: Paint in `color`, what's lit (Glow) glowing, and each of
 * a dance mat's tiles a material of its own, named for its tile, which features/playthings lights.
 */
function play(part: string, color: string): THREE.Group {
  const own = toon(color);
  const g = new THREE.Group();
  g.add(
    piece('play', part, (name) => {
      if (name === 'Paint') return own;
      if (name === 'Glow') return toon('#fff7d6', { emissive: '#ffe08a' });
      // A net you can see the far half of the table through.
      if (name === 'Net') return toon(PLAY_COLORS.Net, { opacity: 0.55 });
      const tile = TILE.exec(name);
      if (!tile) return paintPlay(name);
      // Dim until someone steps on it.
      const mat = toonUnique(TILE_COLORS[Number(tile[1])]);
      mat.name = name;
      mat.emissive = new THREE.Color(TILE_COLORS[Number(tile[1])]);
      mat.emissiveIntensity = 0;
      return mat;
    }),
  );
  return g;
}

/** A trampoline: its mat's shape is its own, not the model's, so it can dip (see PLAY_PARTS.mat). */
function trampoline(color: string): THREE.Group {
  const g = play('trampoline', color);
  const mat = g.getObjectByName(PLAY_PARTS.mat) as THREE.Mesh | undefined;
  if (mat?.isMesh) {
    mat.geometry = mat.geometry.clone();
    mat.userData.shared = false;
  }
  return g;
}

function punchingBag(color: string): BuiltPiece {
  const group = play('punching_bag', color);
  return { group, swing: group.getObjectByName(PLAY_PARTS.bag) };
}

/** A vending machine, its can out of sight until one's bought, and what it sells written on its lit sign. */
function vendingMachine(color: string): THREE.Group {
  const g = play('vending_machine', color);
  const can = g.getObjectByName(PLAY_PARTS.can);
  if (can) can.visible = false;
  // The sign over the window is 0.52 by 0.11, its face 0.348 out from the middle (see vending_machine() in build_play.py).
  const label = textPlane('COLD DRINKS', { color: '#2b2d42', size: 64 });
  label.scale.setScalar(Math.min(0.46 / label.geometry.parameters.width, 0.085 / label.geometry.parameters.height));
  label.position.set(-0.145, 1.825, 0.3495);
  label.userData.letters = true;
  g.add(label);
  return g;
}

/** The prizes' icons round a wheel's face, each over its wedge with its top toward the rim: one picture, unlit like a sign's letters. */
function wheelFace(): THREE.Mesh {
  const px = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = px;
  const c = canvas.getContext('2d')!;
  c.font = `${px * 0.115}px system-ui, sans-serif`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  WHEEL_PRIZES.forEach((prize, i) => {
    const turn = ((i + 0.5) / WHEEL_PRIZES.length) * Math.PI * 2;
    c.save();
    c.translate(px / 2 - Math.sin(turn) * px * 0.31, px / 2 - Math.cos(turn) * px * 0.31);
    c.rotate(-turn);
    c.fillText(prize.icon, 0, 0);
    c.restore();
  });
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.94, 0.94), new THREE.MeshBasicMaterial({ map, transparent: true, alphaTest: 0.05 }));
  // Its picture is its own: let go of with the piece (see disposePiece in furniture.ts).
  face.userData.letters = true;
  return face;
}

function prizeWheel(color: string): THREE.Group {
  const g = play('prize_wheel', color);
  const wheel = g.getObjectByName(PLAY_PARTS.wheel);
  if (wheel) {
    const face = wheelFace();
    // A hair in front of the wedges.
    face.position.z = 0.0075;
    wheel.add(face);
  }
  return g;
}

export const PLAY_BUILDERS: Builders = {
  trampoline: (_p, color) => trampoline(color),
  'punching-bag': (_p, color) => punchingBag(color),
  'vending-machine': (_p, color) => vendingMachine(color),
  'ping-pong': (_p, color) => play('ping_pong', color),
  foosball: (_p, color) => play('foosball', color),
  cushion: (_p, color) => play('cushion', color),
  'dance-mat': (_p, color) => play('dance_mat', color),
  'prize-wheel': (_p, color) => prizeWheel(color),
  'high-striker': (_p, color) => play('high_striker', color),
};
