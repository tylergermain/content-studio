import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { JUKEBOX_TUNES, STREAM, YOUTUBE, checkStreamUrl, jukeboxVideo, trackName, trackTitle, tuneById, type JukeboxState, type JukeboxVideo } from '../shared/jukebox.js';

interface Saved {
  on: boolean;
  track: string;
  url?: string;
  /** The YouTube video it has on (see playVideo). */
  video?: JukeboxVideo;
  /** What whoever pasted the link called it. */
  name?: string;
  by?: string;
  /** When the track started, on this machine's clock. */
  startedAt: number;
}

/**
 * The lounge jukebox on one floor, saved in .agent-office/jukebox.json. It only says what's on and
 * since when; every browser plays it for itself, from the same point.
 */
export class Jukebox {
  private s: Saved = { on: false, track: JUKEBOX_TUNES[0].id, startedAt: Date.now() };
  private file: string;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'jukebox.json');
    this.load();
  }

  state(): JukeboxState {
    const { on, track, url, video, name, by, startedAt } = this.s;
    const pasted = track === STREAM || track === YOUTUBE;
    return {
      on,
      track,
      ...(url && track === STREAM ? { url } : {}),
      ...(video && track === YOUTUBE ? { video } : {}),
      ...(name && pasted ? { name } : {}),
      ...(by ? { by } : {}),
      startedAt,
      elapsed: Math.max(0, Date.now() - startedAt),
    };
  }

  /** What's on, for toasts: “Rainy Window”, what someone called a link, a video's channel, or where a stream comes from. */
  title(): string {
    return trackTitle(this.s);
  }

  /**
   * Puts on a tune, a stream, or (with neither) whatever it had. Says whether anything changed, or why
   * it can't. A YouTube link isn't put on here: it comes back as `video`, to be looked up and then
   * put on with playVideo.
   */
  play(input: { track?: unknown; url?: unknown; name?: unknown }, by: string): { changed: boolean } | { video: string } | { error: string } {
    if (input.url !== undefined && input.url !== '') {
      const u = checkStreamUrl(input.url);
      if ('error' in u) return u;
      if (u.video) return { video: u.video };
      const name = trackName(input.name);
      this.set({ on: true, track: STREAM, url: u.url, ...(name ? { name } : {}), by });
    } else if (input.track !== undefined) {
      if (typeof input.track !== 'string' || !tuneById(input.track)) return { error: "The jukebox doesn't have that one" };
      this.set({ on: true, track: input.track, by });
    } else {
      if (this.s.on) return { changed: false };
      this.set({ ...this.s, on: true, by });
    }
    return { changed: true };
  }

  /** Puts a YouTube video on, from the top: every browser on the floor plays it on the lounge TV. */
  playVideo(video: JukeboxVideo, rawName: unknown, by: string) {
    const name = trackName(rawName);
    this.set({ on: true, track: YOUTUBE, video, ...(name ? { name } : {}), by });
  }

  /** On to the next tune; from a stream or a video, back to the first one. */
  skip(by: string) {
    const i = JUKEBOX_TUNES.findIndex((t) => t.id === this.s.track);
    this.set({ on: true, track: JUKEBOX_TUNES[(i + 1) % JUKEBOX_TUNES.length].id, by });
  }

  stop(by: string): boolean {
    if (!this.s.on) return false;
    this.s = { ...this.s, on: false, by };
    this.save();
    return true;
  }

  private set(s: Omit<Saved, 'startedAt'>) {
    this.s = { ...s, startedAt: Date.now() };
    this.save();
  }

  private load() {
    if (!existsSync(this.file)) return;
    try {
      const s = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Saved>;
      const url = s.track === STREAM ? checkStreamUrl(s.url) : undefined;
      const video = s.track === YOUTUBE ? jukeboxVideo(s.video) : undefined;
      if (s.track === YOUTUBE ? !video : s.track === STREAM ? !url || 'error' in url || url.video : typeof s.track !== 'string' || !tuneById(s.track)) return;
      const name = trackName(s.name);
      this.s = {
        on: s.on === true,
        track: s.track!,
        ...(url && 'url' in url ? { url: url.url } : {}),
        ...(video ? { video } : {}),
        ...(name && (url || video) ? { name } : {}),
        ...(typeof s.by === 'string' ? { by: s.by.slice(0, 24) } : {}),
        startedAt: typeof s.startedAt === 'number' && Number.isFinite(s.startedAt) ? s.startedAt : Date.now(),
      };
    } catch {
      // a broken file just means a quiet lounge
    }
  }

  private save() {
    try {
      writeFileSync(this.file, JSON.stringify(this.s, null, 2), { mode: 0o600 });
    } catch {
      // disk issues shouldn't take the office down
    }
  }
}
