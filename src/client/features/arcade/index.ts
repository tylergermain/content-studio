import type { Ctx } from '../../core/context';
import { makeGames } from './games';
import { Arcade } from './ui';

/** The boss's monitor upstairs and the games on it (games.ts), which the boss's desk opens from its menu (see features/boss-desk). */
export function installArcade(ctx: Ctx): Arcade {
  const arcade = new Arcade(ctx.office.bossScreen, makeGames());
  ctx.ticks.add('play', ({ dt }) => arcade.update(ctx.camera, dt));
  // With the camera up at the monitor, the game has the screen: no hands drawn over it.
  ctx.view.add({ covers: () => arcade.zoomed });
  return arcade;
}
