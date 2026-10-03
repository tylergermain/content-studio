// What a YouTube video on the jukebox is called, asked of YouTube once when someone puts it on.
// The office never fetches the video itself: every browser plays it in YouTube's own player.
import { jukeboxVideo, watchUrl, type JukeboxVideo } from '../shared/jukebox.js';

const TIMEOUT_MS = 6000;
/** An oEmbed answer is a few hundred bytes; anything much longer isn't one. */
const MAX_BYTES = 64 * 1024;

export type Fetch = (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<Response>;

/** Where YouTube says what a video is called and whether other sites may play it. */
export const oembedUrl = (id: string): string => `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl(id))}&format=json`;

/**
 * A video's title and channel from YouTube's oEmbed, or why it can't go on the TV. YouTube answers 401
 * for a video whose owner has turned embedding off, which is the one thing the lounge TV needs.
 */
export async function lookUpVideo(id: string, get: Fetch = fetch): Promise<JukeboxVideo | { error: string }> {
  let res: Response;
  try {
    res = await get(oembedUrl(id), { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'application/json', 'user-agent': 'agent-office' } });
  } catch {
    return { error: "Couldn't reach YouTube to look that video up. Try again in a moment" };
  }
  if (res.status === 401) return { error: "That video's owner doesn't let it play on other sites, so it can't go on the lounge TV" };
  if (res.status === 403) return { error: "That video is private, so it can't go on the lounge TV" };
  if (res.status === 404 || res.status === 400) return { error: 'YouTube has no video at that link' };
  if (!res.ok) return { error: `YouTube wouldn't say what that video is (${res.status}). Try again in a moment` };
  try {
    const text = await readCapped(res, MAX_BYTES);
    const o = JSON.parse(text) as { title?: unknown; author_name?: unknown };
    const video = jukeboxVideo({ id, title: typeof o.title === 'string' ? o.title.trim() : '', by: typeof o.author_name === 'string' ? o.author_name.trim() : '' });
    if (video && (video.title || video.by)) return video;
  } catch {
    // not JSON, or far too long: the same answer as below
  }
  return { error: "YouTube's answer about that video made no sense. Try again in a moment" };
}

/** The body as text, read a piece at a time so an endless one is dropped at `max` bytes. */
async function readCapped(res: Response, max: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      void reader.cancel().catch(() => {});
      throw new Error('too large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
