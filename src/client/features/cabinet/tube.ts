import { scoreLine, type HighScore } from '../../../shared/cabinet';
import { FONT, H as GAME_H, W as GAME_W, rank, table, type ScreenGame } from '../arcade/game';
import { COLORS, H, W } from './blocks';

/**
 * What the cabinet's tube shows (ui.ts): 4:3, in the 800×600 units BLOCKFALL was drawn for
 * (blocks.ts). With nobody on it, the games it plays and each one's top score (which is the picker
 * too, once you're up at it); with a game on, that game. BLOCKFALL has a picture of its own for the
 * tube; a game made for the monitor's 16:9 goes across the middle of it, under its name and who's
 * playing and over the top of its high-score table.
 */
export { H, W };

const SCALE = W / GAME_W;
const TOP = (H - GAME_H * SCALE) / 2;
const INK = '#0b1320';
const TEXT = '#f1ede4';
const DIM = '#8d99ae';
const GOLD = '#ffd166';
const NEON = '#ff5ecb';
/** The picker's rows: where the first one starts, how tall each is, and its sides. */
const ROWS_Y = 118;
const ROW_H = 98;
const ROW_X = 50;
const ROW_W = W - 2 * ROW_X;

/** A point on the tube, in the units of a game that's framed on it (see paintGame). */
export function toGame(x: number, y: number): [number, number] {
  return [x / SCALE, (y - TOP) / SCALE];
}

/** Which of `n` rows of the picker a point on the tube is on, or -1. */
export function rowAt(x: number, y: number, n: number): number {
  const i = Math.floor((y - ROWS_Y) / ROW_H);
  return x >= ROW_X && x <= ROW_X + ROW_W && i >= 0 && i < n ? i : -1;
}

/** `game` on the tube, with `player` on it. */
export function paintGame(g: CanvasRenderingContext2D, game: ScreenGame, player?: string) {
  if (game.paintTube) return game.paintTube(g, player);
  backdrop(g);
  g.textBaseline = 'middle';
  // Over it: the game's name in lights, and who's on it.
  neon(g, game.name.toUpperCase(), 24, TOP / 2 + 2, 40, 'left');
  if (player) {
    g.textAlign = 'right';
    g.fillStyle = GOLD;
    g.font = `900 20px ${FONT}`;
    g.fillText(`▶ ${fit(g, player.toUpperCase(), 280)}`, W - 24, TOP / 2 + 2);
  }
  g.save();
  g.translate(0, TOP);
  g.scale(SCALE, SCALE);
  g.beginPath();
  g.rect(0, 0, GAME_W, GAME_H);
  g.clip();
  game.paint(g);
  g.restore();
  g.textBaseline = 'middle';
  // Under it: the top three of its table, the game that's on picked out.
  const top = table(game.id).slice(0, 3);
  const y = H - TOP / 2;
  if (!top.length) {
    g.textAlign = 'center';
    g.fillStyle = DIM;
    g.font = `800 20px ${FONT}`;
    g.fillText('🏆 NO HIGH SCORE YET. BE THE FIRST!', W / 2, y);
  }
  const place = rank(game.id, game.office);
  top.forEach((s, i) => entry(g, game, s, i + 1, 18 + i * 260, 244, y, s.game === game.office));
  if (place > 3) {
    g.textAlign = 'right';
    g.fillStyle = GOLD;
    g.font = `900 14px ${FONT}`;
    g.fillText(`THIS GAME: #${place}`, W - 18, H - 12);
  }
  scanLines(g);
}

/** Someone's on it and their game hasn't come through yet. */
export function paintCard(g: CanvasRenderingContext2D, game: ScreenGame, player: string) {
  backdrop(g);
  g.textBaseline = 'middle';
  neon(g, game.name.toUpperCase(), W / 2, 230, 64, 'center');
  g.textAlign = 'center';
  g.fillStyle = GOLD;
  g.font = `900 34px ${FONT}`;
  g.fillText(`▶ ${fit(g, player.toUpperCase(), 600)}`, W / 2, 330);
  scanLines(g);
}

/**
 * The games on the cabinet, each with the top of its table and the game of yours that's waiting
 * there, and `prompt` under them. `sel` is the row the picker's on; -1 with nobody up at it.
 */
export function paintPicker(g: CanvasRenderingContext2D, games: readonly ScreenGame[], sel: number, prompt: string) {
  backdrop(g);
  g.textBaseline = 'middle';
  neon(g, 'ARCADE', W / 2, 62, 70, 'center');
  games.forEach((game, i) => {
    const y = ROWS_Y + i * ROW_H;
    const cy = y + ROW_H / 2 - 4;
    const on = i === sel;
    g.fillStyle = on ? 'rgba(255, 94, 203, 0.16)' : 'rgba(255, 255, 255, 0.05)';
    g.beginPath();
    g.roundRect(ROW_X, y, ROW_W, ROW_H - 10, 16);
    g.fill();
    if (on) {
      g.strokeStyle = NEON;
      g.lineWidth = 3;
      g.shadowColor = NEON;
      g.shadowBlur = 14;
      g.stroke();
      g.shadowBlur = 0;
    }
    g.textAlign = 'center';
    g.fillStyle = TEXT;
    g.font = `44px ${FONT}`;
    g.fillText(game.icon, ROW_X + 52, cy + 2);
    g.textAlign = 'left';
    g.font = `900 30px ${FONT}`;
    g.fillText(game.name.toUpperCase(), ROW_X + 104, cy - 17);
    const top = table(game.id)[0];
    if (top) entry(g, game, top, 0, ROW_X + 104, 300, cy + 19, false);
    else {
      g.fillStyle = DIM;
      g.font = `800 18px ${FONT}`;
      g.fillText('No high score yet', ROW_X + 104, cy + 19);
    }
    // On the right: your game of it that's waiting, or which key picks it.
    g.textAlign = 'right';
    const left = game.left;
    g.fillStyle = left === null ? DIM : '#4cc9f0';
    g.font = `900 ${left === null ? 20 : 17}px ${FONT}`;
    g.fillText(left === null ? String(i + 1) : `⏸ YOURS · ${scoreLine(game.id, left).toUpperCase()}`, ROW_X + ROW_W - 22, left === null ? cy : cy - 17);
    if (left !== null) {
      g.fillStyle = DIM;
      g.font = `800 15px ${FONT}`;
      g.fillText('picks up where you left it', ROW_X + ROW_W - 22, cy + 19);
    }
  });
  g.textAlign = 'center';
  g.fillStyle = GOLD;
  g.font = `900 ${sel < 0 ? 30 : 22}px ${FONT}`;
  g.fillText(prompt, W / 2, 558);
  scanLines(g);
}

/** One line of a table: its place (a cup for 0), the name in its player's color, the score. `width` wide from `x`. */
function entry(g: CanvasRenderingContext2D, game: ScreenGame, s: HighScore, place: number, x: number, width: number, y: number, mine: boolean) {
  if (mine) {
    g.fillStyle = 'rgba(255, 209, 102, 0.22)';
    g.beginPath();
    g.roundRect(x - 8, y - 15, width + 8, 30, 8);
    g.fill();
  }
  g.font = `900 18px ${FONT}`;
  const score = scoreLine(game.id, s.score);
  g.textAlign = 'left';
  g.fillStyle = place <= 1 ? GOLD : DIM;
  g.fillText(place ? String(place) : '🏆', x, y);
  const lead = place ? 22 : 30;
  g.fillStyle = TEXT;
  g.textAlign = 'right';
  g.fillText(score, x + width - 8, y);
  g.textAlign = 'left';
  g.fillStyle = s.color;
  g.fillText(fit(g, s.name, width - lead - 20 - g.measureText(score).width), x + lead, y);
}

/** Words with each letter in a piece's color, glowing, like the cabinet's marquee. */
function neon(g: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, align: 'left' | 'center') {
  g.font = `900 ${size}px ${FONT}`;
  g.textAlign = 'center';
  const letters = [...text];
  const widths = letters.map((ch) => g.measureText(ch).width);
  let at = align === 'left' ? x : x - widths.reduce((a, b) => a + b, 0) / 2;
  letters.forEach((ch, i) => {
    g.fillStyle = COLORS[(i % 7) + 1];
    g.shadowColor = g.fillStyle;
    g.shadowBlur = size / 4;
    g.fillText(ch, at + widths[i] / 2, y);
    at += widths[i];
  });
  g.shadowBlur = 0;
}

function backdrop(g: CanvasRenderingContext2D) {
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#1b1d3a');
  bg.addColorStop(1, INK);
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
}

/** Scan lines, like the tube it would have had. */
function scanLines(g: CanvasRenderingContext2D) {
  g.fillStyle = 'rgba(0, 0, 0, 0.12)';
  for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 1.5);
}

/** `text`, cut short with … to fit in `width` in the current font. */
function fit(g: CanvasRenderingContext2D, text: string, width: number): string {
  if (g.measureText(text).width <= width) return text;
  let s = text;
  while (s.length > 1 && g.measureText(`${s}…`).width > width) s = s.slice(0, -1);
  return `${s}…`;
}
