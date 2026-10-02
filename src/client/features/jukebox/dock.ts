/**
 * The jukebox's video docked in a corner of the HUD, for while a shared screen has the lounge TV: it
 * moves here and keeps playing, in view, and goes back to the TV after (see video.ts).
 *
 * It is YouTube's own embedded player and nothing else, the same one a screen in the world has
 * (world/webscreen-player.ts): the office never touches the video or its sound.
 */
import { h } from '../../ui/dom';
import { Embed, YT } from '../../world/webscreen-player';

/** What the video controller asks of a player: the TV's (world/webscreen.ts's WebScreen is one) or the docked one. */
export interface VideoPlayer {
  /** Plays the video `id` from `start` seconds, or takes the player off with null. */
  show(video: { id: string; start?: number } | null): void;
  /** 0..1; 0 mutes. */
  volume(v: number): void;
  /** Seconds into the video, and its length (0 until the player knows). */
  time(): number;
  duration(): number;
  seek(seconds: number): void;
  onEnded(fn: (why: 'ended' | 'error') => void): void;
  readonly playing: boolean;
}

/** The docked player, in `parent` (a corner of the HUD): hidden until it's shown a video. `title` is the line under it. */
export function dockPlayer(parent: HTMLElement, title: () => string): VideoPlayer {
  const stage = h('div.jb-dock-player');
  const caption = h('div.jb-dock-title');
  const el = h('section.panel.jb-dock.hidden', { 'aria-label': 'The jukebox’s video' }, stage, caption);
  parent.append(el);

  let embed: Embed | null = null;
  /** Where it was started or last moved to, for until the player says where it is. */
  let at = 0;
  let loud = 0;
  let ended: (why: 'ended' | 'error') => void = () => {};

  function show(video: { id: string; start?: number } | null) {
    embed?.destroy();
    embed = null;
    el.classList.toggle('hidden', !video);
    if (!video) return;
    caption.textContent = title();
    at = Math.max(0, video.start ?? 0);
    const mine: Embed = (embed = new Embed(stage, { id: video.id, start: at }, {
      state: (state) => embed === mine && state === YT.ended && ended('ended'),
      error: () => embed === mine && ended('error'),
    }));
    mine.volume(loud);
  }

  // As on a screen in the world: nothing plays to nobody while the tab's hidden.
  document.addEventListener('visibilitychange', () => (document.hidden ? embed?.pause() : embed?.play()));

  return {
    show,
    volume(v) {
      loud = Math.max(0, Math.min(1, v));
      embed?.volume(loud);
    },
    time: () => embed?.time() ?? at,
    duration: () => embed?.duration() ?? 0,
    seek(seconds) {
      at = Math.max(0, seconds);
      embed?.seek(at);
    },
    onEnded(fn) {
      ended = fn;
    },
    get playing() {
      return embed?.state === YT.playing;
    },
  };
}
