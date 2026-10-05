// The lounge jukebox: the tunes it has and what it's playing, shared by the server (which keeps one
// per floor) and the browser (which synthesizes the tunes, see client/sound/music.ts).

import { YOUTUBE_ID, youtubeId } from './youtube.js';

export interface JukeboxTune {
  id: string;
  title: string;
  /** A few words on the card in its list. */
  mood: string;
}

export const JUKEBOX_TUNES: readonly JukeboxTune[] = [
  { id: 'rainy-window', title: 'Rainy Window', mood: 'slow and dreamy' },
  { id: 'coffee-break', title: 'Coffee Break', mood: 'jazzy, easy swing' },
  { id: 'late-commit', title: 'Late Commit', mood: 'minor key, 2 a.m.' },
  { id: 'green-build', title: 'Green Build', mood: 'bright and bouncy' },
];

/** The `track` of a stream someone pasted. */
export const STREAM = 'stream';
/** The `track` of a YouTube video someone pasted: `video`, which plays on the lounge TV with its sound as the music. */
export const YOUTUBE = 'youtube';

/** A YouTube video on the jukebox: its id, and what YouTube says it's called and whose channel it's on. */
export interface JukeboxVideo {
  id: string;
  title: string;
  /** The channel's name. */
  by: string;
}

export interface JukeboxState {
  on: boolean;
  /** One of JUKEBOX_TUNES, STREAM for `url`, or YOUTUBE for `video`. It stays put while the jukebox is off, to turn back on. */
  track: string;
  /** Internet radio or an audio file someone pasted. */
  url?: string;
  /** The YouTube video someone pasted a link to. */
  video?: JukeboxVideo;
  /** What whoever pasted the link called it, which the display shows instead of where it comes from. */
  name?: string;
  /** Who last put something on, or turned it off. */
  by?: string;
  /** When the track started, on the office's clock (see the 'pong' message), so everyone hears the same bar. */
  startedAt: number;
  /** How far into the track it was when this was sent, in ms, for until the clocks are compared. */
  elapsed: number;
}

export const tuneById = (id: string): JukeboxTune | undefined => JUKEBOX_TUNES.find((t) => t.id === id);

/** How long a label someone types for a link can be: what fits on the jukebox's display. */
export const NAME_MAX = 40;

/** The label typed for a pasted link, tidied: one line, no longer than the display takes. Undefined when there's none. */
export function trackName(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const name = raw
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX)
    .trim();
  return name || undefined;
}

/** A video as it came off the wire or the disk, if it is one: an id YouTube could have given, and its two lines. */
export function jukeboxVideo(raw: unknown): JukeboxVideo | undefined {
  const v = raw as Partial<JukeboxVideo> | null | undefined;
  if (!v || typeof v !== 'object' || typeof v.id !== 'string' || !YOUTUBE_ID.test(v.id)) return undefined;
  return { id: v.id, title: typeof v.title === 'string' ? v.title.slice(0, 200) : '', by: typeof v.by === 'string' ? v.by.slice(0, 100) : '' };
}

/** Where a video is on YouTube, for a link to it. */
export const watchUrl = (id: string): string => `https://www.youtube.com/watch?v=${id}`;

/**
 * What's on, for the hint bar and the jukebox's own display: the label someone typed for a link, else
 * a tune's title, a video's channel, or where the stream comes from.
 */
export function trackTitle(s: Pick<JukeboxState, 'track' | 'url' | 'video' | 'name'>): string {
  if (s.track !== STREAM && s.track !== YOUTUBE) return tuneById(s.track)?.title ?? 'A tune';
  if (s.name) return s.name;
  if (s.track === YOUTUBE) return s.video?.by || s.video?.title || 'A video';
  try {
    const u = new URL(s.url ?? '');
    const file = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() ?? '');
    return file ? `${u.hostname} · ${file}` : u.hostname;
  } catch {
    return 'A stream';
  }
}

/** The second line under a video's label: its full title, unless that's what the first line says already. */
export function videoTitle(s: Pick<JukeboxState, 'track' | 'url' | 'video' | 'name'>): string {
  const title = s.video?.title ?? '';
  return title && title !== trackTitle(s) ? title : '';
}

/**
 * A pasted link: a YouTube video (its id), or a stream or an audio file (its address), or why it's
 * neither. A link to YouTube that names no video is turned away here, rather than tried as a stream.
 */
export function checkStreamUrl(raw: unknown): { url: string; video?: string } | { error: string } {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return { error: 'Paste a link to a stream, an audio file or a YouTube video' };
  if (s.length > 2048) return { error: 'That link is too long' };
  const video = youtubeId(s);
  if (video) return { url: watchUrl(video), video };
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { error: "That isn't a web link. Paste an address that starts with https://" };
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { error: 'Only http and https links can play on the jukebox' };
  if (/(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be)$/i.test(u.hostname)) return { error: "That YouTube link doesn't name a video. Paste the video's own link (youtube.com/watch?v=…)" };
  return { url: u.href };
}
