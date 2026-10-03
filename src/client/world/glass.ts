// Glass for the labels that float over people and workers (world/toon.ts draws them on canvases): the
// look of the interface's panels (styles/base.css), as near as a canvas gets. It can't blur what's
// behind it, so the fill is a see-through one that's lighter at the top, with a light hairline round
// it and a soft shadow under it.

/** The interface's font (--font in styles/base.css). */
export const GLASS_FONT = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display', 'Inter', system-ui, sans-serif";
/** The interface's ink, and its quieter grey. */
export const GLASS_INK = '#1d1d1f';
export const GLASS_MUTED = '#55555a';

export interface GlassTone {
  /** The fill, from its top edge to its bottom. */
  top: string;
  bottom: string;
  /** The hairline round it. */
  edge: string;
  /** Dark enough that words on it are white. */
  dark: boolean;
}

/** A `#rgb` or `#rrggbb` color's channels; white for anything else. */
function channels(color: string): [number, number, number] {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())?.[1];
  if (!hex) return [255, 255, 255];
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

/** How far a color is from grey: 0 for a grey, 255 for a pure hue. */
function strength(color: string): number {
  const c = channels(color);
  return Math.max(...c) - Math.min(...c);
}

/**
 * A label's color as glass. A pale one (cream, white, a pastel) is frosted white with a breath of
 * its tint; a dark one is smoked glass; a strong one (a status color) stays itself, see-through, so
 * it still says what it said.
 */
export function glassTone(bg: string): GlassTone {
  const c = channels(bg);
  const luma = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  /** The color with `t` of white mixed in, at opacity `a`. */
  const mix = (t: number, a: number) => `rgba(${c.map((v) => Math.round(v + (255 - v) * t)).join(', ')}, ${a})`;
  if (Math.max(...c) < 100) return { top: 'rgba(74, 74, 80, .82)', bottom: 'rgba(30, 30, 34, .8)', edge: 'rgba(255, 255, 255, .3)', dark: true };
  if (luma > 190 && strength(bg) < 110) return { top: mix(0.6, 0.9), bottom: mix(0.35, 0.8), edge: 'rgba(255, 255, 255, .92)', dark: false };
  return { top: mix(0.24, 0.94), bottom: mix(0, 0.88), edge: 'rgba(255, 255, 255, .55)', dark: luma < 140 };
}

/** The color for words on glass: the old labels' cream and navy become the interface's white and ink. */
export function glassInk(color: string | undefined, tone: GlassTone | null): string {
  if (!color) return tone?.dark ? '#ffffff' : GLASS_INK;
  if (strength(color) > 60) return color;
  return Math.max(...channels(color)) > 200 ? '#ffffff' : Math.max(...channels(color)) < 100 ? GLASS_INK : color;
}

/** An outline color that means something (a pull request's green, the red of a worker asking), or nothing for a plain cream or ink one. */
export function glassRing(border: string | undefined): string | undefined {
  return border && strength(border) > 70 ? border : undefined;
}

/**
 * Paints the path now on `ctx` as glass: its shadow, the fill from `y0` down to `y1`, and the
 * hairline, or `ring` in its place. `u` is how many canvas pixels make one of the interface's.
 */
export function paintGlass(ctx: CanvasRenderingContext2D, tone: GlassTone, y0: number, y1: number, u: number, ring?: string) {
  const fill = ctx.createLinearGradient(0, y0, 0, y1);
  fill.addColorStop(0, tone.top);
  fill.addColorStop(1, tone.bottom);
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, .28)';
  ctx.shadowBlur = 9 * u;
  ctx.shadowOffsetY = 3 * u;
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.restore();
  ctx.lineJoin = 'round';
  const line = (ring ? 2.5 : 1.5) * u;
  // A faint dark rim just outside the hairline, so the edge shows against a pale wall too.
  ctx.lineWidth = line + 1.5 * u;
  ctx.strokeStyle = 'rgba(0, 0, 0, .12)';
  ctx.stroke();
  ctx.lineWidth = line;
  ctx.strokeStyle = ring ?? tone.edge;
  ctx.stroke();
}

/** The room a glass shape's shadow needs round it on the canvas. */
export const glassMargin = (u: number) => Math.ceil(13 * u);
