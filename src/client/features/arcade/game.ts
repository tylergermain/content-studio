import { beats, tableOf, type GameFrame, type GameTitle, type HighScore } from '../../../shared/cabinet';

/**
 * What a game of the arcade's is (games.ts lists them). It's hosted in two places, the boss's monitor
 * (ui.ts) and the cabinet in the lounge (features/cabinet), which play the same set: it draws its
 * whole screen in fixed 960×540 units, so the same picture goes on the board you play on and on the
 * screen in the office, and it takes the keys and the mouse while its window is open.
 */
export const W = 960;
export const H = 540;

export const FONT = "Nunito, ui-rounded, 'SF Pro Rounded', system-ui, sans-serif";

/** What the mouse did on the board. */
export type Press = 'down' | 'move' | 'up' | 'leave';

/** What a game makes a noise about, where there's a speaker (the cabinet's): something landing or eaten, lines clearing (how many), the game ending. */
export type GameSound = (kind: 'land' | 'clear' | 'over', lines?: number) => void;

export interface ScreenGame {
  /** What the menus know it by, what's remembered as the game you played last, and whose high-score table it's on. */
  readonly id: GameTitle;
  readonly icon: string;
  readonly name: string;
  /** How it's played, in the bar under the board. */
  readonly tip: string;
  /** The office's name for the game that's on (see link.ts): '' until it has one, and again as soon as a new game starts. */
  office: string;
  /** Set by a host with a speaker, for as long as it has the game. */
  sound?: GameSound;
  /** The game you left here: what it stands at (see scoreLine in shared/cabinet.ts), or null with none to come back to. */
  readonly left: number | null;
  /** Its window is opening: a new game when the last one was over, else the one that was left. */
  start(): void;
  /** A new game, whatever the last one was up to. */
  reset(): void;
  /** Its window closed, or the page lost the keyboard: lets go of whatever was held, and waits. */
  leave?(): void;
  /** Draws the whole screen. The transform is already set, so only relative transforms from here. */
  paint(g: CanvasRenderingContext2D): void;
  /** The same for the cabinet's 4:3 tube, 800×600, for a game with a picture of its own for it (`player` is who's on it); the cabinet frames any other game's `paint`. */
  paintTube?(g: CanvasRenderingContext2D, player?: string): void;
  /** Moves the game on by `dt` seconds while its window is open. True when the picture changed. */
  update?(dt: number): boolean;
  /** A key went down or came back up, by its `code`. True when it's the game's: never Escape (the window's), V or M (the call's, see features/boss-desk). */
  key?(code: string, down: boolean): boolean;
  /** The mouse on the board, in the screen's units. `flag` is a right-click, or a Ctrl- or Shift-click for a trackpad. True when the picture changed. */
  pointer?(kind: Press, x: number, y: number, e: { button: number; flag: boolean }): boolean;
  /** Its screen as it is now, for the office to follow (that's how its score gets on the table) and to pass on to whoever's watching. */
  frame(): GameFrame;
  /** Puts a frame of someone else's game on its screen: for a copy kept to watch on, never played. */
  show(frame: GameFrame): void;
}

// ---- The high scores ------------------------------------------------------------------------------

/** The building's high scores as the office last sent them (index.ts keeps them here); null until it has. */
let scores: readonly HighScore[] | null = null;

export function setScores(list: readonly HighScore[] | null): void {
  scores = list;
}

/** Game `id`'s table, best first: the building's, the same one wherever the game is played. Empty until it has arrived. */
export function table(id: GameTitle): HighScore[] {
  return scores ? tableOf(scores, id) : [];
}

/** Your own best at each game, kept in this browser: what `best` falls back on until the table has arrived. */
const BEST_KEY = 'agent-office.arcade';

function bests(): Record<string, unknown> {
  try {
    const kept: unknown = JSON.parse(localStorage.getItem(BEST_KEY) ?? '{}');
    return kept && typeof kept === 'object' ? (kept as Record<string, unknown>) : {};
  } catch {
    // nowhere to keep it (a private window): nothing kept
    return {};
  }
}

function kept(id: GameTitle): number {
  const n = bests()[id];
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0;
}

/** The score to beat at game `id`: the top of the building's table, or your own best here until that has arrived. 0 for none. */
export function best(id: GameTitle): number {
  return scores ? (table(id)[0]?.score ?? 0) : kept(id);
}

/** Whose it is, " · ADA", or nothing when it's nobody's (or the table hasn't arrived). */
export function holder(id: GameTitle): string {
  const top = table(id)[0];
  return top ? ` · ${top.name.toUpperCase()}` : '';
}

/** A finished game's score is your best here, if it beats what's kept. */
export function setBest(id: GameTitle, n: number): void {
  const was = kept(id);
  if (n <= 0 || (was && !beats(id, n, was))) return;
  try {
    localStorage.setItem(BEST_KEY, JSON.stringify({ ...bests(), [id]: n }));
  } catch {
    // private window: it's only for this visit then
  }
}

/** Where game `id` (the office's name for it) stands on its table, 1 for the top; 0 when it's not on it. */
export function rank(id: GameTitle, game: string): number {
  return game ? table(id).findIndex((s) => s.game === game) + 1 : 0;
}

/** "#2 on the table · ", for a finished game that made it; nothing for one that didn't. */
export function placed(id: GameTitle, game: string): string {
  const place = rank(id, game);
  return place ? `🏆 #${place} on the table · ` : '';
}

/** Words on a rounded plate across the screen, in the middle unless `cy` says where: how a game says it's over, or waiting. */
export function banner(g: CanvasRenderingContext2D, title: string, sub: string, color: string, cy = H / 2) {
  g.fillStyle = color;
  g.beginPath();
  g.roundRect(W / 2 - 230, cy - 44, 460, 88, 18);
  g.fill();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#ffffff';
  g.font = `900 40px ${FONT}`;
  g.fillText(title, W / 2, cy - 8);
  g.font = `800 20px ${FONT}`;
  g.fillText(sub, W / 2, cy + 26);
}
