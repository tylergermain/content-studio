/**
 * The scoreboard's face, painted on a canvas like an arena's: near-black, with lit LED digits and
 * Friday Labs green. Two pages: the longest shots, and a game of PIG while one is on.
 */
import { SHOTS_SHOWN, inFeet, type LongShot } from '../../../shared/longshots';
import { PIG_WORD, scoreLine, type PigState } from '../../../shared/pig';

export const FACE_W = 1024;
export const FACE_H = 640;

const INK = '#0A0B12';
const GREEN = '#09CA59';
const AMBER = '#FFB627';
const RED = '#FF4D5E';
const WHITE = '#F3F5FA';
const DIM = '#1B2230';
const DIM_GREEN = '#2E7D52';
/** Second-line figures (the feet, the game's news): softer than the lit green, still bright enough to read from the court. */
const SOFT = '#8FDDB0';
const FONT = '"Arial Narrow", "Roboto Condensed", "Helvetica Neue", Arial, sans-serif';

/** What the board shows: the longest shots, with the make that last got on picked out a while; or the floor's game of PIG. */
export type FaceView =
  | { page: 'shots'; shots: readonly LongShot[]; latest: { name: string; rank: number } | null; flash: boolean; blink: boolean }
  | { page: 'pig'; pig: PigState; blink: boolean };

export function paintFace(g: CanvasRenderingContext2D, v: FaceView) {
  g.save();
  g.fillStyle = INK;
  g.fillRect(0, 0, FACE_W, FACE_H);
  // The panel's own edge, lit green (all of it, flashing, for a new record).
  const flash = v.page === 'shots' && v.flash;
  g.strokeStyle = flash ? GREEN : '#18392A';
  g.lineWidth = flash ? 10 : 4;
  g.strokeRect(8, 8, FACE_W - 16, FACE_H - 16);
  if (v.page === 'shots') paintShots(g, v);
  else paintPig(g, v.pig, v.blink);
  leds(g);
  g.restore();
}

// ---- The longest shots ----------------------------------------------------------------------------

function paintShots(g: CanvasRenderingContext2D, v: Extract<FaceView, { page: 'shots' }>) {
  ball(g, 86, 62, 30);
  ball(g, FACE_W - 86, 62, 30);
  text(g, 'LONGEST SHOTS', FACE_W / 2, 84, 70, v.flash && v.blink ? WHITE : GREEN, 'center');
  rule(g, 120);
  if (!v.shots.length) {
    text(g, 'NO MAKES YET', FACE_W / 2, 340, 78, GREEN, 'center');
    text(g, 'SINK ONE AND YOU’RE UP HERE', FACE_W / 2, 420, 34, DIM_GREEN, 'center');
    return;
  }
  // The rows share the room below the title: a short table's are taller (up to three rows' worth), and
  // what's in them bigger (up to BIGGEST), so a board with a make or two on it is still full, and reads
  // from across the court. They sit in the middle of it.
  const top = 132;
  const room = FACE_H - top - 20;
  const shown = v.shots.slice(0, SHOTS_SHOWN);
  const row = room / Math.max(3, shown.length);
  const k = Math.min(BIGGEST, row / (room / SHOTS_SHOWN));
  const first = top + (room - row * shown.length) / 2;
  const h = 54 * k;
  const nameSize = Math.min(80, 56 * k);
  const mSize = 36 * k;
  const feetSize = 38 * k;
  // Right to left: the feet, the M, the meters; the name has what's left after the rank and its dot.
  const feetLeft = FACE_W - 36 - measure(g, '888 FT', feetSize);
  const mLeft = feetLeft - 20 - measure(g, 'M', mSize);
  const distRight = mLeft - 8;
  const rankRight = 52 + digitWidth(h);
  const dotR = 9 * k;
  const nameX = rankRight + 26 + dotR * 2;
  const nameMax = distRight - digitsWidth('88.8', h) - 28 - nameX;
  shown.forEach((s, i) => {
    const y = first + i * row;
    const mid = y + row / 2;
    const newest = v.latest && v.latest.rank === i + 1 && v.latest.name === s.name;
    if (newest && v.blink) {
      g.fillStyle = 'rgba(9, 202, 89, 0.22)';
      g.fillRect(20, y + 4, FACE_W - 40, row - 8);
      g.fillStyle = GREEN;
      g.fillRect(20, y + 4, 8, row - 8);
    }
    digits(g, String(i + 1), rankRight, mid, h, AMBER);
    g.fillStyle = s.color;
    g.beginPath();
    g.arc(rankRight + 18 + dotR, mid, dotR, 0, Math.PI * 2);
    g.fill();
    text(g, fit(g, s.name.toUpperCase(), nameSize, nameMax), nameX, mid + nameSize * 0.36, nameSize, WHITE, 'left');
    // The M and the feet sit on the digits' baseline.
    const base = mid + h / 2;
    digits(g, s.dist.toFixed(1), distRight, mid, h, GREEN);
    text(g, 'M', mLeft, base, mSize, GREEN, 'left');
    text(g, `${inFeet(s.dist)} FT`, FACE_W - 36, base, feetSize, SOFT, 'right');
  });
}

/** How much bigger than a full board's rows a short table's get, at most. */
const BIGGEST = 1.5;

/** How wide `s` is in the board's lettering at `size`. */
function measure(g: CanvasRenderingContext2D, s: string, size: number): number {
  g.save();
  g.font = `700 ${size}px ${FONT}`;
  const w = g.measureText(s).width;
  g.restore();
  return w;
}

// ---- A game of PIG ----------------------------------------------------------------------------------

function paintPig(g: CanvasRenderingContext2D, pig: PigState, blink: boolean) {
  text(g, 'PIG', FACE_W / 2, 86, 90, '#FF8FB1', 'center');
  text(g, fit(g, scoreLine(pig), 38, FACE_W - 120), FACE_W / 2, 136, 38, GREEN, 'center');
  rule(g, 158);
  const over = pig.winner !== null;
  pig.players.forEach((p, i) => {
    const y = 238 + i * 132;
    const up = !over && pig.turn === i;
    if (up && blink) text(g, '▶', 40, y + 24, 60, GREEN, 'left');
    text(g, fit(g, p.name.toUpperCase(), 72, 470), 100, y + 22, 72, over && pig.winner === i ? GREEN : WHITE, 'left');
    const role = over ? (pig.winner === i ? 'WINS' : '') : pig.leader === i ? 'SETS THE SHOT' : up ? 'TO MATCH IT' : '';
    if (role) text(g, role, 102, y + 60, 30, over ? GREEN : DIM_GREEN, 'left');
    for (let k = 0; k < PIG_WORD.length; k++) {
      const lit = k < p.letters;
      const x = FACE_W - 368 + k * 114;
      g.strokeStyle = lit ? RED : DIM;
      g.lineWidth = 5;
      g.strokeRect(x, y - 50, 98, 98);
      text(g, PIG_WORD[k], x + 49, y + 24, 78, lit ? RED : DIM, 'center');
    }
  });
  const at = pig.players[pig.turn];
  let line: string;
  let color = GREEN;
  if (over) {
    // Flashing green and white, like an arena's board at the buzzer.
    line = `${pig.players[pig.winner!].name.toUpperCase()} WINS!`;
    color = blink ? GREEN : WHITE;
  } else if (pig.inAir) line = 'SHOT’S UP…';
  else if (pig.spot && pig.turn !== pig.leader) line = `${at.name.toUpperCase()}: MATCH FROM HERE · ${pig.spot.dist.toFixed(1)} M`;
  else {
    line = `${at.name.toUpperCase()}: SHOOT FROM ANYWHERE`;
    color = AMBER;
  }
  text(g, fit(g, line, 52, FACE_W - 70), FACE_W / 2, 514, 52, color, 'center');
  // What just happened, big enough to read from the court.
  text(g, fit(g, pig.news.toUpperCase(), 42, FACE_W - 70), FACE_W / 2, 590, 42, SOFT, 'center');
}

// ---- The pieces --------------------------------------------------------------------------------------

/** Lit text: the color, with a glow round it. */
function text(g: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign) {
  g.save();
  g.font = `700 ${size}px ${FONT}`;
  g.textAlign = align;
  g.fillStyle = color;
  g.shadowColor = color;
  g.shadowBlur = color === DIM ? 0 : size * 0.35;
  g.fillText(s, x, y);
  g.restore();
}

/** `s` cut short (with an ellipsis) to fit `max` pixels at `size`. */
function fit(g: CanvasRenderingContext2D, s: string, size: number, max: number): string {
  g.save();
  g.font = `700 ${size}px ${FONT}`;
  let out = s;
  while (out.length > 1 && g.measureText(out).width > max) out = out.slice(0, -1);
  g.restore();
  return out === s ? s : `${out.slice(0, -1)}…`;
}

function rule(g: CanvasRenderingContext2D, y: number) {
  g.fillStyle = GREEN;
  g.globalAlpha = 0.7;
  g.fillRect(40, y, FACE_W - 80, 3);
  g.globalAlpha = 1;
}

/** A little basketball: orange, with its seams. */
function ball(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  g.save();
  g.fillStyle = '#F07A2A';
  g.shadowColor = '#F07A2A';
  g.shadowBlur = 14;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
  g.shadowBlur = 0;
  g.strokeStyle = '#2A1408';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(x - r, y);
  g.lineTo(x + r, y);
  g.moveTo(x, y - r);
  g.lineTo(x, y + r);
  g.stroke();
  // The two curved seams, either side.
  g.beginPath();
  g.arc(x - r * 1.25, y, r * 0.85, -0.95, 0.95);
  g.stroke();
  g.beginPath();
  g.arc(x + r * 1.25, y, r * 0.85, Math.PI - 0.95, Math.PI + 0.95);
  g.stroke();
  g.restore();
}

/** Which of a seven-segment digit's segments light up for each character. */
const SEGMENTS: Record<string, string> = { '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg', '-': 'g' };

/** How wide one seven-segment digit `h` tall is (see digits). */
const digitWidth = (h: number) => h * 0.52;

/** How wide `s` is in seven-segment digits `h` tall (see digits). */
function digitsWidth(s: string, h: number): number {
  let w = 0;
  for (const ch of s) w += ch === '.' ? h * 0.12 * 1.6 + h * 0.16 * 0.6 : digitWidth(h) + h * 0.16;
  return w;
}

/**
 * A number in seven-segment digits, lit `color`, its right edge at `right` and its middle at `mid`,
 * `h` tall: the unlit segments show faintly, as on a real board. A '.' is a dot after the digit before.
 */
function digits(g: CanvasRenderingContext2D, s: string, right: number, mid: number, h: number, color: string) {
  const w = digitWidth(h);
  const gap = h * 0.16;
  const t = h * 0.12;
  let x = right;
  g.save();
  // Leaning a little, like the real thing.
  g.translate(0, mid);
  g.transform(1, 0, -0.08, 1, 0, 0);
  for (const ch of [...s].reverse()) {
    if (ch === '.') {
      x -= t * 1.6;
      lit(g, color, true, () => g.fillRect(x, h / 2 - t, t, t));
      x -= gap * 0.6;
      continue;
    }
    x -= w;
    const on = SEGMENTS[ch] ?? '';
    for (const seg of 'abcdefg') segment(g, seg, x, -h / 2, w, h, t, on.includes(seg) ? color : DIM);
    x -= gap;
  }
  g.restore();
}

function segment(g: CanvasRenderingContext2D, seg: string, x: number, y: number, w: number, h: number, t: number, color: string) {
  const half = h / 2;
  // Each segment's two ends: across (a, g, d) or down (b, c, e, f).
  const ends: Record<string, [number, number, number, number]> = {
    a: [x, y, x + w, y],
    g: [x, y + half, x + w, y + half],
    d: [x, y + h, x + w, y + h],
    f: [x, y, x, y + half],
    b: [x + w, y, x + w, y + half],
    e: [x, y + half, x, y + h],
    c: [x + w, y + half, x + w, y + h],
  };
  const [x0, y0, x1, y1] = ends[seg];
  const across = y0 === y1;
  const k = t / 2;
  const pad = t * 0.15;
  lit(g, color, color !== DIM, () => {
    g.beginPath();
    if (across) {
      g.moveTo(x0 + pad, y0);
      g.lineTo(x0 + pad + k, y0 - k);
      g.lineTo(x1 - pad - k, y0 - k);
      g.lineTo(x1 - pad, y0);
      g.lineTo(x1 - pad - k, y0 + k);
      g.lineTo(x0 + pad + k, y0 + k);
    } else {
      g.moveTo(x0, y0 + pad);
      g.lineTo(x0 + k, y0 + pad + k);
      g.lineTo(x0 + k, y1 - pad - k);
      g.lineTo(x0, y1 - pad);
      g.lineTo(x0 - k, y1 - pad - k);
      g.lineTo(x0 - k, y0 + pad + k);
    }
    g.closePath();
    g.fill();
  });
}

/** Draws with `color`, glowing when it's lit. */
function lit(g: CanvasRenderingContext2D, color: string, glow: boolean, draw: () => void) {
  g.save();
  g.fillStyle = color;
  if (glow) {
    g.shadowColor = color;
    g.shadowBlur = 16;
  }
  draw();
  g.restore();
}

/** The LEDs' grid over the whole face: thin dark lines between the dots. */
function leds(g: CanvasRenderingContext2D) {
  g.fillStyle = 'rgba(0, 0, 0, 0.32)';
  for (let x = 0; x < FACE_W; x += 4) g.fillRect(x, 0, 1, FACE_H);
  for (let y = 0; y < FACE_H; y += 4) g.fillRect(0, y, FACE_W, 1);
}
