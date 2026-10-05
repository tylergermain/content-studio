// The building's outside in one place: what it's clad and glazed in, how the tower over the real
// floors is drawn, its name and sign, and each real storey's name and color. The walls of the floor
// you're on (office/shell.ts), the rest of the tower (tower.ts), its signs and the street all read it.
// No three.js here: it's colors, numbers and names.

/** The outside's colors: graphite panels, warm-paper frames, night ink and the signal green. */
export const FACADE = {
  /** The walls' outside paint. */
  skin: '#23252f',
  /** Window frames and sills. */
  frame: '#f5f6f2',
  /** The seams between the tower's bars, and the panels the signs are on. */
  ink: '#0a0b12',
  /** The light lines in the seams. */
  accent: '#09ca59',
  /** A storey's slab band when there's no look for it (see storeys). */
  band: '#e8a87c',
  /** Glass you can't see into; at night some of it glows in one of `lit`. */
  glass: '#a9d8f5',
  lit: ['#ffd27a', '#ffe6b0', '#9ec9ff'],
  /** Slabs' undersides, and the roofs of the back offices. */
  concrete: '#d3d6dd',
} as const;

/** The tower's shape: in shared/tower.ts, so the office's server can fly Friday One round it too. */
export { TOWER } from '../../shared/tower';

/** The building's name, and its lockup (the mark and the name, white on transparent) for the signs. */
export const BUILDING = { name: 'FRIDAY LABS', lockup: '/brand/friday-labs-wordmark-white.png' } as const;

/** A real storey as the outside shows it: its floor's name, and its color (its slab band, its sign). */
export interface StoreyLook {
  name: string;
  accent: string;
}

let looks: readonly StoreyLook[] = [];

/** Each real storey's look, from the bottom one up (see floorStoreys in core/floors.ts): set before the building's rebuilt. */
export function setStoreys(list: readonly StoreyLook[]): void {
  looks = list.map(({ name, accent }) => ({ name, accent }));
}

/** Each real storey's look, from the bottom one up. One past the end has none yet: its band is FACADE.band. */
export function storeys(): readonly StoreyLook[] {
  return looks;
}

/** The looks as a string that changes when any of them does, for skipping a rebuild that would draw the same. */
export function storeysKey(): string {
  return JSON.stringify(looks);
}
