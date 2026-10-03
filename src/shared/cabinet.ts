// The arcade: the games the cabinet in the lounge and the boss's monitor both play, what a game's
// screen shows while someone plays (shared by the browser that plays, which sends it, the office,
// which follows it and passes the cabinet's on to everyone else on the floor, and the browsers that
// watch), and the high-score tables, one per game, which are the whole building's (see server/cabinet.ts).

/** The well Blockfall's blocks fall into: 10 wide, 20 deep (see client/features/cabinet/blocks.ts). */
export const WELL_COLS = 10;
export const WELL_ROWS = 20;
/** How many games each high-score table keeps. */
export const SCORES_KEPT = 10;
const SCORE_MAX = 99_999_999;
/** Points for clearing 1–4 lines at once, times the level they're cleared on. */
export const CLEAR_POINTS = [0, 100, 300, 500, 800];
/** Snake's grass is 32 × 18 cells and it starts 3 long; Minesweeper's field is 16 × 9; 2048's biggest tile on 16 cells. */
export const SNAKE_CELLS = 32 * 18;
export const SNAKE_START = 3;
export const MINE_CELLS = 16 * 9;
const TILE_MAX = 131_072;

/** The level a game is on with `lines` cleared: up one every ten, to 99. */
export function levelFor(lines: number): number {
  return Math.min(99, 1 + Math.floor(lines / 10));
}

/**
 * The games the arcade plays (client/features/arcade), by what each one's table goes by. The first is
 * the cabinet's own: a score that doesn't say which game it's at is Blockfall's, as every score saved
 * before there were others is.
 */
export const GAME_TITLES = ['blockfall', '2048', 'snake', 'minesweeper'] as const;
export type GameTitle = (typeof GAME_TITLES)[number];

/** What each game's score is, and which way round its table goes (`lowest`: the least is best). */
export const TITLES: Record<GameTitle, { name: string; scored: string; lowest?: true }> = {
  blockfall: { name: 'Blockfall', scored: 'points, for lines cleared and rows dropped: most first' },
  '2048': { name: '2048', scored: 'points, what every tile made of two was worth: most first' },
  snake: { name: 'Snake', scored: 'how long the snake got: longest first' },
  minesweeper: { name: 'Minesweeper', scored: 'seconds to clear the field, by the office’s clock: fewest first', lowest: true },
};

export type PlayState = 'play' | 'paused' | 'over';

/** One picture of Blockfall's screen while someone plays. */
export interface CabinetFrame {
  /** The well row by row from the top, a character per cell: '0' empty, '1'–'7' a block's color, '8' where the falling piece will land. */
  cells: string;
  /** The piece that comes next (1–7), and the one put on hold (0 for none). */
  next: number;
  hold: number;
  score: number;
  lines: number;
  level: number;
  /** Pieces landed this game: one more is a thud, for anyone watching. */
  pieces: number;
  state: PlayState;
}

/** Snake's: where it is, head first, in cells counted along the rows; its apple; the way it's going (0 right, 1 down, 2 left, 3 up); and the steps it has taken. */
export interface SnakeFrame {
  body: number[];
  apple: number;
  dir: number;
  steps: number;
  state: 'ready' | PlayState;
}

/** 2048's: its 16 cells row by row (0 for none), and the moves that made them. */
export interface TilesFrame {
  tiles: number[];
  score: number;
  moves: number;
  state: 'play' | 'over';
}

/**
 * Minesweeper's: a character per cell. 'h' shut, 'f' flagged, '0'–'8' dug (the mines around it), and
 * once it's lost 'm' a mine, 'b' the one that went off and 'x' a flag that was wrong.
 */
export interface MinesFrame {
  cells: string;
  /** Its clock. */
  seconds: number;
  state: 'ready' | 'playing' | 'won' | 'lost';
}

export interface Frames {
  blockfall: CabinetFrame;
  '2048': TilesFrame;
  snake: SnakeFrame;
  minesweeper: MinesFrame;
}
/** One picture of a game's screen, whichever game it is (who's playing says which: see CabinetState). */
export type GameFrame = Frames[GameTitle];

/** A game on a high-score table. */
export interface HighScore {
  /** Which game: the office names each one as it starts (see Arcade in server/cabinet.ts), and its score only ever gets better. */
  game: string;
  /** Which table it's on; Blockfall's when it doesn't say. */
  title?: GameTitle;
  name: string;
  color: string;
  score: number;
  /** Blockfall's lines and level (0 and 1 for the others). */
  lines: number;
  level: number;
  at: number;
}

/** Who's at the cabinet on your floor (which game, and the office's name for it), and the building's high scores: every game's table, one after another, best first. */
export interface CabinetState {
  player: { id: string; name: string; game: string; title: GameTitle } | null;
  scores: HighScore[];
}

/** The cabinet for someone walking onto the floor: its screen too, when a game's on. */
export interface CabinetView extends CabinetState {
  frame: GameFrame | null;
}

/** 12,400 */
export function scoreText(n: number): string {
  return n.toLocaleString('en-US');
}

/** A score as its table says it: 12,400 for points, "24 long" for a snake, "42s" for a cleared field. */
export function scoreLine(title: GameTitle, n: number): string {
  return title === 'minesweeper' ? `${n}s` : title === 'snake' ? `${n} long` : scoreText(n);
}

export const titleOf = (s: { title?: GameTitle }): GameTitle => s.title ?? 'blockfall';

/** Whether score `a` beats `b` at `title`. */
export const beats = (title: GameTitle, a: number, b: number): boolean => (TITLES[title].lowest ? a < b : a > b);

/** A table's order: best first; of two the same, the one that got there first. */
export const byBest =
  (title: GameTitle) =>
  (a: HighScore, b: HighScore): number =>
    (TITLES[title].lowest ? a.score - b.score : b.score - a.score) || a.at - b.at;

/** One game's table out of the building's scores, in the order they came (best first). */
export function tableOf(scores: readonly HighScore[], title: GameTitle): HighScore[] {
  return scores.filter((s) => titleOf(s) === title);
}

/** Every game's table out of any list of scores: each best first and SCORES_KEPT long, in GAME_TITLES order. */
export function tables(scores: readonly HighScore[]): HighScore[] {
  return GAME_TITLES.flatMap((t) => tableOf(scores, t).sort(byBest(t)).slice(0, SCORES_KEPT));
}

/** Whether the game on a frame has finished. */
export function ended(f: GameFrame): boolean {
  return f.state === 'over' || f.state === 'won' || f.state === 'lost';
}

/** What a frame's game stands at, the way its table counts it (a Minesweeper's clock, which only counts once it's won). */
export function scoreOf(f: GameFrame): number {
  if ('body' in f) return f.body.length;
  return 'seconds' in f ? f.seconds : f.score;
}

const CELLS_RE = new RegExp(`^[0-8]{${WELL_COLS * WELL_ROWS}}$`);
const MINES_RE = new RegExp(`^[h0-8fmbx]{${MINE_CELLS}}$`);
const GAME_RE = /^[a-z0-9]{8,32}$/;

const int = (v: unknown, min: number, max: number): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null);
const among = <T extends string>(v: unknown, ...all: T[]): T | null => all.find((s) => s === v) ?? null;
/** `n` numbers, each one `ok`. */
const list = (v: unknown, min: number, max: number, ok: (n: unknown) => boolean): number[] | null => (Array.isArray(v) && v.length >= min && v.length <= max && v.every(ok) ? (v as number[]) : null);

const CHECKS: { [T in GameTitle]: (f: Record<string, unknown>) => Frames[T] | null } = {
  blockfall(f) {
    const cells = typeof f.cells === 'string' && CELLS_RE.test(f.cells) ? f.cells : null;
    const next = int(f.next, 1, 7);
    const hold = int(f.hold, 0, 7);
    const score = int(f.score, 0, SCORE_MAX);
    const lines = int(f.lines, 0, SCORE_MAX);
    const level = int(f.level, 1, 99);
    const pieces = int(f.pieces, 0, SCORE_MAX);
    const state = among(f.state, 'play', 'paused', 'over');
    if (cells === null || next === null || hold === null || score === null || lines === null || level === null || pieces === null || !state) return null;
    return { cells, next, hold, score, lines, level, pieces, state };
  },
  snake(f) {
    const body = list(f.body, SNAKE_START, SNAKE_CELLS, (c) => int(c, 0, SNAKE_CELLS - 1) !== null);
    const apple = int(f.apple, 0, SNAKE_CELLS - 1);
    const dir = int(f.dir, 0, 3);
    const steps = int(f.steps, 0, SCORE_MAX);
    const state = among(f.state, 'ready', 'play', 'paused', 'over');
    if (!body || apple === null || dir === null || steps === null || !state) return null;
    return { body, apple, dir, steps, state };
  },
  '2048'(f) {
    // Every tile is a power of two.
    const tiles = list(f.tiles, 16, 16, (n) => n === 0 || (int(n, 2, TILE_MAX) !== null && ((n as number) & ((n as number) - 1)) === 0));
    const score = int(f.score, 0, SCORE_MAX);
    const moves = int(f.moves, 0, SCORE_MAX);
    const state = among(f.state, 'play', 'over');
    if (!tiles || score === null || moves === null || !state) return null;
    return { tiles, score, moves, state };
  },
  minesweeper(f) {
    const cells = typeof f.cells === 'string' && MINES_RE.test(f.cells) ? f.cells : null;
    const seconds = int(f.seconds, 0, SCORE_MAX);
    const state = among(f.state, 'ready', 'playing', 'won', 'lost');
    if (cells === null || seconds === null || !state) return null;
    return { cells, seconds, state };
  },
};

/** A frame a browser sent for a game of `title` (Blockfall when it doesn't say), if it is one. */
export function checkFrame<T extends GameTitle = 'blockfall'>(raw: unknown, title?: T): Frames[T] | null {
  if (!raw || typeof raw !== 'object') return null;
  return CHECKS[title ?? 'blockfall'](raw as Record<string, unknown>) as Frames[T] | null;
}

/** A game the office knows, from what a browser called it: Blockfall when it said nothing, none when it's not one. */
export function checkTitle(raw: unknown): GameTitle | null {
  return raw === undefined ? 'blockfall' : among(raw, ...GAME_TITLES);
}

/** A score read back from disk, if it is one, at a game the office knows. */
export function checkScore(raw: { game?: unknown; title?: unknown; score?: unknown; lines?: unknown; level?: unknown }): Pick<HighScore, 'game' | 'title' | 'score' | 'lines' | 'level'> | null {
  const game = typeof raw.game === 'string' && GAME_RE.test(raw.game) ? raw.game : null;
  const title = checkTitle(raw.title);
  const score = int(raw.score, 0, SCORE_MAX);
  const lines = int(raw.lines, 0, SCORE_MAX);
  const level = int(raw.level, 1, 99);
  if (game === null || title === null || score === null || lines === null || level === null) return null;
  return { game, ...(raw.title === undefined ? {} : { title }), score, lines, level };
}
