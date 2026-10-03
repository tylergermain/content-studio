import { FLOOR_PALETTES, type FloorPalette } from '../../../shared/floors';

// What the boss's office up in the corner loft is upholstered and lit in: the floor's own colors, as
// the rest of it is painted in them (see Office.setLook). Its couch is the palette's ink, its cushion
// the trim sunk deep, its rug the walls' paper and its lamp's shade the trim. A brand's palette brings
// its own ink and deep shade (Friday Labs' ink and deep green); any other has them worked out from its
// trim, so each floor's office is in its own family of colors. No three.js here: it's colors.

/** What the boss's office is covered in: its couch, the cushion on it, its rug and its lamp's shade. */
export interface BossLook {
  couch: string;
  cushion: string;
  rug: string;
  shade: string;
}

/** What a palette is to the boss's office: its walls and trim, and its name if it's one of FLOOR_PALETTES. */
export type BossPalette = Pick<FloorPalette, 'wall' | 'trim'> & { name?: string };

/** The brands' own ink and deep shade, by their palette's name (see FLOOR_PALETTES). */
const BRANDS: Readonly<Record<string, Pick<BossLook, 'couch' | 'cushion'>>> = {
  Friday: { couch: '#0a0b12', cushion: '#087d3b' },
};

/** The warm paper a rug is on a floor whose walls are too dark to lay one in. */
const PAPER = '#f5f6f2';

/** `hex` (#rrggbb) as hue (0 to 360), saturation and lightness (0 to 1). */
function hsl(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

/** The color of hue `h`, saturation `s` and lightness `l`, as #rrggbb. */
function hex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const m = l - c / 2;
  return `#${[r, g, b].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('')}`;
}

/** The boss's office on a floor painted in `p`. */
export function bossLook(p: BossPalette): BossLook {
  const [h, s, l] = hsl(p.trim);
  return {
    // Nearly black, with a little of the trim's hue in it.
    couch: hex(h, Math.min(s, 0.3), 0.07),
    // The trim, sunk to two thirds of its lightness.
    cushion: hex(h, s, l * 0.63),
    rug: hsl(p.wall)[2] > 0.5 ? p.wall : PAPER,
    shade: p.trim,
    ...(p.name ? BRANDS[p.name] : undefined),
  };
}

/**
 * Which palette a floor painted with walls `wall` and trim `trim` (#rrggbb, any case) is: the one of
 * FLOOR_PALETTES with those two (which is all a floor is ever painted in), else one of its own.
 */
export function paletteOf(wall: string, trim: string): BossPalette {
  const w = wall.toLowerCase();
  const t = trim.toLowerCase();
  return FLOOR_PALETTES.find((p) => p.wall === w && p.trim === t) ?? { wall: w, trim: t };
}
