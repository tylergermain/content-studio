/**
 * Video screens (the kinds that play, see KindDef.plays in shared/furniture.ts): each plays the floor's
 * own videos, from its media folder (see server/media.ts), on a loop. A screen that names a file
 * (Piece.media) loops that one; the rest take the folder's videos in turn, each starting on a different
 * one. Looking at one, E opens what's on it in a window, with its sound.
 */
import * as THREE from 'three';
import { kindDef } from '../../../shared/furniture';
import type { Ctx } from '../../core/context';
import { aside, hintTitle, key, onE } from '../../core/hint';
import { store } from '../../state';
import { toast } from '../../ui/dom';
import { idleCard, troubleCard } from './card';
import { ScreenPlayer } from './player';
import { LIST_AT_MOST_EVERY, LIST_EVERY, freeSlot, mediaFolder, mediaListUrl, nextAfter, programme, startOf, type MediaFile, type Programme } from './playlist';
import { openScreenWindow } from './ui';

// The kinds of thing you can use that this defines (see InteractKinds in world/types.ts).
declare module '../../world/types' {
  interface InteractKinds {
    screen: true;
  }
}

/** How long a screen plays on after it's gone out of view, in milliseconds: a glance away doesn't stop it. */
const LINGER = 1500;
/** How long a file that wouldn't play is left out before it's tried again, in milliseconds. */
const BAD_FOR = 5 * 60_000;
/** And one that stopped while it was playing: the office may only have been restarting. */
const RETRY_AFTER = 10_000;

/** A screen on the floor, and where it is in what it plays. */
interface Screen {
  player: ScreenPlayer;
  /** Which of the screens taking the folder in turn it is (see startOf); -1 until it starts. */
  slot: number;
  /** The file it names (Piece.media), and the look in the folder it last went by (see `look`). */
  named: string | undefined;
  seen: number;
  /** When it was last in view. */
  inView: number;
}

const fileKey = (f: MediaFile) => `${f.name}:${f.size}`;

/** Registers the video screens' tick (what's on each, and whether it's playing) and what E does at one. */
export function installScreens(ctx: Ctx) {
  const { office, camera } = ctx;
  const screens = new Map<string, Screen>();
  /** The floor they're on, and what's in its media folder: null until the office has said. */
  let floor: string | null = null;
  let list: MediaFile[] | null = null;
  /** Goes up whenever what there is to play may have changed: the folder was looked in, or a file wouldn't play. */
  let look = 0;
  let lookedAt = -Infinity;
  let looking = false;
  /** What wouldn't play here, and when it didn't; and when the next of them is due another try. */
  const bad = new Map<string, number>();
  let retryAt = 0;
  const cards = new Map<string, THREE.CanvasTexture>();

  const folder = () => mediaFolder(store.currentFloor()?.dir ?? '…');

  /** Asks the office what's in the floor's media folder. */
  async function lookIn() {
    const of = floor;
    if (looking || !of) return;
    looking = true;
    lookedAt = performance.now();
    try {
      const res = await fetch(mediaListUrl(of));
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { media?: MediaFile[] };
      if (of !== floor) return;
      list = Array.isArray(body.media) ? body.media : [];
      look++;
    } catch {
      // The office is restarting, or the floor's gone: the next look is soon.
      if (of === floor && list) lookedAt = performance.now() - LIST_EVERY + LIST_AT_MOST_EVERY;
    } finally {
      looking = false;
    }
  }

  /** What `s` has to play now. */
  function programmeOf(s: Screen): Programme {
    const now = performance.now();
    const out = new Set<string>();
    for (const f of list ?? []) {
      const at = bad.get(fileKey(f));
      if (at !== undefined && now - at < BAD_FOR) out.add(f.name);
    }
    return programme(list ?? [], s.named, out);
  }

  /** The card for a screen with nothing it can play: where videos go, or which of them won't play. */
  function cardFor(): THREE.CanvasTexture {
    const stuck = (list ?? []).filter((f) => bad.has(fileKey(f))).map((f) => f.name);
    const k = stuck.length ? `bad:${stuck.join('|')}` : 'idle';
    let card = cards.get(k);
    if (!card) cards.set(k, (card = stuck.length ? troubleCard(stuck, folder()) : idleCard(folder())));
    return card;
  }

  /** Puts `s` on what it should be playing: from where its slot starts, or on from `after` (a file that's ended, gone or wouldn't play). */
  function tune(s: Screen, after?: string) {
    const p = programmeOf(s);
    if (!p.files.length) return s.player.idle(cardFor());
    const loop = p.files.length === 1;
    const on = after ?? s.player.file?.name;
    if (on !== undefined) {
      const next = nextAfter(p.files.map((f) => f.name), on)!;
      return s.player.play(p.files.find((f) => f.name === next)!, loop);
    }
    if (p.single) return s.player.play(p.files[0], true);
    const sharing = [...screens.values()].filter((o) => o !== s && o.slot >= 0);
    if (s.slot < 0) s.slot = freeSlot(sharing.map((o) => o.slot));
    // Every screen with no file of its own takes a turn, whether it has started yet or not.
    const turns = [...screens.values()].filter((o) => !programmeOf(o).single).length;
    const start = startOf(s.slot, p.files.length, turns);
    s.player.play(p.files[start.index], loop, start.phase);
  }

  /** `s` goes by the folder as it is now: on with what it's playing while that's still there, else something else. */
  function follow(s: Screen) {
    const p = programmeOf(s);
    const playing = s.player.file;
    if (playing && p.files.some((f) => f.name === playing.name && f.size === playing.size)) return s.player.loop(p.single || p.files.length === 1);
    tune(s);
  }

  function add(id: string): Screen {
    const s: Screen = {
      slot: -1,
      named: undefined,
      seen: -1,
      inView: -Infinity,
      player: new ScreenPlayer(floor!, {
        ended: (file) => tune(s, file.name),
        failed: (file, played) => {
          const now = performance.now();
          bad.set(fileKey(file), played ? now - BAD_FOR + RETRY_AFTER : now);
          if (played) retryAt = now + RETRY_AFTER;
          look++;
          s.seen = look;
          tune(s, file.name);
        },
      }),
    };
    screens.set(id, s);
    return s;
  }

  /** Lets go of every screen's video: you've left the floor. */
  function leave() {
    for (const s of screens.values()) s.player.dispose();
    screens.clear();
    for (const c of cards.values()) c.dispose();
    cards.clear();
    bad.clear();
    retryAt = 0;
    list = null;
    lookedAt = -Infinity;
  }

  const frustum = new THREE.Frustum();
  const m = new THREE.Matrix4();

  ctx.ticks.add('world', ({ dt, now }) => {
    if (store.floor !== floor) {
      leave();
      floor = store.floor;
    }
    const here = !!floor && ctx.inOffice() && !ctx.upTop() && !document.hidden;
    // A file that stopped mid-play has sat out long enough: every screen goes by the folder again.
    if (retryAt && now >= retryAt) {
      retryAt = 0;
      look++;
    }
    frustum.setFromProjectionMatrix(m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const standing = new Set<string>();
    let appeared = false;
    for (const v of office.furniture.all()) {
      if (!v.screen || !kindDef(v.piece.kind).plays || !floor) continue;
      const id = v.piece.id;
      standing.add(id);
      let s = screens.get(id);
      if (!s) {
        s = add(id);
        appeared = true;
      }
      // Its face is a new one whenever the piece is built again (painted another color), so it's checked every frame.
      s.player.attach(v.screen);
      const renamed = s.named !== v.piece.media;
      s.named = v.piece.media;
      if (list && (renamed || s.seen !== look)) {
        s.seen = look;
        follow(s);
      }
      if (here && !v.away && frustum.intersectsObject(v.screen)) s.inView = now;
      s.player.tick(dt, here && !v.away && now - s.inView < LINGER);
    }
    for (const [id, s] of screens) {
      if (standing.has(id)) continue;
      s.player.dispose();
      screens.delete(id);
    }
    // Looks in the folder when you arrive, when a screen's put up, and every minute after: a file dropped in shows up by itself.
    if (here && screens.size && !looking) {
      const since = now - lookedAt;
      if (since > LIST_EVERY || ((appeared || !list) && since > LIST_AT_MOST_EVERY)) void lookIn();
    }
  });

  // No frames come while the tab's hidden, so nothing else would stop them playing to nobody.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) for (const s of screens.values()) s.player.tick(0, false);
  });

  ctx.interactions.define('screen', {
    reach: 6,
    hint: (it) => {
      const file = it.pieceId ? screens.get(it.pieceId)?.player.file : undefined;
      if (!file) return { k: 'idle', parts: [hintTitle('📺 Video screen'), aside('Nothing to play yet')] };
      return { k: file.name, parts: [hintTitle(`📺 ${file.name}`), key('E', file.kind === 'video' ? 'Watch with sound' : 'Look closer')] };
    },
    use: onE((it) => {
      const player = it.pieceId ? screens.get(it.pieceId)?.player : undefined;
      const file = player?.file;
      if (!floor || !player || !file) return void toast(`📺 Drop videos in ${folder()}`);
      openScreenWindow({ floor, file, at: player.time, size: player.size });
    }),
  });
}
