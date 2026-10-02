/**
 * A floor made its own (see shared/studio.ts): its wall boards as bulletins of its own (a newsroom,
 * the team's Slack, how the socials are doing), the agents at its kiosks under its own names, and the
 * ticker round its walls. Admins set a floor up from the office builder, or from a board's window.
 */
import type * as THREE from 'three';
import { BOARDS } from '../../../shared/layout';
import { unseen, type StudioBoard } from '../../../shared/studio';
import type { Ctx, Hint } from '../../core/context';
import { aside, hintTitle, key } from '../../core/hint';
import { store } from '../../state';
import { textPlane } from '../../world/toon';
import { BulletinTexture } from './board';
import { openStudioSetup } from './setup';
import { TickerBand } from './ticker';
import { openBulletin } from './window';

export interface StudioDeps {
  /** Puts every board's face up again, now that a floor's own may have taken one's place (see features/boards). */
  redress(): void;
}

/** A floor's own board, in place of the issues or the pull request one. */
export interface Bulletin {
  texture: THREE.Texture;
  hint(): Hint;
  open(): void;
}

/** Registers the floor's boards (store 'studio', 'integrations') and its ticker (store 'ticker'). */
export function installStudio(ctx: Ctx, deps: StudioDeps) {
  const { office, net } = ctx;
  const faces: Record<StudioBoard, BulletinTexture> = { issues: new BulletinTexture('issues'), pulls: new BulletinTexture('pulls') };
  const openSetup = () => openStudioSetup(net);

  /** The sign over a board says what the floor calls it. */
  const titled: Partial<Record<StudioBoard, string>> = {};
  function retitle(board: StudioBoard, text: string) {
    if (titled[board] === text) return;
    titled[board] = text;
    const label = office.boardLabels[board];
    const fresh = textPlane(text, { bg: '#fffaf3', size: 64 });
    label.geometry.dispose();
    label.material.map?.dispose();
    label.material.dispose();
    label.geometry = fresh.geometry;
    label.material = fresh.material;
    label.material.userData.outlineParameters = { visible: false };
  }

  /** Why a board the office fills has nothing on it, when that's the office not being signed in. */
  function why(board: StudioBoard): string | undefined {
    const feed = store.studio.setup.boards[board]?.feed;
    if (feed?.kind === 'slack') return store.integrations.errors.slack ?? (store.integrations.slack ? (feed.channels.length ? undefined : 'Pick the Slack channels to watch: an admin sets the board up') : 'Sign the office in to Slack: an admin sets the board up');
    if (feed?.kind === 'metricool') return store.integrations.errors.metricool ?? (store.integrations.metricool ? undefined : 'Sign the office in to Metricool: an admin sets the board up');
    return undefined;
  }

  function sync() {
    for (const board of ['issues', 'pulls'] as const) {
      const setup = store.studio.setup.boards[board];
      if (setup) faces[board].render(store.studio, why(board));
      retitle(board, setup ? `${setup.icon} ${setup.title}` : BOARDS[board].label);
    }
    deps.redress();
  }
  store.on('studio', sync);
  store.on('integrations', sync);
  // "5m ago" moves on by itself.
  setInterval(() => (store.studio.setup.boards.issues || store.studio.setup.boards.pulls) && sync(), 60_000);

  const ticker = new TickerBand();
  office.group.add(ticker.group);
  store.on('ticker', () => ticker.set(store.ticker));
  ctx.ticks.add('world', ({ dt }) => ticker.update(dt));

  /** The floor's own board where `board` hangs, if it has one there. */
  function bulletin(board: StudioBoard): Bulletin | null {
    const setup = store.studio.setup.boards[board];
    if (!setup) return null;
    return {
      texture: faces[board].texture,
      hint: () => {
        const fresh = setup.feed?.kind === 'metricool' ? 0 : unseen(store.studio, board);
        return { k: `${board}|${setup.title}|${fresh}`, parts: [hintTitle(`${setup.icon} ${setup.title}`), ...(fresh ? [aside(`${fresh} new`)] : []), key('E', 'Open')] };
      },
      open: () => openBulletin(net, board, openSetup),
    };
  }

  return { bulletin, openSetup };
}
