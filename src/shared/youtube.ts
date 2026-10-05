/** YouTube links, read the same way by the browser (what a screen plays) and the server (what a link names). */

/** What a YouTube video id looks like: eleven characters from the URL-safe base64 alphabet. */
export const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/** The hosts a YouTube link can be on. Anything else is not a YouTube link, whatever its path says. */
const HOSTS = new Set(['youtube.com', 'youtube-nocookie.com', 'youtu.be']);

/** The YouTube host a link is on with its `www.` / `m.` / `music.` prefix dropped, or undefined when it is somewhere else. */
export function youtubeHost(url: URL): string | undefined {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
  const host = url.hostname.toLowerCase().replace(/^(www|m|music)\./, '');
  return HOSTS.has(host) ? host : undefined;
}

/** A pasted link as a URL: people paste `youtube.com/…` without the scheme as often as with it. */
export function youtubeUrl(text: string): URL | undefined {
  const raw = text.trim();
  if (!raw || /\s/.test(raw)) return undefined;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    return youtubeHost(url) ? url : undefined;
  } catch {
    return undefined;
  }
}

/** The 11-character video id in a YouTube link (watch?v=, youtu.be/, /shorts/, /live/, /embed/), or undefined. */
export function youtubeId(url: string): string | undefined {
  const link = youtubeUrl(url);
  if (!link) return undefined;
  const parts = link.pathname.split('/').filter(Boolean);
  const id =
    youtubeHost(link) === 'youtu.be'
      ? parts[0]
      : parts[0] === 'watch'
        ? (link.searchParams.get('v') ?? undefined)
        : ['shorts', 'live', 'embed', 'v'].includes(parts[0] ?? '')
          ? parts[1]
          : undefined;
  return id && YOUTUBE_ID.test(id) ? id : undefined;
}

/** What a YouTube channel's id looks like: UC and twenty-two more characters. */
export const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;

/**
 * What a pasted link says about the channel it's from: the channel itself (a /channel/UC… link), or a
 * page of YouTube's to read the channel's id from (a handle's, a video's). `url` is the link tidied,
 * always on www.youtube.com, whatever host it was pasted with.
 */
export type ChannelLink = { kind: 'channel'; id: string; url: string } | { kind: 'page'; url: string };

/** The channel a pasted link is about (see ChannelLink), or undefined for anything that isn't a YouTube channel or video link. */
export function channelLink(text: string): ChannelLink | undefined {
  const link = youtubeUrl(text);
  if (!link) return undefined;
  const video = youtubeId(link.href);
  if (video) return { kind: 'page', url: `https://www.youtube.com/watch?v=${video}` };
  if (youtubeHost(link) === 'youtu.be') return undefined;
  let parts: string[];
  try {
    parts = link.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  } catch {
    return undefined;
  }
  const [first, second] = parts;
  if (first === 'channel') return second && CHANNEL_ID.test(second) ? { kind: 'channel', id: second, url: `https://www.youtube.com/channel/${second}` } : undefined;
  if (first?.startsWith('@') && first.length > 1 && first.length <= 80) return { kind: 'page', url: `https://www.youtube.com/@${encodeURIComponent(first.slice(1))}` };
  if ((first === 'c' || first === 'user') && second && second.length <= 80) return { kind: 'page', url: `https://www.youtube.com/${first}/${encodeURIComponent(second)}` };
  return undefined;
}
