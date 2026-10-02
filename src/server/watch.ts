import type { Floor } from './floor.js';
import type { WatchState, WatchVideo } from '../shared/protocol.js';
import type { WatchChannel } from '../shared/studio.js';
import { CHANNEL_ID, YOUTUBE_ID, channelLink, youtubeHost } from '../shared/youtube.js';

// The YouTube channels a floor watches (see StudioSetup.watch in shared/studio.ts): the office finds
// which channel each pasted link is, and reads every channel's public feed for its newest videos,
// which the floor's screens play through YouTube's own player (client/features/screens). No API key:
// the feeds are the ones a feed reader subscribes to. One of these for the whole building.

/** How often every channel is read, and how soon after its last read a change of setup may read one again. */
const EVERY_MS = 10 * 60_000;
const FRESH_MS = 60_000;
const TIMEOUT_MS = 10_000;
/** The most of a feed, and of a channel's or a video's page, that's read. */
const FEED_BYTES = 1024 * 1024;
const PAGE_BYTES = 4 * 1024 * 1024;
/** How many videos a floor is sent: the newest across all its channels. */
export const KEEP = 30;
/** How many channels are read at once. */
const AT_ONCE = 4;

export const feedUrl = (channel: string): string => `https://www.youtube.com/feeds/videos.xml?channel_id=${channel}`;

/** What `&amp;`, `&#39;`, `&#x27;` and the rest stand for, and a CDATA section's own text. */
function unescape(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole, name: string) => {
      const n = name.toLowerCase();
      if (n[0] !== '#') return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[n] ?? whole;
      const code = n[1] === 'x' ? parseInt(n.slice(2), 16) : parseInt(n.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** What's inside the first `<name>…</name>` in `xml`, as text. */
function tag(xml: string, name: string): string | undefined {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}\\s*>`, 'i').exec(xml);
  return m ? unescape(m[1]) : undefined;
}

/** The `href` of the first `<link rel="alternate">` in `xml` (or of its first link, with none marked so). */
function linkOf(xml: string): string | undefined {
  const links = [...xml.matchAll(/<link\b([^>]*)>/gi)].map((m) => m[1]);
  const pick = links.find((a) => /\brel\s*=\s*["']alternate["']/i.test(a)) ?? links[0];
  const href = pick && /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(pick);
  return href ? unescape(href[1] ?? href[2] ?? '') : undefined;
}

/**
 * A channel's feed as YouTube writes it (Atom, one `<entry>` a video): what the channel is called, and
 * its videos, newest first. Read with regular expressions rather than an XML parser, so a feed that's
 * cut short, or has something new in it, still gives what it has; an entry with no video id or no
 * date is left out.
 */
export function parseFeed(xml: string): { name: string; videos: WatchVideo[] } {
  const head = xml.split(/<entry\b/i)[0] ?? '';
  const name = tag(head, 'title') ?? tag(head, 'name') ?? '';
  const videos: WatchVideo[] = [];
  for (const m of xml.matchAll(/<entry\b[^>]*>([\s\S]*?)(?:<\/entry\s*>|(?=<entry\b)|$)/gi)) {
    const entry = m[1];
    const id = tag(entry, 'yt:videoId') ?? /^yt:video:(.+)$/.exec(tag(entry, 'id') ?? '')?.[1];
    const at = Date.parse(tag(entry, 'published') ?? tag(entry, 'updated') ?? '');
    if (!id || !YOUTUBE_ID.test(id) || !Number.isFinite(at)) continue;
    if (videos.some((v) => v.id === id)) continue;
    const title = (tag(entry, 'title') ?? tag(entry, 'media:title') ?? '').slice(0, 200);
    videos.push({ id, title: title || 'Untitled', channel: (tag(entry, 'name') ?? name).slice(0, 80), at, short: /\/shorts\//i.test(linkOf(entry) ?? '') });
  }
  return { name: name.slice(0, 80), videos: videos.sort((a, b) => b.at - a.at) };
}

/**
 * The id of the channel a page of YouTube's is about: a channel's own page says so in its canonical
 * link and its `externalId`, a video's in `externalChannelId` and the `channelId` of the video itself.
 * (A channel's page names other channels too, the ones it features, so the first `channelId` is the last resort.)
 */
export function channelIdIn(html: string): string | undefined {
  const id = '(UC[A-Za-z0-9_-]{22})';
  for (const marker of [
    `<link[^>]+rel=["']canonical["'][^>]+href=["']https?://www\\.youtube\\.com/channel/${id}["']`,
    `<link[^>]+href=["']https?://www\\.youtube\\.com/channel/${id}["'][^>]+rel=["']canonical["']`,
    `"externalId"\\s*:\\s*"${id}"`,
    `"externalChannelId"\\s*:\\s*"${id}"`,
    `<meta[^>]+itemprop=["'](?:channelId|identifier)["'][^>]+content=["']${id}["']`,
    `"channelId"\\s*:\\s*"${id}"`,
  ]) {
    const m = new RegExp(marker).exec(html);
    if (m && CHANNEL_ID.test(m[1])) return m[1];
  }
  return undefined;
}

/** The newest `keep` of `videos`, newest first, each once. */
export function newest(videos: readonly WatchVideo[], keep = KEEP): WatchVideo[] {
  const seen = new Set<string>();
  return [...videos]
    .sort((a, b) => b.at - a.at || a.id.localeCompare(b.id))
    .filter((v) => !seen.has(v.id) && !!seen.add(v.id))
    .slice(0, keep);
}

/**
 * A page of YouTube's, as text, no more than `max` bytes of it. It's followed where it's sent on, but
 * only while that's still YouTube, a few times, and never for longer than TIMEOUT_MS.
 */
async function read(url: string, max: number): Promise<string> {
  let at = new URL(url);
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  for (let hop = 0; hop < 4; hop++) {
    if (at.hostname === 'consent.youtube.com') throw new Error('YouTube asked the office to agree to cookies before showing that page. Paste the channel’s own link instead (youtube.com/channel/UC…)');
    if (at.protocol !== 'https:' || !youtubeHost(at)) throw new Error('YouTube sent that link somewhere that isn’t YouTube');
    const res = await fetch(at, { redirect: 'manual', signal, headers: { 'user-agent': 'Mozilla/5.0 (compatible; agent-office)', 'accept-language': 'en' } });
    if (res.status >= 300 && res.status < 400) {
      void res.body?.cancel().catch(() => {});
      const to = res.headers.get('location');
      if (!to) break;
      at = new URL(to, at);
      continue;
    }
    if (!res.ok) {
      void res.body?.cancel().catch(() => {});
      throw new Error(res.status === 404 ? 'YouTube has nothing at that link' : `YouTube answered ${res.status}`);
    }
    const reader = res.body?.getReader();
    if (!reader) return '';
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
      if (size >= max) {
        void reader.cancel().catch(() => {});
        break;
      }
    }
    return Buffer.concat(chunks).subarray(0, max).toString('utf8');
  }
  throw new Error('YouTube kept sending that link on');
}

const why = (err: unknown): string => {
  const e = err as Error;
  return e.name === 'TimeoutError' || e.name === 'AbortError' ? 'YouTube took too long to answer' : e.message.startsWith('YouTube') ? e.message : `YouTube couldn’t be reached (${e.message})`;
};

/** What a floor that watches nothing has been told, without being told. */
const NOTHING = JSON.stringify([[], undefined]);

export interface WatchOut {
  floors(): Iterable<Floor>;
  /** What a floor's screens have to play changed. */
  watch(floor: Floor): void;
  /** A floor's setup changed: the office found which channel a link is, or what it's called. */
  studio(floor: Floor): void;
}

/** What the office knows of a channel's feed. */
interface Feed {
  videos: WatchVideo[];
  /** When it was last read (or tried). */
  at: number;
  error?: string;
}

export class Watch {
  /** By channel id. */
  private feeds = new Map<string, Feed>();
  /** Why the channel behind a link couldn't be found, by the link. */
  private lost = new Map<string, { error: string; at: number }>();
  /** What each floor was last told, so it's only told again when that changes. */
  private told = new Map<string, string>();
  private timer?: NodeJS.Timeout;
  private busy = false;
  /** A read was asked for while one was under way: `true` for every channel, `false` for the ones that are due. */
  private next: boolean | undefined;

  constructor(private out: WatchOut) {}

  start() {
    this.timer = setInterval(() => this.run(true), EVERY_MS);
    this.timer.unref();
    // Soon after the floors are open, not ten minutes from now.
    setTimeout(() => this.run(true), 2500).unref();
  }

  stop() {
    clearInterval(this.timer);
  }

  /** What a floor that watches `channels` has to play. */
  state(channels: readonly WatchChannel[]): WatchState {
    const errors: Record<string, string> = {};
    let at = 0;
    for (const c of channels) {
      const feed = c.id ? this.feeds.get(c.id) : undefined;
      const error = c.id ? feed?.error : this.lost.get(c.url)?.error;
      if (error) errors[c.url] = error;
      at = Math.max(at, feed?.at ?? 0);
    }
    const videos = newest(channels.flatMap((c) => (c.id ? (this.feeds.get(c.id)?.videos ?? []) : [])));
    return { videos, at, ...(Object.keys(errors).length ? { errors } : {}) };
  }

  /** A floor's channels changed: the new ones are found and read now rather than at the next ten minutes. */
  refresh() {
    this.run(false);
  }

  private run(all: boolean) {
    if (this.busy) return void (this.next = all || this.next === true);
    this.busy = true;
    void this.read(all)
      .catch(() => {})
      .finally(() => {
        this.busy = false;
        const next = this.next;
        this.next = undefined;
        if (next !== undefined) this.run(next);
      });
  }

  /** Finds the channels that are only a link so far, reads the feeds that are due (or `all` of them), and tells the floors whose videos changed. */
  private async read(all: boolean) {
    const floors = [...this.out.floors()];
    const now = Date.now();
    // Which channel each link is: once per link, however many floors pasted it.
    const links = new Set(floors.flatMap((f) => f.studio.watching().filter((c) => !c.id).map((c) => c.url)));
    const due = [...links].filter((url) => all || now - (this.lost.get(url)?.at ?? 0) > FRESH_MS);
    await this.each(due, async (url) => {
      try {
        const link = channelLink(url);
        if (!link) throw new Error('YouTube links only: a channel’s, or one of its videos’');
        const id = link.kind === 'channel' ? link.id : channelIdIn(await read(link.url, PAGE_BYTES));
        if (!id) throw new Error('YouTube’s page for that link doesn’t say which channel it is. Paste the channel’s own link instead (youtube.com/channel/UC…)');
        this.lost.delete(url);
        for (const f of floors) if (f.studio.found(url, id, '')) this.out.studio(f);
      } catch (err) {
        this.lost.set(url, { error: why(err), at: Date.now() });
      }
    });

    const ids = new Set(floors.flatMap((f) => f.studio.watching().flatMap((c) => c.id || [])));
    for (const id of this.feeds.keys()) if (!ids.has(id)) this.feeds.delete(id);
    for (const url of this.lost.keys()) if (!floors.some((f) => f.studio.watching().some((c) => c.url === url))) this.lost.delete(url);
    await this.each(
      [...ids].filter((id) => all || now - (this.feeds.get(id)?.at ?? 0) > FRESH_MS),
      async (id) => {
        const was = this.feeds.get(id);
        try {
          const feed = parseFeed(await read(feedUrl(id), FEED_BYTES));
          this.feeds.set(id, { videos: feed.videos, at: Date.now() });
          if (feed.name) for (const f of floors) for (const c of f.studio.watching()) if (c.id === id && f.studio.found(c.url, id, feed.name)) this.out.studio(f);
        } catch (err) {
          // What it had out last time stays up: YouTube's feeds have their off moments.
          this.feeds.set(id, { videos: was?.videos ?? [], at: Date.now(), error: why(err) });
        }
      },
    );

    for (const f of this.out.floors()) {
      const state = this.state(f.studio.watching());
      // When it was read isn't news by itself.
      const key = JSON.stringify([state.videos, state.errors]);
      if ((this.told.get(f.id) ?? NOTHING) === key) continue;
      this.told.set(f.id, key);
      this.out.watch(f);
    }
  }

  /** Runs `fn` over `items`, a few at a time. */
  private async each<T>(items: readonly T[], fn: (item: T) => Promise<void>) {
    for (let i = 0; i < items.length; i += AT_ONCE) await Promise.all(items.slice(i, i + AT_ONCE).map(fn));
  }
}
