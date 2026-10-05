/**
 * Keys by name, for pressing them without a keyboard in VR (keys.ts): each KeyboardEvent.code's key
 * and old keyCode (a US layout, which xterm and the office's own keys read), which code types a
 * character, which key a hint's key chip means (so tapping it presses it), and what a chip says in
 * the headset instead (E is the trigger there). Plain data and lookups, tested in tests/vr-input.test.ts.
 */

/** Punctuation and space on a US keyboard: code -> [key, shifted key, keyCode]. */
const PUNCT: Readonly<Record<string, readonly [string, string, number]>> = {
  Space: [' ', ' ', 32],
  Minus: ['-', '_', 189],
  Equal: ['=', '+', 187],
  BracketLeft: ['[', '{', 219],
  BracketRight: [']', '}', 221],
  Backslash: ['\\', '|', 220],
  Semicolon: [';', ':', 186],
  Quote: ["'", '"', 222],
  Comma: [',', '<', 188],
  Period: ['.', '>', 190],
  Slash: ['/', '?', 191],
  Backquote: ['`', '~', 192],
};

const SHIFTED_DIGITS = ')!@#$%^&*(';

/** Keys that type nothing: code -> [key, keyCode]. */
const NAMED: Readonly<Record<string, readonly [string, number]>> = {
  Enter: ['Enter', 13],
  NumpadEnter: ['Enter', 13],
  Tab: ['Tab', 9],
  Backspace: ['Backspace', 8],
  Escape: ['Escape', 27],
  Delete: ['Delete', 46],
  Insert: ['Insert', 45],
  Home: ['Home', 36],
  End: ['End', 35],
  PageUp: ['PageUp', 33],
  PageDown: ['PageDown', 34],
  ArrowLeft: ['ArrowLeft', 37],
  ArrowUp: ['ArrowUp', 38],
  ArrowRight: ['ArrowRight', 39],
  ArrowDown: ['ArrowDown', 40],
  ShiftLeft: ['Shift', 16],
  ShiftRight: ['Shift', 16],
  ControlLeft: ['Control', 17],
  ControlRight: ['Control', 17],
  AltLeft: ['Alt', 18],
  AltRight: ['Alt', 18],
  MetaLeft: ['Meta', 91],
  MetaRight: ['Meta', 93],
  CapsLock: ['CapsLock', 20],
};

/** The key a code is (shifted or not) and its keyCode; an unknown code is 'Unidentified', keyCode 0. */
export function keyInfo(code: string, shift = false): { key: string; keyCode: number } {
  let m = /^Key([A-Z])$/.exec(code);
  if (m) return { key: shift ? m[1] : m[1].toLowerCase(), keyCode: m[1].charCodeAt(0) };
  m = /^Digit([0-9])$/.exec(code);
  if (m) return { key: shift ? SHIFTED_DIGITS[+m[1]] : m[1], keyCode: 48 + +m[1] };
  m = /^Numpad([0-9])$/.exec(code);
  if (m) return { key: m[1], keyCode: 96 + +m[1] };
  m = /^F([1-9]|1[0-2])$/.exec(code);
  if (m) return { key: code, keyCode: 111 + +m[1] };
  const p = PUNCT[code];
  if (p) return { key: shift ? p[1] : p[0], keyCode: p[2] };
  const n = NAMED[code];
  if (n) return { key: n[0], keyCode: n[1] };
  return { key: 'Unidentified', keyCode: 0 };
}

/** Which key types `ch` (one character), and whether with Shift; null for one no key types. */
export function codeOfChar(ch: string): { code: string; shift: boolean } | null {
  if (ch === '\n' || ch === '\r') return { code: 'Enter', shift: false };
  if (ch === '\t') return { code: 'Tab', shift: false };
  if (/^[a-z]$/.test(ch)) return { code: `Key${ch.toUpperCase()}`, shift: false };
  if (/^[A-Z]$/.test(ch)) return { code: `Key${ch}`, shift: true };
  if (/^[0-9]$/.test(ch)) return { code: `Digit${ch}`, shift: false };
  const d = SHIFTED_DIGITS.indexOf(ch);
  if (ch && d >= 0) return { code: `Digit${d}`, shift: true };
  for (const [code, [plain, shifted]] of Object.entries(PUNCT)) {
    if (ch === plain) return { code, shift: false };
    if (ch === shifted) return { code, shift: true };
  }
  return null;
}

/** Chips that name a key by something other than its letter. */
const CHIP_CODES: Readonly<Record<string, string>> = {
  Space: 'Space',
  Esc: 'Escape',
  Escape: 'Escape',
  Enter: 'Enter',
  Return: 'Enter',
  '↵': 'Enter',
  Tab: 'Tab',
  Shift: 'ShiftLeft',
  '⌫': 'Backspace',
  Backspace: 'Backspace',
  Del: 'Delete',
  Delete: 'Delete',
  '←': 'ArrowLeft',
  '→': 'ArrowRight',
  '↑': 'ArrowUp',
  '↓': 'ArrowDown',
  'E / Click': 'KeyE',
};

/**
 * The key a hint's key chip (core/hint.ts) means, so that tapping it in VR presses it: one letter
 * or digit is that key, a few are named; a chip that's more than one key or isn't one (W A S D,
 * Mouse, Scroll, Click) is null.
 */
export function codeOfChip(text: string): string | null {
  const t = text.trim();
  if (/^[A-Za-z]$/.test(t)) return `Key${t.toUpperCase()}`;
  if (/^[0-9]$/.test(t)) return `Digit${t}`;
  return CHIP_CODES[t] ?? null;
}

/** What a chip says in the headset, where it isn't a key on a keyboard. */
const VR_LABELS: Readonly<Record<string, string>> = {
  E: 'Trigger',
  'E / Click': 'Trigger',
  Click: 'Trigger',
  Space: 'Grip',
  Esc: 'B',
  Mouse: 'Aim',
  'W A S D': 'Stick',
  W: 'Stick ↑',
  S: 'Stick ↓',
  'W S': 'Stick ↑↓',
  'A D': 'Stick ←→',
};

/** What a key chip says in VR instead (E is "Trigger", Space "Grip", Esc "B"), or null when it stays as it is. */
export function vrLabel(chip: string): string | null {
  return VR_LABELS[chip.trim()] ?? null;
}
