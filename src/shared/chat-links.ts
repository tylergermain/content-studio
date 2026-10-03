import { previewType } from './worker-chat.js';

// The files a worker links in its chat messages, read the same way on both sides. The server reads
// the raw Markdown to find what a worker linked (server/worker-chat/links.ts), and the browser reads
// the href marked wrote for the same link (client/ui/worker-chat/links.ts). Both come down to one
// key, the path as the agent wrote it, so `</a b/x.mp4>`, `/a%20b/x.mp4` and `file:///a b/x.mp4`
// are the same file. A key is only something to look up: the server decides what it may serve.

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const FILE_URL = /^file:(?:\/\/(?:localhost)?)?(?=\/)/i;
const CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * A link target as a path: no <…>, file://, ?query, #fragment or trailing :LINE or :LINE:COL, with
 * %20 and the like decoded. A web, mail or script link (any scheme but file:), a bare #anchor and
 * an empty target all give ''.
 */
export function normalizeTarget(raw: string): string {
  let s = raw.trim();
  if (s.startsWith('<') && s.endsWith('>')) s = s.slice(1, -1).trim();
  if (s.startsWith('#')) return '';
  if (SCHEME.test(s)) {
    const file = FILE_URL.exec(s);
    if (!file) return '';
    s = s.slice(file[0].length);
  }
  // A network path (//host/…, or file://host/…) is not a file on this machine.
  if (s.startsWith('//')) return '';
  s = s.replace(/[?#][\s\S]*$/, '');
  try { s = decodeURI(s); } catch { /* A stray %, as in 50%off.png: keep it as written. */ }
  s = s.replace(/:\d+(?::\d+)?$/, '').trim();
  return CONTROL.test(s) ? '' : s;
}

// A Markdown destination as the page reads it back: backslash escapes and the common character
// references undone, in one pass as CommonMark does, so an escaped `\&amp;` is not a reference.
const ESCAPE = /\\([!-\/:-@[-`{-~])|&(?:(amp|lt|gt|quot|apos)|#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6}));/g;
const NAMED: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function destination(raw: string): string {
  return raw.replace(ESCAPE, (all, char?: string, name?: string, dec?: string, hex?: string) => {
    if (char) return char;
    if (name) return NAMED[name];
    const code = dec ? Number(dec) : parseInt(hex ?? '', 16);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all;
  });
}

/** The text with fenced code blocks blanked line for line, since nothing in them is a link. */
function unfenced(markdown: string): string {
  let open = '';
  return markdown.split(/\r?\n/).map(line => {
    const fence = /^[ \t>]*(`{3,}|~{3,})(.*)$/.exec(line);
    if (open) {
      if (fence && fence[1][0] === open[0] && fence[1].length >= open.length && !fence[2].trim()) open = '';
      return '';
    }
    // A run of backticks with another backtick after it on the line is inline code, not a fence.
    if (fence && !(fence[1][0] === '`' && fence[2].includes('`'))) { open = fence[1]; return ''; }
    return line;
  }).join('\n');
}

// In one left-to-right pass, so a link written inside inline code is not a link:
// 1. a single-backtick code span;
// 2. a link or image, `[text](dest)` or `[text](<dest>)`, whose text may hold one level of [ ], as
//    in a linked thumbnail `[![thumb](a.png)](b.mp4)`, and whose destination may hold escaped \( \)
//    and one level of ( ), as in `a(1).png`;
// 3. a reference definition, `[name]: dest` (not a `[^1]:` footnote).
const TOKEN = /(?<!`)`([^`\n]+)`(?!`)|!?\[((?:[^[\]\n]|\[[^[\]\n]*\])*)\]\(\s*(<(?:[^<>\n\\]|\\.)+>|(?:\\[()]|[^()\s]|\((?:[^()\s])*\))+)|^[ \t]{0,3}\[(?!\^)[^\]\n]+\]:[ \t]*(<(?:[^<>\n\\]|\\.)+>|\S+)/gm;
const MAX_TARGETS = 50;

/**
 * The files a message links, as `normalizeTarget` keys in the order written, each once and at most
 * 50: link, image and reference destinations, and inline code spans that name a previewable file
 * (`renders/cut-v02.mp4`). Code blocks and web links are left out.
 */
export function linkTargets(markdown: string): string[] {
  const found = new Set<string>();
  const add = (key: string) => { if (key && found.size < MAX_TARGETS) found.add(key); };
  const scan = (text: string, depth: number) => {
    for (const m of text.matchAll(TOKEN)) {
      if (found.size >= MAX_TARGETS) return;
      if (m[1] !== undefined) { const key = normalizeTarget(m[1]); if (previewType(key)) add(key); continue; }
      if (m[2] && depth === 0) scan(m[2], 1);
      add(normalizeTarget(destination(m[3] ?? m[4] ?? '')));
    }
  };
  scan(unfenced(markdown), 0);
  return [...found];
}
