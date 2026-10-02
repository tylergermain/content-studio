// What a video screen plays and how it fits on its face: the sums and the choosing, with no three.js and
// no page in them (tests/screens.test.ts), for index.ts and player.ts beside this.

/** One of a floor's media files, as the office lists them (see MediaFile in server/media.ts). */
export interface MediaFile {
  name: string;
  kind: 'image' | 'video';
  size: number;
}

/**
 * Where a floor's media comes from (see http/routes/files.ts). `size` only makes the address a new one
 * when the file's replaced by another of the same name, which the browser would otherwise keep the old one of.
 */
export const mediaUrl = (floor: string, name: string, size?: number) => `/api/media?floor=${encodeURIComponent(floor)}&name=${encodeURIComponent(name)}${size === undefined ? '' : `&v=${size}`}`;
export const mediaListUrl = (floor: string) => `/api/media?floor=${encodeURIComponent(floor)}&list`;

/** The folder a floor's videos go in, as it's written on an idle screen. */
export const mediaFolder = (floorDir: string) => `${floorDir.replace(/[\\/]+$/, '')}/.agent-office/media`;

/** How long a picture stays up before the next one, in seconds. */
export const SLIDE_SECONDS = 10;
/** How often the folder's looked in again, and how soon after the last look a new screen may ask, in milliseconds. */
export const LIST_EVERY = 60_000;
export const LIST_AT_MOST_EVERY = 3_000;

/** What a screen has to play. */
export interface Programme {
  files: MediaFile[];
  /** It's the one file the screen names, which loops by itself. */
  single: boolean;
}

/**
 * What a screen plays out of the floor's folder: the one file it names, while the folder has it; else
 * every video there, in turn; or with no videos, every picture. `bad` is what wouldn't play here (a
 * codec this browser doesn't have): left out, so one bad file doesn't stop the rest.
 */
export function programme(files: readonly MediaFile[], named?: string, bad: ReadonlySet<string> = new Set()): Programme {
  const ok = files.filter((f) => !bad.has(f.name));
  const one = named ? ok.find((f) => f.name === named) : undefined;
  if (one) return { files: [one], single: true };
  const videos = ok.filter((f) => f.kind === 'video');
  return { files: videos.length ? videos : ok.filter((f) => f.kind === 'image'), single: false };
}

/**
 * Where the screen in `slot` (0, 1, 2… of the `screens` playing the same `count` files) starts, so two
 * side by side don't mirror each other: each on a different file, and the ones that have to share a
 * file (more screens than files) spread through it, `phase` of the way in.
 */
export function startOf(slot: number, count: number, screens: number): { index: number; phase: number } {
  if (count <= 0) return { index: 0, phase: 0 };
  const index = slot % count;
  // How many of the screens start on this file, and which of them this one is.
  const sharing = Math.max(1, Math.ceil((Math.max(screens, slot + 1) - index) / count));
  return { index, phase: Math.floor(slot / count) / sharing };
}

/**
 * The file after `current` in `names` (which are in the folder's order, by name), round to the first
 * again. When `current` has gone from the folder, the one that would have come after it.
 */
export function nextAfter(names: readonly string[], current: string | undefined): string | undefined {
  if (!names.length) return undefined;
  if (current === undefined) return names[0];
  const i = names.indexOf(current);
  if (i >= 0) return names[(i + 1) % names.length];
  return names.find((n) => n.localeCompare(current) > 0) ?? names[0];
}

/** The lowest slot none of `taken` has. */
export function freeSlot(taken: Iterable<number>): number {
  const used = new Set(taken);
  let slot = 0;
  while (used.has(slot)) slot++;
  return slot;
}

/** How much of a picture may be cut off to fill the face before it's shown whole instead. */
export const MAX_CROP = 0.3;

/** How a picture sits on a screen's face. */
export interface Fit {
  /** It fills the face, its overhang cut off; else it's whole, with the face showing either side of it (or over and under). */
  cover: boolean;
  /** How much of the face it takes, across and up (1 is all of it). */
  scale: { x: number; y: number };
  /** The part of the picture that shows, as a texture's repeat and offset. */
  repeat: { x: number; y: number };
  offset: { x: number; y: number };
}

/**
 * Fits a `w` by `h` picture on a `faceW` by `faceH` face without stretching it. Near enough the face's
 * shape (a 16:9 video, 4:3, a wide film) it covers the face, the overhang cut off evenly; a portrait
 * reel, or anything that would lose more than MAX_CROP of itself that way, is shown whole in the middle.
 */
export function fitOn(w: number, h: number, faceW: number, faceH: number): Fit {
  const whole: Fit = { cover: true, scale: { x: 1, y: 1 }, repeat: { x: 1, y: 1 }, offset: { x: 0, y: 0 } };
  if (!(w > 0 && h > 0 && faceW > 0 && faceH > 0)) return whole;
  // Under 1: the picture's narrower than the face, and what shows of it when it covers is this much of its height.
  const ratio = w / h / (faceW / faceH);
  const shows = Math.min(ratio, 1 / ratio);
  if (shows >= 1 - MAX_CROP) {
    if (ratio >= 1) return { ...whole, repeat: { x: shows, y: 1 }, offset: { x: (1 - shows) / 2, y: 0 } };
    return { ...whole, repeat: { x: 1, y: shows }, offset: { x: 0, y: (1 - shows) / 2 } };
  }
  return { ...whole, cover: false, scale: ratio < 1 ? { x: ratio, y: 1 } : { x: 1, y: 1 / ratio } };
}

/** The longest side a screen's picture is kept at: a bigger video is drawn down to DRAWN before it goes to the graphics card. */
export const MAX_SIDE = 1920;
export const DRAWN_SIDE = 1280;

/** A `w` by `h` picture no longer than `max` on its long side, the same shape (and never bigger than it was). */
export function capSize(w: number, h: number, max: number): { w: number; h: number } {
  const long = Math.max(w, h);
  if (!(long > max)) return { w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) };
  const k = max / long;
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/**
 * A path broken into lines of at most `max` characters, at its slashes where it can (a folder's name
 * longer than a line is cut where the line ends).
 */
export function wrapPath(path: string, max: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const part of path.split(/(?<=[\\/])/)) {
    let rest = part;
    if (line && line.length + rest.length > max) {
      lines.push(line);
      line = '';
    }
    while (rest.length > max) {
      lines.push(rest.slice(0, max));
      rest = rest.slice(max);
    }
    line += rest;
  }
  if (line) lines.push(line);
  return lines;
}
