/**
 * The VR keyboard's keys and where they are: QWERTY with Shift, a ?123 layer of digits and symbols
 * (and its own Shift for the rest), a terminal row (Esc, Tab, Ctrl and the arrows) when the focus is
 * in a terminal, Enter, ⌫, Space, 🎤 and a key that puts the keyboard away. Pure: keyboard.ts draws
 * it and asks keyAt which key a point is on; tests/vr-panels.test.ts checks the map.
 */

export type KeyAct = 'char' | 'shift' | 'layer' | 'back' | 'enter' | 'space' | 'mic' | 'hide' | 'ctrl' | 'key';

export interface KeyDef {
  readonly id: string;
  readonly label: string;
  readonly act: KeyAct;
  /** What a 'char' key types. */
  readonly text?: string;
  /** The KeyboardEvent.code a 'key' key presses. */
  readonly code?: string;
  /** Width in key units (a row is ROW_UNITS wide). */
  readonly w: number;
}

export interface PlacedKey {
  readonly key: KeyDef;
  /** Its box on the board, 0..1 across and 0..1 down from the top. */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface Board {
  readonly keys: readonly PlacedKey[];
  /** Height over width. */
  readonly aspect: number;
}

export type Layer = 'letters' | 'symbols';

export const ROW_UNITS = 10;
/** The board's margin and the gap between keys, in key units. */
const PAD = 0.18;
const GAP = 0.12;

const chars = (s: string): KeyDef[] => [...s].map((c) => ({ id: `c:${c}`, label: c, act: 'char', text: c, w: 1 }));
const key = (id: string, label: string, act: KeyAct, w: number, more: Partial<KeyDef> = {}): KeyDef => ({ id, label, act, w, ...more });

const TERMINAL: KeyDef[] = [
  key('Escape', 'Esc', 'key', 1.5, { code: 'Escape' }),
  key('Tab', 'Tab', 'key', 1.5, { code: 'Tab' }),
  key('ctrl', 'Ctrl', 'ctrl', 1.5),
  key('ArrowLeft', '←', 'key', 1.375, { code: 'ArrowLeft' }),
  key('ArrowUp', '↑', 'key', 1.375, { code: 'ArrowUp' }),
  key('ArrowDown', '↓', 'key', 1.375, { code: 'ArrowDown' }),
  key('ArrowRight', '→', 'key', 1.375, { code: 'ArrowRight' }),
];

/** The rows for a layer, upper case or not, with the terminal row on top when `terminal`. */
export function keyRows(layer: Layer, shift: boolean, terminal: boolean): KeyDef[][] {
  const up = (s: string) => (shift ? s.toUpperCase() : s);
  const rows: KeyDef[][] = [];
  if (terminal) rows.push(TERMINAL);
  if (layer === 'letters') {
    rows.push(chars(up('qwertyuiop')), chars(up('asdfghjkl')), [key('shift', '⇧', 'shift', 1.5), ...chars(up('zxcvbnm')), key('back', '⌫', 'back', 1.5)]);
  } else if (!shift) {
    rows.push(chars('1234567890'), chars('-/:;()$&@"'), [key('shift', '#+=', 'shift', 1.5), ...chars(".,?!'_"), key('back', '⌫', 'back', 2.5)]);
  } else {
    rows.push(chars('[]{}#%^*+='), chars('\\|~<>`€£¥•'), [key('shift', '123', 'shift', 1.5), ...chars(".,?!'_"), key('back', '⌫', 'back', 2.5)]);
  }
  rows.push([
    key('layer', layer === 'letters' ? '?123' : 'ABC', 'layer', 1.25),
    key('mic', '🎤', 'mic', 1),
    ...chars(','),
    key('space', 'space', 'space', 3.5),
    ...chars('.'),
    key('enter', '↵', 'enter', 1.25),
    key('hide', '⌄', 'hide', 1),
  ]);
  return rows;
}

/** Lays rows out on a board: each row centered, keys a unit square less the gaps. */
export function placeKeys(rows: readonly (readonly KeyDef[])[]): Board {
  const width = ROW_UNITS + PAD * 2;
  const height = rows.length + PAD * 2;
  const keys: PlacedKey[] = [];
  rows.forEach((row, r) => {
    const units = row.reduce((n, k) => n + k.w, 0);
    let x = PAD + (ROW_UNITS - units) / 2;
    for (const k of row) {
      keys.push({ key: k, x: (x + GAP / 2) / width, y: (PAD + r + GAP / 2) / height, w: (k.w - GAP) / width, h: (1 - GAP) / height });
      x += k.w;
    }
  });
  return { keys, aspect: height / width };
}

/** The key under uv (0,0 bottom-left), or null in a gap or off the board. */
export function keyAt(board: Board, u: number, v: number): PlacedKey | null {
  const y = 1 - v;
  for (const k of board.keys) if (u >= k.x && u <= k.x + k.w && y >= k.y && y <= k.y + k.h) return k;
  return null;
}

/** The board for a state: the layer, Shift, and whether the focus is in a terminal. */
export function boardFor(layer: Layer, shift: boolean, terminal: boolean): Board {
  return placeKeys(keyRows(layer, shift, terminal));
}

/** Keys that repeat while held (⌫ and the arrows), after this long and then this often (ms). */
export const REPEAT = { after: 450, every: 70 } as const;
export function repeats(k: KeyDef): boolean {
  return k.act === 'back' || (k.act === 'key' && !!k.code?.startsWith('Arrow'));
}
