/**
 * What a game on the boss's monitor is (ui.ts hosts them, games.ts lists them): it draws its whole
 * screen in fixed 960×540 units, so the same picture goes on the board you play on and on the monitor,
 * and it takes the keys and the mouse while its window is open.
 */
export const W = 960;
export const H = 540;

export const FONT = "Nunito, ui-rounded, 'SF Pro Rounded', system-ui, sans-serif";

/** What the mouse did on the board. */
export type Press = 'down' | 'move' | 'up' | 'leave';

export interface ScreenGame {
  /** What the desk's menu knows it by, and what's remembered as the game you played last. */
  readonly id: string;
  readonly icon: string;
  readonly name: string;
  /** How it's played, in the bar under the board. */
  readonly tip: string;
  /** Its window is opening: a new game when the last one was over, else the one that was left. */
  start(): void;
  /** Its window closed, or the page lost the keyboard: lets go of whatever was held, and waits. */
  leave?(): void;
  /** Draws the whole screen. The transform is already set, so only relative transforms from here. */
  paint(g: CanvasRenderingContext2D): void;
  /** Moves the game on by `dt` seconds while its window is open. True when the picture changed. */
  update?(dt: number): boolean;
  /** A key went down or came back up, by its `code`. True when it's the game's: never Escape (the window's), V or M (the call's, see features/boss-desk). */
  key?(code: string, down: boolean): boolean;
  /** The mouse on the board, in the screen's units. `flag` is a right-click, or a Ctrl- or Shift-click for a trackpad. True when the picture changed. */
  pointer?(kind: Press, x: number, y: number, e: { button: number; flag: boolean }): boolean;
}

/** Your best at each game, kept in this browser. */
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

/** Your best at game `id` here, or 0. */
export function best(id: string): number {
  const n = bests()[id];
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0;
}

export function setBest(id: string, n: number): void {
  try {
    localStorage.setItem(BEST_KEY, JSON.stringify({ ...bests(), [id]: n }));
  } catch {
    // private window: it's only for this visit then
  }
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
