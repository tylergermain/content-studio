/**
 * A YouTube video on the jukebox. It plays on the lounge TV, in YouTube's own player (world/webscreen.ts),
 * and its sound is the floor's music: as loud as your music volume says, fading as you walk away from
 * the jukebox like its other music, and silent up on the roof. Everyone on the floor is at the same
 * point in it, by the office's clock, and when it ends it comes round again.
 *
 * While a shared screen has the TV, the video moves to a small player docked in a corner of the HUD
 * (dock.ts) and carries on there, and goes back to the TV after.
 */
import './video.css';
import type * as THREE from 'three';
import { YOUTUBE, trackTitle, videoTitle } from '../../../shared/jukebox';
import type { Ctx } from '../../core/context';
import { store } from '../../state';
import { $, h, toast } from '../../ui/dom';
import { webScreen } from '../../world/webscreen';
import { dockPlayer, type VideoPlayer } from './dock';
import { SEEK_EVERY, driftOf, seekTo, startAt } from './sync';

export interface JukeboxVideoDeps {
  /** Whether a screen someone's sharing has the TV (see features/tv). */
  shared(): boolean;
}

/** How long a player gets to start before it's taken to be waiting for the page to be touched, in ms. */
const STUCK_AFTER = 4000;
/** A player takes a moment to come up: it's started this far ahead of everyone, in ms, to come up among them. */
const START_LEAD = 1500;
/** The furthest ahead of everyone a player is moved, in seconds, to make up for how long it takes to load there. */
const MAX_LEAD = 5;

/** The jukebox's video, on `screen` (the lounge TV's). Returns what the TV needs of it. */
export function jukeboxVideo(ctx: Ctx, screen: THREE.Mesh, deps: JukeboxVideoDeps) {
  /** Who and what, in a line: under the player, and in the TV's hint. */
  const line = () => {
    const j = store.jukebox;
    const full = videoTitle(j);
    return `♪ ${trackTitle(j)}${full ? ` · ${full}` : ''}`;
  };
  const corner = h('div.jb-corner');
  $('hud').append(corner);
  const players: Record<'tv' | 'dock', VideoPlayer> = { tv: webScreen(ctx, screen, { title: line }), dock: dockPlayer(corner, line) };

  /** Where it's playing, and which play of which video that is. */
  let where: 'tv' | 'dock' | null = null;
  let shown = '';
  /** The play that YouTube wouldn't show here, which isn't tried again. */
  let failed = '';
  let startedAt = 0;
  let lastSeek = 0;
  /** The volume the player was last told, 0–100: it's only told when that changes. */
  let told = -1;
  /** How long each video is, once a player has said: where to start it the next time is known at once. */
  const lengths = new Map<string, number>();

  const elapsed = () => performance.now() - store.jukebox.since;
  const playOf = (j = store.jukebox) => `${j.video?.id}|${j.startedAt}`;

  // Browsers only let sound start once the page has been touched. You have touched it by the time you're
  // walking about, but a player that started before that sits waiting. So it's started again without its
  // sound, which is always allowed, and a chip says so, once: the first click or key anywhere turns it up.
  let chip: HTMLElement | null = null;
  let offered = false;
  let touched = false;
  /** The player is playing without its sound, until the page is touched. */
  let hushed = false;
  const active = () => navigator.userActivation?.hasBeenActive ?? touched;
  /** How loud the player should be now, 0–100. */
  const loud = () => (hushed ? 0 : Math.round(ctx.sound.musicHeard() * 100));

  function start(p: VideoPlayer) {
    const id = store.jukebox.video!.id;
    // How loud first: a player that's told to play before it's told to be quiet isn't let.
    p.volume((told = loud()) / 100);
    p.show({ id, start: startAt(elapsed() + START_LEAD, lengths.get(id) ?? 0) });
    startedAt = lastSeek = performance.now();
  }

  for (const at of ['tv', 'dock'] as const) {
    players[at].onEnded((why) => {
      if (where !== at) return;
      // It ended: round again, from where everyone is (the top). It can't be played: say so, once.
      if (why === 'ended') return start(players[at]);
      failed = playOf();
      // An untouched page may be all that's wrong, and the first touch tries again (see onTouch).
      if (!active()) return;
      players[at].show(null);
      toast(`📺 YouTube won't play “${store.jukebox.video?.title || trackTitle(store.jukebox)}” in your browser`, 'warn');
    });
  }

  const onTouch = () => {
    const first = !touched;
    touched = true;
    hushed = false;
    chip?.remove();
    chip = null;
    // Whatever kept it from playing before the page was touched may not now: the next frame starts it again.
    if (first && where && !players[where].playing) failed = shown = '';
  };
  for (const type of ['pointerdown', 'keydown'] as const) window.addEventListener(type, onTouch, true);

  /** Puts the video where it belongs now, in step and at the right volume. Every frame, and when the TV changes hands. */
  function update() {
    const j = store.jukebox;
    const on = j.on && j.track === YOUTUBE && !!j.video && ctx.inOffice() && !ctx.upTop();
    const want = !on ? null : deps.shared() ? 'dock' : 'tv';
    const key = want ? `${want}|${playOf(j)}` : '';
    if (key !== shown) {
      if (where && where !== want) players[where].show(null);
      shown = key;
      where = want;
      if (where && failed !== playOf(j)) start(players[where]);
      else if (where) players[where].show(null);
      ctx.hint.invalidate();
    }
    if (!where || failed === playOf(j)) return;
    const p = players[where];
    const now = performance.now();
    const volume = loud();
    if (volume !== told) p.volume((told = volume) / 100);
    const length = p.duration();
    if (length > 0) lengths.set(j.video!.id, length);
    if (p.playing && now - lastSeek > SEEK_EVERY) {
      const at = p.time();
      const to = seekTo(at, elapsed(), length);
      if (to !== undefined) {
        // A little behind soon after it was last moved: that's how long it takes to load, so aim that far ahead.
        const behind = -driftOf(at, to, length);
        const lead = now - lastSeek < 4 * SEEK_EVERY && behind > 0 && behind < 2 * MAX_LEAD ? Math.min(MAX_LEAD, behind) : 0;
        p.seek(Math.min(to + lead, Math.max(to, length - MAX_LEAD)));
        lastSeek = now;
      }
    }
    if (!hushed && !p.playing && volume > 0 && now - startedAt > STUCK_AFTER && !active()) {
      hushed = true;
      start(p);
      if (!offered) {
        offered = true;
        chip = h('button.panel.jb-chip', { type: 'button' }, '🔊 Turn the music on');
        corner.prepend(chip);
      }
    }
  }
  ctx.ticks.add('world', update);

  return {
    update,
    /** What the TV is showing from the jukebox, in a line, or undefined when it isn't. */
    showing: (): string | undefined => (where === 'tv' && failed !== playOf() ? line() : undefined),
  };
}
