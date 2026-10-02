import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import type http from 'node:http';
import path from 'node:path';

// A floor's own media: the pictures and videos kept in its .agent-office/media folder, for its walls
// (a logo, a sign) and its screens (videos on a loop). The office serves them to the floor's browsers;
// nothing else in the floor's folder is reachable this way.

const TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
};

/** A media file's name: a plain file name, no folders, with a type the office serves. */
export function mediaName(raw: unknown): string | undefined {
  const name = typeof raw === 'string' ? raw.trim() : '';
  return /^[\w][\w.\- ()]{0,120}$/.test(name) && !name.includes('..') && TYPES[path.extname(name).toLowerCase()] ? name : undefined;
}

export const mediaDir = (floorDir: string) => path.join(floorDir, '.agent-office', 'media');

export interface MediaFile {
  name: string;
  /** 'image' or 'video'. */
  kind: 'image' | 'video';
  size: number;
}

/** What's in a floor's media folder, by name. */
export function listMedia(floorDir: string): MediaFile[] {
  const dir = mediaDir(floorDir);
  if (!existsSync(dir)) return [];
  const out: MediaFile[] = [];
  for (const entry of readdirSync(dir)) {
    const name = mediaName(entry);
    if (!name) continue;
    try {
      const st = statSync(path.join(dir, name));
      if (st.isFile()) out.push({ name, kind: TYPES[path.extname(name).toLowerCase()].startsWith('video') ? 'video' : 'image', size: st.size });
    } catch {
      // gone meanwhile
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Sends one of a floor's media files, the part of it asked for (a video is fetched a range at a time). */
export function sendMedia(req: http.IncomingMessage, res: http.ServerResponse, floorDir: string, raw: unknown) {
  const name = mediaName(raw);
  const file = name && path.join(mediaDir(floorDir), name);
  let size = -1;
  try {
    if (file && statSync(file).isFile()) size = statSync(file).size;
  } catch {
    // no such file
  }
  if (!file || size < 0) {
    res.writeHead(404, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ error: 'No such media on this floor' }));
  }
  const headers: Record<string, string> = {
    'content-type': TYPES[path.extname(file).toLowerCase()],
    'accept-ranges': 'bytes',
    'cache-control': 'private, max-age=300',
    'x-content-type-options': 'nosniff',
    // Opened on its own (an SVG, say), it still can't run anything on the office's origin.
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    'cross-origin-resource-policy': 'same-origin',
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    end = Math.min(end, size - 1);
    if (!(start >= 0 && start <= end)) {
      res.writeHead(416, { 'content-range': `bytes */${size}` });
      return res.end();
    }
    start = Math.floor(start);
    res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': String(end - start + 1) });
    return createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, 'content-length': String(size) });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}
