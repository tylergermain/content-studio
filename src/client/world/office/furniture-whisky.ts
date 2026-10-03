import * as THREE from 'three';
import { piece } from '../models';
import { toon } from '../toon';
import type { Builders } from './furniture-kit';
import { boxArtTexture, labelTexture } from './whisky-art';
import { crestTexture } from './whisky-label';

// The whisky cabinet's builder (see furniture.ts, and shared/furniture.ts for its footprint): a walnut
// sideboard with The Macallan Litha, a decanter and four glasses on a silver tray, and the bottle's box
// at the end. It's whisky.glb, modelled in Blender (blender/scripts/build_whisky.py) and painted here by
// its materials' names, with Body in the piece's own colour; the bottle's label, its crest and the box's
// artwork are canvases of our own (whisky-label.ts, whisky-art.ts) laid on the surfaces the model maps
// for them. What it does is features/whisky's, which finds the parts it moves by WHISKY_PARTS.

/** The parts features/whisky moves, by the names they have in whisky.glb. */
export const WHISKY_PARTS = {
  /** The decanter, its origin under the middle of its base, and its stopper, its origin under it. */
  decanter: 'whisky_decanter',
  stopper: 'whisky_stopper',
  /** Each glass on the tray (0 to 3), its origin under its base, and the whisky in it, its origin on the glass's floor. */
  glass: (i: number) => `whisky_glass_${i}`,
  dram: (i: number) => `whisky_glass_${i}_dram`,
} as const;

/** What the pour goes by, from build_whisky.py: how high the decanter's lip is over its foot, and a glass's rim over its foot. */
export const WHISKY_SIZES = { lip: 0.226, rim: 0.085 } as const;

/** The office's outline round glass: a soft blue-grey, so it reads as an edge of crystal, not an ink line drawn round it. */
const GLASS_EDGE = { color: [0.46, 0.6, 0.74], alpha: 0.85, thickness: 0.003 };

/**
 * See-through and a little blue: the walls of the bottle, the decanter and the glasses (and the glass
 * a dram's held in, see features/whisky/glass.ts).
 */
export function glass(color: string, opacity: number): THREE.MeshToonMaterial {
  const m = toon(color).clone();
  m.transparent = true;
  m.opacity = opacity;
  m.depthWrite = false;
  m.userData.outlineParameters = GLASS_EDGE;
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
  const glint = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.75, depthWrite: false });
  glint.userData.outlineParameters = { visible: false };
  made = {
    Dark: toon('#3b2a20'),
    Brass: toon('#d9ad4f', { emissive: '#3a2a08' }),
    Silver: toon('#d3d8de'),
    Gold: toon('#dcb35c'),
    Stopper: toon('#a8322a'),
    Box: toon('#26245a'),
    // Amber, with a little warmth of its own so it glows through the glass.
    Whisky: toon('#c8701c', { emissive: '#4a2208' }),
    Crystal: glass('#e8f5ff', 0.34),
    Cut: glass('#dcefff', 0.55),
    Glint: glint,
    Label: painted(labelTexture()),
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
  return g;
}

export const WHISKY_BUILDERS: Builders = {
  'whisky-cabinet': (_p, color) => whiskyCabinet(color),
};
