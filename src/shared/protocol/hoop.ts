// The hoop's scoreboard: the building's longest shots and PIG winners, and a floor's game of PIG.

import type { HoopBoard } from '../longshots.js';
import type { PigState } from '../pig.js';

/** The scoreboard beside the hoop, for whoever arrives on a floor: the building's table, and the floor's game of PIG (null: none). */
export interface HoopView {
  board: HoopBoard;
  pig: PigState | null;
}

export type HoopClientMsg =
  /**
   * Ask `to` (someone at the hoop with you: a PeerInfo id) to play PIG. Asking someone who's asked you
   * is a yes. They hear `pig.invited`.
   */
  | { t: 'pig.invite'; to: string }
  /** Yes (or no thanks) to `from`'s invite. */
  | { t: 'pig.answer'; from: string; yes: boolean }
  /** Give up the game of PIG you're in. */
  | { t: 'pig.quit' };

export type HoopServerMsg =
  /**
   * The building's table changed: everyone's told, on every floor. `latest` is the make that changed
   * it (its place on the table, and whether it's the longest anyone's sunk now).
   */
  | { t: 'hoop.board'; board: HoopBoard; latest?: { name: string; dist: number; rank: number; first: boolean } }
  /** The game of PIG on your floor changed (null: there's none now). */
  | { t: 'pig'; pig: PigState | null }
  /** `name` (`from`, a PeerInfo id) asks you to play PIG, until `until` (ms since 1970, the office's clock). */
  | { t: 'pig.invited'; from: string; name: string; until: number };
