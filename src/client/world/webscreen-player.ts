/**
 * YouTube's own embedded player, in an iframe of ours: where its address is made, and the IFrame Player
 * API that drives one (play, pause, seek, how loud, what it's doing). Nothing of a video is ever fetched
 * by the office: the player is YouTube's, on youtube-nocookie.com. webscreen.ts puts one on a screen in
 * the world; a window that plays a video with its controls uses the same address (see embedFrame).
 */

/** What the player is doing, as its API numbers it. */
export const YT = { unstarted: -1, ended: 0, playing: 1, paused: 2, buffering: 3, cued: 5 } as const;

/** The part of YouTube's player this uses (https://developers.google.com/youtube/iframe_api_reference). */
interface Player {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  mute(): void;
  unMute(): void;
  setVolume(volume: number): void;
  getCurrentTime(): number;
  getDuration(): number;
  loadVideoById(video: { videoId: string; startSeconds?: number }): void;
  destroy(): void;
}

interface Api {
  Player: new (frame: HTMLIFrameElement, opts: { events: { onReady?(): void; onStateChange?(e: { data: number }): void; onError?(e: { data: number }): void } }) => Player;
}

let api: Promise<Api> | null = null;

/** YouTube's IFrame Player API, fetched the first time a screen needs it. */
function loadApi(): Promise<Api> {
  api ??= new Promise<Api>((resolve, reject) => {
    const w = window as unknown as { YT?: Api; onYouTubeIframeAPIReady?: () => void };
    if (w.YT?.Player) return resolve(w.YT);
    // Something else on the page may be waiting on it too.
    const theirs = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      theirs?.();
      resolve(w.YT!);
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => {
      // Offline, or blocked: the next screen to need it asks again.
      api = null;
      script.remove();
      reject(new Error('YouTube could not be reached'));
    };
    document.head.append(script);
  });
  return api;
}

export interface EmbedOptions {
  /** Seconds in. */
  start?: number;
  /** YouTube's own controls, keys and full screen: for a window you watch in, never for a screen in the world. */
  controls?: boolean;
  muted?: boolean;
}

/** The address of YouTube's player for the video `id`. */
export function embedUrl(id: string, { start = 0, controls = false, muted = false }: EmbedOptions = {}): string {
  const q = new URLSearchParams({ autoplay: '1', playsinline: '1', rel: '0', enablejsapi: '1', origin: location.origin });
  if (start >= 1) q.set('start', String(Math.floor(start)));
  if (muted) q.set('mute', '1');
  if (!controls) for (const [k, v] of [['controls', '0'], ['disablekb', '1'], ['fs', '0'], ['iv_load_policy', '3']]) q.set(k, v);
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?${q}`;
}

/** An iframe for YouTube's player at `src` (see embedUrl). */
export function embedFrame(src: string, title: string): HTMLIFrameElement {
  const frame = document.createElement('iframe');
  frame.title = title;
  frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
  // The office's own pages send no referrer, and YouTube's player won't start without one.
  frame.referrerPolicy = 'strict-origin-when-cross-origin';
  frame.src = src;
  return frame;
}

export interface EmbedHooks {
  /** What the player's doing changed (see YT). */
  state(state: number): void;
  /** The video can't be played: it's gone, its owner doesn't let it play outside YouTube, or YouTube couldn't be reached. */
  error(code: number): void;
}

/** One of YouTube's players, in `frame`: muted and without controls, for a screen in the world. */
export class Embed {
  readonly frame: HTMLIFrameElement;
  /** What it's doing (see YT). */
  state: number = YT.unstarted;
  private player: Player | null = null;
  private ready = false;
  private gone = false;
  private loud = 0;
  private wanted = true;

  /** Puts the player for `video` in `into`. */
  constructor(into: HTMLElement, video: { id: string; start: number }, hooks: EmbedHooks) {
    this.frame = embedFrame(embedUrl(video.id, { start: video.start, muted: true }), 'YouTube video');
    // Never something to tab to or click: the page keeps its keys and the mouse.
    this.frame.tabIndex = -1;
    this.frame.setAttribute('aria-hidden', 'true');
    into.append(this.frame);
    loadApi().then(
      (yt) => {
        if (this.gone) return;
        this.player = new yt.Player(this.frame, {
          events: {
            onReady: () => {
              if (this.gone) return;
              this.ready = true;
              this.volume(this.loud);
              if (this.wanted) this.player!.playVideo();
              else this.player!.pauseVideo();
            },
            onStateChange: (e) => {
              if (this.gone) return;
              this.state = e.data;
              hooks.state(e.data);
            },
            onError: (e) => !this.gone && hooks.error(e.data),
          },
        });
      },
      () => !this.gone && hooks.error(-1),
    );
  }

  /** YouTube's player has come up in the frame. */
  get up(): boolean {
    return this.ready;
  }

  /** On to another video, `start` seconds in, in the same player. */
  load(id: string, start: number) {
    if (this.ready) this.player!.loadVideoById({ videoId: id, startSeconds: start });
    // Not up yet: it comes up on this one instead.
    else this.frame.src = embedUrl(id, { start, muted: true });
  }

  play() {
    this.wanted = true;
    if (this.ready) this.player!.playVideo();
  }

  pause() {
    this.wanted = false;
    if (this.ready) this.player!.pauseVideo();
  }

  seek(seconds: number) {
    if (this.ready) this.player!.seekTo(seconds, true);
  }

  /** 0 to 1; 0 mutes. */
  volume(v: number) {
    this.loud = v;
    if (!this.ready) return;
    if (v <= 0) return this.player!.mute();
    this.player!.unMute();
    this.player!.setVolume(Math.round(Math.min(1, v) * 100));
  }

  /** Seconds into the video and its length, or undefined before the player knows. */
  time(): number | undefined {
    const t = this.ready ? this.player!.getCurrentTime() : undefined;
    return typeof t === 'number' && Number.isFinite(t) ? t : undefined;
  }

  duration(): number | undefined {
    const d = this.ready ? this.player!.getDuration() : undefined;
    return typeof d === 'number' && d > 0 ? d : undefined;
  }

  /** Takes the player away for good. */
  destroy() {
    this.gone = true;
    try {
      this.player?.destroy();
    } catch {
      // half-made: the frame going is enough
    }
    this.frame.remove();
  }
}
