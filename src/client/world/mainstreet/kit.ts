import * as THREE from 'three';
import { FACADE } from '../facade';
import { bulb, type NightParts } from '../outside';
import { tilingCanvasTexture } from '../texture';
import { toon } from '../toon';

// What everything on Main Street is built with, made once for each place it's drawn (the floors' street,
// and the roof bar's view of it): the glass the shells' windows are glazed with, which the sky lights
// up at night, and the little lights that glow then. A plot is rebuilt whenever what stands on it
// changes, and none of that makes anything new for the sky to keep: it's all here, made the once.

/** The letters on Main Street's signs: a heavy grotesk, as Friday Tower's own are set in. */
export const FONT = "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', Helvetica, Arial, sans-serif";

/** Friday's green, which Main Street's own signs and the heliport are painted in. */
export const GREEN = FACADE.accent;
export const INK = '#2b2d42';

export interface StreetKit {
  night: NightParts;
  /**
   * The shells' glass, as Friday Tower's bars have it (world/tower-bars.ts): three shades the sky
   * catches in stripes, each dark or glowing at night in one of FACADE.lit.
   */
  glass: { dark: THREE.Material[]; lit: THREE.Material[][] };
  /**
   * The red lights on top of the cranes, the heliport's green edge lights, a lamp's lens, and a lobby's
   * glass: tinted by day, glowing warm at night.
   */
  red: THREE.MeshToonMaterial;
  edge: THREE.MeshToonMaterial;
  lobby: THREE.MeshToonMaterial;
  lens: THREE.MeshToonMaterial;
  /** Bare earth, and the mesh in a site's gate (see-through). */
  dirt: THREE.CanvasTexture;
  chain: THREE.CanvasTexture;
}

/** A plain toon material of its own (not the shared one for its color), drawn with no cartoon outline: for big flat faces. */
export function flatPaint(color: THREE.ColorRepresentation): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({ color, gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap });
  m.userData.outlineParameters = { visible: false };
  return m;
}

/** A bulb (see bulb in world/outside.ts) that's `color` by day and glows `glow` at night. */
function glowing(night: NightParts, color: string, glow: string, day: number): THREE.MeshToonMaterial {
  const m = flatPaint(color);
  m.emissive.set(glow);
  m.emissiveIntensity = day;
  night.bulbs.push({ mat: m, day });
  return m;
}

/** Main Street's kit, its lights and glowing glass handed to `night` (see NightParts). */
export function makeStreetKit(night: NightParts): StreetKit {
  const tones = [0.14, 0.32, 0.48].map((t) => new THREE.Color(FACADE.glass).lerp(new THREE.Color(FACADE.ink), t).offsetHSL(0, 0.12, 0));
  const dark = tones.map((c) => flatPaint(c));
  const lit = tones.map((c) =>
    FACADE.lit.map((glow) => {
      const m = flatPaint(c);
      m.emissive.set(glow);
      m.emissiveIntensity = 0;
      night.windows.push(m);
      return m;
    }),
  );
  const dirt = tilingCanvasTexture(128, 128, (g) => {
    g.fillStyle = '#b8976a';
    g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 260; i++) {
      const k = (i * 7919) % 101;
      g.fillStyle = k % 3 ? 'rgba(90, 64, 40, 0.18)' : 'rgba(240, 220, 180, 0.22)';
      g.fillRect((i * 37) % 128, (i * 59 + k) % 128, 2 + (k % 4), 2 + (k % 3));
    }
  });
  const chain = tilingCanvasTexture(64, 64, (g) => {
    g.clearRect(0, 0, 64, 64);
    g.strokeStyle = '#8d99ae';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(64, 64);
    g.moveTo(64, 0);
    g.lineTo(0, 64);
    g.stroke();
  });
  return {
    night,
    glass: { dark, lit },
    red: bulb(night, '#ff3b30', 0.5),
    edge: bulb(night, '#3ddc84', 0.45),
    lobby: glowing(night, '#86a8bb', '#ffd9a0', 0.06),
    lens: bulb(night, '#fff3d6', 0.1),
    dirt,
    chain,
  };
}

/**
 * `night` for a second copy of what the floors' street already lights (the roof bar's view of Main
 * Street): the same bulbs and windows, which the sky turns up at night wherever they are, but lamps
 * and halos that go nowhere. The sky places its lamps once (see Sky.placeLamps) and only has room for
 * so many, so a copy's would be doubled or dropped.
 */
export function lampless(night: NightParts): NightParts {
  return { ...night, lamps: [], halos: [] };
}

/** A small seeded random sequence, so a building's lit windows come out the same every time it's drawn. */
export function seeded(text: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  let s = (h >>> 0) % 2147483646 || 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

/** Ink or warm paper, whichever reads on `color`. */
export function inkOn(color: string): string {
  const c = new THREE.Color(color);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b > 0.35 ? FACADE.ink : FACADE.frame;
}
