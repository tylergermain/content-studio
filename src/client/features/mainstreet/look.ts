/**
 * How a business's building is put into words and swatches in the Main Street window: its skins and
 * stages as the form offers them, the colors it suggests, and which ink reads on a color. The street
 * itself (world.ts) paints the real thing; these only have to look like it.
 */
import { BUSINESS_SKINS, BUSINESS_STAGES, type BusinessCard, type BusinessSkin, type BusinessStage } from '../../../shared/protocol';

/** Each skin as the form shows it: its name, and a chip of what it's clad in. */
export const SKINS: Readonly<Record<BusinessSkin, { label: string; chip: string }>> = {
  glass: { label: 'Glass', chip: 'linear-gradient(135deg, #b9d9ee, #6f9fc4)' },
  brick: { label: 'Brick', chip: 'linear-gradient(135deg, #c0674a, #8e3f2a)' },
  graphite: { label: 'Graphite', chip: 'linear-gradient(135deg, #5b5f6b, #2f323a)' },
  timber: { label: 'Timber', chip: 'linear-gradient(135deg, #d39b62, #9c6a3a)' },
};
export const SKIN_ORDER: readonly BusinessSkin[] = BUSINESS_SKINS;

/** Each stage as the form and the plan name it. */
export const STAGES: Readonly<Record<BusinessStage, { label: string; icon: string; note: string }>> = {
  site: { label: 'Building site', icon: '🏗️', note: 'A hoarding in its color, and a tower crane' },
  shell: { label: 'Shell', icon: '🏢', note: 'Its tower, storey by storey, in its colors' },
};
export const STAGE_ORDER: readonly BusinessStage[] = BUSINESS_STAGES;

/** Colors the form suggests: bright enough to pick a building out down the street. */
export const ACCENTS: readonly string[] = ['#ff7a45', '#3a86ff', '#8338ec', '#ff006e', '#06b6a4', '#ffbe0b', '#2fbf71', '#e63946'];

/** A color for a new business: the first suggestion nobody on the street has yet. */
export const freshAccent = (cards: readonly BusinessCard[]): string => ACCENTS.find((a) => !cards.some((c) => c.accent.toLowerCase() === a)) ?? ACCENTS[0];

/** The ink that reads on `hex` ('#rrggbb'): near-black on a light color, white on a dark one. */
export function inkOn(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  if (!Number.isFinite(n)) return '#1d1d1f';
  // Relative luminance (sRGB), against the point where black and white text read about as well.
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const l = 0.2126 * lin(((n >> 16) & 255) / 255) + 0.7152 * lin(((n >> 8) & 255) / 255) + 0.0722 * lin((n & 255) / 255);
  return l > 0.179 ? '#1d1d1f' : '#ffffff';
}

export const storeysText = (n: number): string => `${n} ${n === 1 ? 'storey' : 'storeys'}`;
