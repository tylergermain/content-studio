import type { WatchVideo } from '../shared/protocol.js';
import { YOUTUBE_ID } from '../shared/youtube.js';

// A channel's page of its videos (youtube.com/channel/UC…/videos), read for what its feed used to say.
// YouTube switched its public feeds off in 2026: feeds/videos.xml answers 404 for every channel, and
// for every uploads playlist (playlist_id=UU…) too. The page is YouTube's own web app, with what it
// shows written into it as one JSON object, `ytInitialData`. That object is cut out of the page,
// parsed, and walked for anything shaped like a video wherever it sits, so a grid that's moved or
// wrapped differently still reads. No API key, no sign-in, no script run.
//
// What breaks it, and what the office makes of it (watch.ts says it for each channel on its own):
// - `ytInitialData` renamed, or the videos no longer written into the page (fetched by its script
//   after it loads instead): `parseVideosPage` gives undefined, and "YouTube’s videos page has changed".
// - Videos in a shape it doesn't know (not a `lockupViewModel`, `videoRenderer` or
//   `gridVideoRenderer` with a video id): no videos, and "…lists none the office can read".
// - When each came out no longer written "<n> <unit> ago" in English (another language, which the
//   office asks it not to use with `hl=en`; or a calendar date): every video is left out, as above.
// - YouTube's cookie-consent page (some networks in the EU) or a "confirm you're not a bot" page in
//   its place: there's no `ytInitialData` to find, or the office is sent off to consent.youtube.com.
// The Videos tab lists long videos only, and the Shorts tab doesn't say when a Short came out, so a
// channel's Shorts don't play while its page is what's read.

/** The page of a channel's videos, newest first, in English (its dates are read as English words). */
export const videosUrl = (channel: string): string => `https://www.youtube.com/channel/${channel}/videos?hl=en`;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object';

/** The JSON object or array that starts at `from` (a `{` or `[`), as text: up to the bracket that closes it, minding strings. */
function objectAt(text: string, from: number): string | undefined {
  let depth = 0;
  let quoted = false;
  for (let i = from; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (quoted) {
      if (c === 0x5c) i++;
      else if (c === 0x22) quoted = false;
    } else if (c === 0x22) quoted = true;
    else if (c === 0x7b || c === 0x5b) depth++;
    else if ((c === 0x7d || c === 0x5d) && --depth === 0) return text.slice(from, i + 1);
  }
  return undefined;
}

/** The `ytInitialData` a page of YouTube's carries (`var ytInitialData = {…}`, or `window["ytInitialData"] = {…}`), or undefined. */
export function initialData(html: string): Obj | undefined {
  for (const m of html.matchAll(/\bytInitialData["']?\s*\]?\s*=\s*(?=\{)/g)) {
    const json = objectAt(html, m.index + m[0].length);
    if (!json) continue;
    try {
      const data: unknown = JSON.parse(json);
      if (isObj(data) && !Array.isArray(data)) return data;
    } catch {
      // Not this one.
    }
  }
  return undefined;
}

/** The first value under a property called `key` anywhere in `node`, the nearest first. */
function find(node: unknown, key: string): unknown {
  const queue: unknown[] = [node];
  for (let i = 0; i < queue.length && i < 50_000; i++) {
    const n = queue[i];
    if (!isObj(n)) continue;
    if (!Array.isArray(n) && Object.hasOwn(n, key)) return n[key];
    for (const v of Object.values(n)) if (isObj(v)) queue.push(v);
  }
  return undefined;
}

/** Every string in `node`, in order, leaving out what's under `skip`. */
function* strings(node: unknown, skip?: unknown, depth = 0): Generator<string> {
  if (typeof node === 'string') yield node;
  else if (isObj(node) && node !== skip && depth < 40) for (const v of Object.values(node)) yield* strings(v, skip, depth + 1);
}

/** A piece of text as YouTube's JSON writes it: a string, `{ content }`, `{ simpleText }` or `{ runs: [{ text }] }`. */
function textOf(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (!isObj(v)) return undefined;
  if (typeof v.content === 'string') return v.content;
  if (typeof v.simpleText === 'string') return v.simpleText;
  if (Array.isArray(v.runs)) return v.runs.map((r) => (isObj(r) && typeof r.text === 'string' ? r.text : '')).join('');
  return undefined;
}

/** Text fit for a line under a screen: no control characters or line breaks, one space at a time. */
const clean = (text: string | undefined): string =>
  (text ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const DAY = 86_400_000;
const UNITS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: DAY, w: 7 * DAY, mo: 30 * DAY, y: 365 * DAY };
const AGO = /^(?:(?:streamed|premiered|uploaded|posted|updated)(?:\s+live)?\s+)?(\d+|an?|one)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|wks?|w|months?|mos?|years?|yrs?|y)\s+ago$/i;

/**
 * How long ago "8 hours ago", "8h ago", "Streamed 2 days ago", "5mo ago" means, in milliseconds: at
 * least `least` and less than `most` (YouTube rounds down). Undefined for anything else.
 */
export function ageOf(text: string): { least: number; most: number } | undefined {
  const m = AGO.exec(text.replace(/\s+/g, ' ').trim());
  if (!m) return undefined;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : 1;
  const word = m[2].toLowerCase();
  const unit = UNITS[word.startsWith('mo') ? 'mo' : word[0]];
  return { least: n * unit, most: (n + 1) * unit };
}

/** What YouTube's page calls a video, wherever on the page it is. A Short's own kinds are here too, though the Shorts tab doesn't date them. */
const KINDS = new Set(['lockupViewModel', 'videoRenderer', 'gridVideoRenderer', 'reelItemRenderer', 'shortsLockupViewModel']);

/** Each thing shaped like a video under `node`, in the page's order (and not what's inside one). */
function* items(node: unknown, depth = 0): Generator<[string, Obj]> {
  if (!isObj(node) || depth > 40) return;
  for (const [key, v] of Object.entries(node)) {
    if (!isObj(v)) continue;
    if (KINDS.has(key) && !Array.isArray(v)) yield [key, v];
    else yield* items(v, depth + 1);
  }
}

/** One video as the page has it: its id, title, how long ago it came out, and whether it's a Short. */
function videoOf(kind: string, item: Obj): { id: string; title: string; age?: { least: number; most: number }; short: boolean } | undefined {
  // A lockup is also a playlist's, a channel's, a podcast's.
  if (kind === 'lockupViewModel' && typeof item.contentType === 'string' && !/VIDEO|SHORT/i.test(item.contentType)) return undefined;
  const reel = find(item, 'reelWatchEndpoint');
  const watch = find(item, 'watchEndpoint');
  const id = [item.contentId, item.videoId, isObj(reel) && reel.videoId, isObj(watch) && watch.videoId].find((v): v is string => typeof v === 'string' && YOUTUBE_ID.test(v));
  if (!id) return undefined;
  const meta = find(item, kind === 'shortsLockupViewModel' ? 'overlayMetadata' : 'lockupMetadataViewModel');
  const titled = kind === 'lockupViewModel' ? (isObj(meta) ? meta.title : undefined) : kind === 'shortsLockupViewModel' ? (isObj(meta) ? meta.primaryText : undefined) : (item.title ?? item.headline);
  let age: { least: number; most: number } | undefined;
  for (const s of strings(item, titled)) if ((age = ageOf(s))) break;
  const short = kind === 'reelItemRenderer' || kind === 'shortsLockupViewModel' || reel !== undefined || [...strings(item, titled)].some((s) => /^\/shorts\//.test(s));
  return { id, title: clean(textOf(titled)).slice(0, 200) || 'Untitled', age, short };
}

/** The tab the page is open at (Videos), or the whole of what it shows when it has no tabs. */
function shown(data: Obj): unknown {
  const tabs = find(data.contents, 'tabs');
  if (Array.isArray(tabs))
    for (const t of tabs) {
      const tab = isObj(t) ? (t.tabRenderer ?? t.expandableTabRenderer) : undefined;
      if (isObj(tab) && tab.selected === true) return tab.content;
    }
  return data.contents ?? data;
}

/**
 * A channel's page of its videos as the office plays them: what the channel is called and its videos,
 * newest first. Undefined when the page has no `ytInitialData` to read (see the top of this file).
 *
 * The page only says how long ago each came out ("2 days ago"), so a video's time is the newest those
 * words allow at `now`; when `before` (the channel's videos as last read) gave it a time that the words
 * still allow, it keeps that one, so the same page read ten minutes later gives the same list. Videos
 * the page puts later are older, so two that say the same ("4 days ago") are a second apart, in its order.
 * One that doesn't say when (a première, a stream that's live now) is left out.
 */
export function parseVideosPage(html: string, now: number, before: readonly WatchVideo[] = []): { name: string; videos: WatchVideo[] } | undefined {
  const data = initialData(html);
  if (!data) return undefined;
  const owner = find(data.metadata, 'channelMetadataRenderer');
  const header = find(data.header, 'pageHeaderViewModel');
  const name = clean(textOf(isObj(owner) ? owner.title : undefined) ?? textOf(isObj(header) ? header.title : undefined)).slice(0, 80);
  const was = new Map(before.map((v) => [v.id, v.at]));
  const videos: WatchVideo[] = [];
  for (const [kind, item] of items(shown(data))) {
    const v = videoOf(kind, item);
    if (!v?.age || videos.some((o) => o.id === v.id)) continue;
    const { least, most } = v.age;
    const slack = Math.max(60_000, (most - least) / 10);
    const earliest = now - most - slack;
    const kept = was.get(v.id);
    let at = kept !== undefined && kept >= earliest && kept <= now - least + slack ? kept : now - least;
    const newer = videos.at(-1)?.at;
    if (newer !== undefined && at >= newer && newer - 1000 >= earliest) at = newer - 1000;
    videos.push({ id: v.id, title: v.title, channel: name, at, short: v.short });
  }
  return { name, videos: videos.sort((a, b) => b.at - a.at) };
}
