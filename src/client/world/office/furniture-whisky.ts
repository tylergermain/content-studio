import * as THREE from 'three';
import { piece } from '../models';
import { toon } from '../toon';
import type { Builders } from './furniture-kit';
import { boxArtTexture, wrapTexture } from './whisky-art';
import { crestTexture } from './whisky-label';

// The whisky cabinet's builder (see furniture.ts, and shared/furniture.ts for its footprint): a walnut
// sideboard with The Macallan Litha, a decanter and four glasses on a silver tray, and the bottle's box
// at the end. It's whisky.glb, modelled in Blender (blender/scripts/build_whisky.py) and painted here by
// its materials' names, with Body in the piece's own colour; the bottle's wrap (the Litha's artwork all
// the way round it, the cream label inset at the front), its crest and the box's artwork are canvases of
// our own (whisky-label.ts, whisky-art.ts) laid on the surfaces the model maps for them. What it does is
// features/whisky's, which finds the parts it moves by WHISKY_PARTS.

/** The parts features/whisky moves, by the names they have in whisky.glb. */
export const WHISKY_PARTS = {
  /** The decanter, its origin under the middle of its base; its stopper, its origin under it; and the whisky in it, hidden while it's tipped. */
  decanter: 'whisky_decanter',
  stopper: 'whisky_stopper',
  contents: 'whisky_decanter_whisky',
  /** Each glass on the tray (0 to 3), its origin under its base, and the whisky in it, its origin on the glass's floor. */
  glass: (i: number) => `whisky_glass_${i}`,
  dram: (i: number) => `whisky_glass_${i}_dram`,
} as const;

/**
 * What the pour goes by, from build_whisky.py: how high the decanter's lip is over its foot, a glass's
 * rim over its foot, how high the stopper's ball is over its origin, and where on the tray (the
 * cabinet's own frame) the ball's middle is while it pours: laid on its side, a ball's radius over the
 * tray, between the bottle and the decanter.
 */
export const WHISKY_SIZES = { lip: 0.226, rim: 0.085, stopperBall: 0.036, stopperDown: [0.02, 0.837, 0.09] } as const;

/** The office's outline round glass: a blue-grey, so it reads as an edge of crystal, not an ink line drawn round it, and shows on a pale floor. */
const GLASS_EDGE = { color: [0.36, 0.48, 0.62], alpha: 0.95, thickness: 0.003 };
/** The decanter's, a little stronger: half of it is empty glass, and it has to stand out against the floor behind it. */
const DECANTER_EDGE = { color: [0.27, 0.37, 0.5], alpha: 1, thickness: 0.0045 };

/**
 * See-through and a little blue: the walls of the bottle, the decanter and the glasses (and the glass
 * a dram's held in, see features/whisky/glass.ts).
 */
export function glass(color: string, opacity: number, edge: object = GLASS_EDGE): THREE.MeshToonMaterial {
  const m = toon(color).clone();
  m.transparent = true;
  m.opacity = opacity;
  m.depthWrite = false;
  m.userData.outlineParameters = edge;
  return m;
}

/** Whisky: a deep golden amber with a little glow of its own, so it reads as a liquid through the glass, not painted wood. */
export function whisky(color = '#a9580c'): THREE.MeshToonMaterial {
  const m = toon(color, { emissive: '#3c1a02' }).clone();
  m.userData.outlineParameters = { color: [0.42, 0.22, 0.06], alpha: 0.7, thickness: 0.002 };
  return m;
}

/** A surface showing one of the canvases: lit like the rest of the bottle, with no outline of its own. */
function painted(map: THREE.Texture, clear = false): THREE.MeshToonMaterial {
  const m = toon('#ffffff').clone();
  m.map = map;
  if (clear) {
    m.transparent = true;
    m.alphaTest = 0.4;
  }
  m.userData.outlineParameters = { visible: false };
  return m;
}

let made: Record<string, THREE.Material> | null = null;

/** Every material but Body, made the first time a cabinet is built and shared by all of them. */
function materials(): Record<string, THREE.Material> {
  if (made) return made;
  // A breath of light on the glass, not a white bar.
  const glint = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.32, depthWrite: false });
  glint.userData.outlineParameters = { visible: false };
  made = {
    Dark: toon('#3b2a20'),
    // The pulls, and the bands on the bottle's capsule.
    Brass: toon('#d9ad4f', { emissive: '#3a2a08' }),
    Silver: toon('#d3d8de'),
    Stopper: toon('#a8322a'),
    Box: toon('#26245a'),
    Whisky: whisky(),
    // A cool grey-blue, thin enough that the whisky behind it stays amber: its edge is what shows the
    // glass over the whisky against a pale floor (GLASS_EDGE).
    Crystal: glass('#cfe0ee', 0.26),
    Decanter: glass('#bfd4e6', 0.32, DECANTER_EDGE),
    Cut: glass('#c6dcee', 0.5),
    Glint: glint,
    Label: painted(wrapTexture()),
    Crest: painted(crestTexture(), true),
    Art: painted(boxArtTexture()),
  };
  return made;
}

/** The cabinet in `color`, its glasses on the tray empty (features/whisky fills one as it's poured). */
function whiskyCabinet(color: string): THREE.Group {
  const body = toon(color);
  const mats = materials();
  const g = new THREE.Group();
  g.add(piece('whisky', 'whisky_cabinet', (name) => (name === 'Body' ? body : (mats[name] ?? toon('#ff00ff')))));
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    // Glass and light cast no shadow.
    if (m.isMesh && (m.material as THREE.Material).transparent) m.castShadow = false;
  });
  for (let i = 0; i < 4; i++) {
    const dram = g.getObjectByName(WHISKY_PARTS.dram(i));
    if (dram) dram.visible = false;
  }
  // The decanter's crystal a shade stronger than the bottle's and the glasses' (its stopper and its whisky are Cut and Whisky).
  g.getObjectByName(WHISKY_PARTS.decanter)?.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.material === mats.Crystal) m.material = mats.Decanter;
  });
  return g;
}

export const WHISKY_BUILDERS: Builders = {
  'whisky-cabinet': (_p, color) => whiskyCabinet(color),
};
