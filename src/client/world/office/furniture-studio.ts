import * as THREE from 'three';
import { kindDef } from '../../../shared/furniture';
import { palette, piece } from '../models';
import { toon } from '../toon';
import { BLACK, screenMesh, type Builders, type BuiltPiece } from './furniture-kit';
import { GREENERY_BUILDERS } from './furniture-greenery';

// The furniture's builders for the studio's own things (see furniture.ts, and shared/furniture.ts for
// what each kind is and how much floor it takes): what a content team works at and with. They're
// modelled in Blender (blender/scripts/build_studio.py): each is a painted copy of one piece of
// studio.glb (see piece()), oak and black steel. What shows a picture or words is laid over the model
// here: a screen's face, the ticker's two faces, a neon sign's letters.

/**
 * What isn't a piece's own paint: Steel is the office's ink and Oak the tables' wood; a camera's body,
 * the glass of its lens and its red light; a softbox's black cloth; the board a neon sign is on.
 */
const STUDIO_COLORS = { Steel: BLACK, Chrome: '#c9ced6', Oak: '#c9a36b', Shade: '#22242e', Camera: '#4a4e69', Lens: '#7fb7e6', Panel: '#1b1d2e' };
const paintStudio = palette(STUDIO_COLORS);
/** A camera's tally light, lit. */
const TALLY = '#ef476f';

/** Something that gives light of its own: the same color lit and unlit, so it never falls into shadow. */
const lit = (color: string) => toon(color, { emissive: color });

/** A piece of studio.glb, the materials in `own` painted the piece's way and the rest the pack's. */
function studio(part: string, own: Record<string, THREE.Material> = {}): THREE.Group {
  const g = new THREE.Group();
  g.add(piece('studio', part, (name) => own[name] ?? (name === 'Tally' ? lit(TALLY) : paintStudio(name))));
  return g;
}

/** The video screen's face (FACE in build_studio.py): 16:9, its middle 1.22 up, a hair in front of its body. */
const FACE = { w: 1.98, h: 1.11, y: 1.22, z: 0.032 };

/**
 * A video screen on a studio cart, its body in `color`: `screen` is its 16:9 face, which plays the
 * floor's videos (features/screens), 1.98 by 1.11, its middle 1.22 up, facing the front (+z).
 */
function videoScreen(color: string): BuiltPiece {
  const g = studio('screen', { Body: toon(color) });
  const screen = screenMesh(FACE.w, FACE.h);
  screen.position.set(0, FACE.y, FACE.z);
  g.add(screen);
  return { group: g, screen };
}

/** The ticker's faces (TICKER in build_studio.py): how wide and high, how high up, and how far out either side of the bar. */
const TICKER = { w: 5.84, h: 0.3, y: 2.42, z: 0.072 };

/**
 * A stock ticker hung from the ceiling: a long dark bar over your head with a face either side, which
 * the market's prices slide along (features/studio). Each face is 5.84 by 0.3, UV 0 to 1 across it.
 */
function tickerBar(): BuiltPiece {
  const g = studio('ticker');
  const ticker = [1, -1].map((side) => {
    const face = screenMesh(TICKER.w, TICKER.h, '#0a0d12');
    face.position.set(0, TICKER.y, side * TICKER.z);
    if (side < 0) face.rotation.y = Math.PI;
    g.add(face);
    return face;
  });
  return { group: g, ticker };
}

/** Where a neon sign's words go on its board (NEON in build_studio.py): how wide and high they may be, and where their middle is. */
const NEON = { w: 2.1, h: 0.42, y: 1.9, z: 0.083 };
/** The canvas the words are drawn on: as wide for its height as the room they have, with room round them for their glow. */
const NEON_CANVAS = { w: 1280, h: 320, margin: 48 };

/**
 * A neon sign's words: `text` drawn as lit tubes in `color`, bright at the core with the color's glow
 * round it, as big as fits the board. Unlit and see-through, so only the tubes show.
 */
function neonLetters(text: string, color: string): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = NEON_CANVAS.w;
  canvas.height = NEON_CANVAS.h;
  const ctx = canvas.getContext('2d')!;
  const room = { w: canvas.width - 2 * NEON_CANVAS.margin, h: canvas.height - 2 * NEON_CANVAS.margin };
  let size = room.h * 0.92;
  const font = () => `800 ${size}px Nunito, ui-rounded, system-ui, sans-serif`;
  ctx.font = font();
  size *= Math.min(1, room.w / Math.max(1, ctx.measureText(text).width));
  ctx.font = font();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const x = canvas.width / 2;
  const y = canvas.height / 2 + size * 0.04;
  // The glow, twice over so it's thick near the tube, then the tube itself, nearly white at its core.
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.lineWidth = size * 0.085;
  for (const blur of [size * 0.3, size * 0.12]) {
    ctx.shadowBlur = blur;
    ctx.strokeText(text, x, y);
  }
  ctx.shadowBlur = 0;
  ctx.strokeStyle = `#${new THREE.Color(color).lerp(new THREE.Color('#ffffff'), 0.72).getHexString()}`;
  ctx.lineWidth = size * 0.04;
  ctx.strokeText(text, x, y);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  const mat = new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false });
  // As wide and high as the words' room and their glow's margin.
  const scale = NEON.w / room.w;
  const letters = new THREE.Mesh(new THREE.PlaneGeometry(canvas.width * scale, canvas.height * scale), mat);
  // Its texture and its material are this sign's own (see disposePiece in furniture.ts).
  letters.userData.letters = true;
  return letters;
}

/**
 * A neon sign hung at head height: a dark board on two wires from the ceiling, a lit tube round it and
 * `text` in lit letters on it, all in `color`. It hangs at the front of its footprint, so put where a
 * wall stands it lies on the wall's face.
 */
function neonSign(color: string, text: string): THREE.Group {
  const g = studio('neon', { Neon: lit(color) });
  const letters = neonLetters(text, color);
  letters.position.set(0, NEON.y, NEON.z);
  g.add(letters);
  return g;
}

export const STUDIO_BUILDERS: Builders = {
  'long-table': (_p, color) => studio('long_table', { Top: toon(color) }),
  'podcast-desk': (_p, color) => studio('podcast_desk', { Top: toon(color) }),
  screen: (_p, color) => videoScreen(color),
  ticker: () => tickerBar(),
  // Its face is the light it gives, in the piece's color.
  softbox: (_p, color) => studio('softbox', { Glow: lit(color) }),
  camera: () => studio('camera'),
  backdrop: (_p, color) => studio('backdrop', { Paper: toon(color) }),
  'lounge-chair': (_p, color) => studio('lounge_chair', { Cloth: toon(color) }),
  stool: (_p, color) => studio('stool', { Cloth: toon(color) }),
  credenza: (_p, color) => studio('credenza', { Cabinet: toon(color) }),
  neon: (p, color) => neonSign(color, p.text ?? kindDef(p.kind).text ?? ''),
  // The plants that came with the studio are built beside this file.
  ...GREENERY_BUILDERS,
};
