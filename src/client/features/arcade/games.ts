import { Blockfall } from './blockfall';
import type { ScreenGame } from './game';
import { Minesweeper } from './minesweeper';
import { Snake } from './snake';
import { Twenty48 } from './twenty48';

/**
 * The games on the boss's monitor, in the order the desk's menu lists them. Made when the office is
 * (ui.ts takes them rather than making them, so it loads without a page).
 */
export function makeGames(): ScreenGame[] {
  return [new Minesweeper(), new Blockfall(), new Twenty48(), new Snake()];
}
