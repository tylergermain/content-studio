import type { Ctx } from '../../core/context';
import { store } from '../../state';
import { toast } from '../../ui/dom';
import { setScores } from './game';
import { makeGames } from './games';
import { Link } from './link';
import { Arcade } from './ui';

/**
 * The arcade's games (games.ts) and the boss's monitor upstairs, which the boss's desk opens them on
 * from its menu (see features/boss-desk). The cabinet in the lounge plays the same ones
 * (features/cabinet takes them from here), and the office follows whichever is open, on either, for
 * the building's high scores, which every game shows.
 */
export function installArcade(ctx: Ctx): Arcade {
  // Parts are only read when something happens: there's no socket yet while this installs.
  const link = new Link(
    (msg) => ctx.net.send(msg),
    () => toast("🕹️ The office lost track of your game, so here's a new one"),
  );
  const arcade = new Arcade(ctx.office.bossScreen, makeGames(), link);
  ctx.messages.on('cabinet.game', (m) => link.named(m.game, m.title));
  // The building's tables, for every game to show the score to beat: the same wherever it's played.
  store.on('cabinet', () => {
    setScores(store.cabinet.scores);
    arcade.draw();
  });
  ctx.ticks.add('play', ({ dt }) => {
    arcade.update(ctx.camera, dt);
    link.tick();
  });
  // Closing the tab mid-game: the office sees the game as it stands, so what you scored still counts.
  window.addEventListener('pagehide', () => link.push(Infinity));
  // With the camera up at the monitor, the game has the screen: no hands drawn over it.
  ctx.view.add({ covers: () => arcade.zoomed });
  return arcade;
}
