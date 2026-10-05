import { TITLES, scoreLine, scoreOf } from '../../../shared/cabinet';
import type { Ctx } from '../../core/context';
import { aside, hintTitle, key, onE } from '../../core/hint';
import { store } from '../../state';
import { clip } from '../../ui/dom';
import { makeGames } from '../arcade/games';
import type { Arcade } from '../arcade/ui';
import { Cabinet } from './ui';

// The kinds of thing you can use that this defines (see InteractKinds in world/types.ts).
declare module '../../world/types' {
  interface InteractKinds {
    cabinet: true;
  }
}

export interface CabinetDeps {
  /** The arcade's games and the office's side of them (see features/arcade): the cabinet plays the same ones as the boss's monitor. */
  arcade: Arcade;
  /** A worker's terminal: one of yours needing you stops the game, with a button to it. */
  openTerminal(id: string): void;
}

/** The arcade cabinet by the jukebox: the arcade's games up close, and on its screen for everyone else on the floor. */
export function installCabinet(ctx: Ctx, deps: CabinetDeps): Cabinet {
  const { arcade } = deps;
  // What it plays, for its hint, in the picker's order: "Minesweeper, Blockfall, 2048 and Snake".
  const names = arcade.games.map((g) => g.name);
  const all = `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  const cabinet = new Cabinet(ctx.office.cabinet.screen, arcade.games, arcade.link, makeGames(), { openTerminal: (id) => deps.openTerminal(id), sound: (kind, lines) => ctx.sound.arcade(kind, lines) });
  ctx.ticks.add('play', ({ dt }) => cabinet.update(ctx.camera, dt));
  ctx.interactions.define('cabinet', {
    reach: 4,
    hint: () => {
      const p = store.cabinet.player;
      const f = store.cabinetFrame;
      if (p && p.id !== store.you) {
        const at = f ? ` · ${scoreLine(p.title, scoreOf(f))}` : '';
        return { k: `${p.name}|${p.title}|${at}`, parts: [hintTitle('🕹️ Arcade'), aside(`▶ ${clip(p.name, 24)} is playing ${TITLES[p.title].name}${at}`), key('E', 'Watch')] };
      }
      const left = cabinet.left;
      const about = left ? `your ${left.game.name} is waiting at ${scoreLine(left.game.id, left.at)}` : all;
      return { k: about, parts: [hintTitle('🕹️ Arcade'), aside(about), key('E', 'Play')] };
    },
    use: onE(() => cabinet.play()),
  });
  // With the camera up at its screen, the game has the screen: no hands drawn over it.
  ctx.view.add({ covers: () => cabinet.zoomed });
  return cabinet;
}
