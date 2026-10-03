import * as THREE from 'three';
import { piece } from '../models';
import { toon } from '../toon';
import type { Builders } from './furniture-kit';
import { boxArtTexture, wrapTexture } from './whisky-art';
import { crestTexture } from './whisky-label';
import { GLASS_ORDER, LIQUID_ORDER, dramGeometry, liquid } from './whisky-liquid';

// The whisky cabinet's builder (see furniture.ts, and shared/furniture.ts for its footprint): a walnut
// sideboard with The Macallan Litha, a decanter and four glasses on a silver tray, and the bottle's box
// at the end. It's whisky.glb, modelled in Blender (blender/scripts/build_whisky.py) and painted here by
// its materials' names, with Body in the piece's own colour; the bottle's wrap (the Litha's artwork all
// the way round it, the cream label inset at the front), its crest and the box's artwork are canvases of
// our own (whisky-label.ts, whisky-art.ts) laid on the surfaces the model maps for them. What it does is
// features/whisky's, which finds the parts it moves by WHISKY_PARTS.

/** The parts features/whisky moves, by the names they have in whisky.glb. */
export const WHISKY_PARTS = {
  /** The decanter, its origin under the middle of its base; its stopper, its origin under it; and the whisky in it, standing (features/whisky pours with its own, which lies level). */
  decanter: 'whisky_decanter',
  stopper: 'whisky_stopper',
  contents: 'whisky_decanter_whisky',
  /** Each glass on the tray (0 to 3), its origin under its base, and the whisky in it, its origin on the glass's floor. */
  glass: (i: number) => `whisky_glass_${i}`,
  dram: (i: number) => `whisky_glass_${i}_dram`,
} as const;

/**
 * What the pour goes by, from build_whisky.py: how high the decanter's lip is over its foot and how far
 * out its edge is; a glass's rim over its foot, its floor (where its whisky stands), how far in its
 * wall is and how deep a dram in it is; how high the stopper's ball is over its origin, and where on
 * the tray (the cabinet's own frame) the ball's middle is while it pours: laid on its side, a ball's
 * radius over the tray, between the bottle and the decanter.
 */
export const WHISKY_SIZES = {
  lip: 0.226,
  lipRadius: 0.021,
  rim: 0.085,
  glassFloor: 0.016,
  glassInside: 0.0365,
  dram: 0.032,
  stopperBall: 0.036,
  stopperDown: [0.02, 0.837, 0.09],
} as const;

/** The office's outline round glass: a blue-grey, so it reads as an edge of crystal, not an ink line drawn round it, and shows on a pale floor. */
const GLASS_EDGE = { color: [0.36, 0.48, 0.62], alpha: 0.95, thickness: 0.003 };
/** The decanter's, a little stronger: half of it is empty glass, and it has to stand out against the floor behind it. */
const DECANTER_EDGE = { color: [0.24, 0.34, 0.48], alpha: 1, thickness: 0.005 };

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
/** The whisky in a glass on the tray, every cabinet's. */
let trayDram: THREE.BufferGeometry | null = null;

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
    // The bottle's whisky, see-through as whisky is, under a lighter surface (whisky-liquid.ts).
    Whisky: liquid().shaded,
    WhiskyTop: liquid().top,
    // A cool grey-blue, thin enough that the whisky behind it stays amber: its edge is what shows the
    // glass over the whisky against a pale floor (GLASS_EDGE).
    Crystal: glass('#d8e6f1', 0.2),
    Decanter: glass('#c8dbea', 0.26, DECANTER_EDGE),
    Cut: glass('#c6dcee', 0.5),
    // The bevels between the decanter's panels, catching the light.
    Bevel: glass('#f2f8ff', 0.62, DECANTER_EDGE),
    // Light lying on a whole panel of the decanter: faint, and no edge of its own.
    Sheen: glass('#ffffff', 0.2, { visible: false }),
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
  // The whisky in each glass on the tray, as a dram is in a glass in hand (empty until it's poured).
  for (let i = 0; i < 4; i++) {
    const dram = g.getObjectByName(WHISKY_PARTS.dram(i)) as THREE.Mesh | undefined;
    if (!dram?.isMesh) continue;
    dram.geometry = trayDram ??= dramGeometry(WHISKY_SIZES.glassInside, WHISKY_SIZES.dram, 16);
    dram.material = [liquid().side, liquid().top];
    dram.visible = false;
  }
  // The decanter's crystal a shade stronger than the bottle's and the glasses', and its bevels brighter
  // (its foot is a bevel too; its stopper stays Cut).
  const decanter = g.getObjectByName(WHISKY_PARTS.decanter);
  const own = (o: THREE.Object3D) => o.name !== WHISKY_PARTS.stopper && o.name !== WHISKY_PARTS.contents;
  // Its own shapes: itself, or each of its materials' (not its stopper's nor its whisky's).
  for (const o of decanter ? [decanter, ...decanter.children.filter(own)] : []) {
    const m = o as THREE.Mesh;
    if (m.isMesh) m.material = m.material === mats.Crystal ? mats.Decanter : m.material === mats.Cut ? mats.Bevel : m.material;
  }
  // See-through things in their order: the whisky, then the glass round it.
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const all = Array.isArray(m.material) ? m.material : [m.material];
    if (all.some((x) => x === mats.Whisky || x === mats.WhiskyTop || x === liquid().side)) m.renderOrder = LIQUID_ORDER;
    else if (all.some((x) => x.transparent)) m.renderOrder = GLASS_ORDER;
  });
  return g;
}

export const WHISKY_BUILDERS: Builders = {
  'whisky-cabinet': (_p, color) => whiskyCabinet(color),
};
