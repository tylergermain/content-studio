import { Blockfall } from './blockfall';
import type { ScreenGame } from './game';
import { Minesweeper } from './minesweeper';
import { Snake } from './snake';
import { Twenty48 } from './twenty48';

/**
 * The arcade's games, in the order the desk's menu and the cabinet's picker list them. Made when the
 * office is (ui.ts takes them rather than making them, so it loads without a page): the one set both
 * hosts play, and a second the cabinet keeps to show someone else's game on.
 */
export function makeGames(): ScreenGame[] {
  return [new Minesweeper(), new Blockfall(), new Twenty48(), new Snake()];
}
