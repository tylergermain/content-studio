import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { ARTBOARD, DESIGN_SUFFIX, slugOf } from '../../shared/design-canvas.js';
import { ASSETS_DIR } from './files.js';
import { fontsIn, parseJsx, toHtml, urlsIn } from './jsx.js';

// Paper (paper.design) to the design canvas, through Paper's own agent connection: the `paper mcp`
// command that comes with Paper Desktop, which the office speaks MCP to over stdio like any agent.
// It lists the Paper files, and imports a page of one: each artboard's JSX (inline styles) becomes an
// artboard of a design file, the pictures it uses are copied beside it, and the fonts it asks for come
// from Google Fonts. Every call counts against the Paper plan's agent allowance, so an import makes
// one call for the page and one per artboard, and nothing else.

/** Where Paper Desktop puts its command, unless AGENT_OFFICE_PAPER says otherwise. */
export const paperBin = () => process.env.AGENT_OFFICE_PAPER ?? path.join(homedir(), '.paper', 'bin', 'paper');
/** The most artboards one import takes, the most one picture may weigh, and all of them together. */
export const IMPORT_LIMITS = { artboards: 60, picture: 40 * 1024 * 1024, pictures: 400 * 1024 * 1024 } as const;
const CALL_MS = 90_000;
/** Pictures in a Paper file: copied beside the design, as Paper serves them to anyone with the link. */
const PAPER_ASSET = /^https:\/\/app\.paper\.design\/file-assets\/[A-Za-z0-9]+\/([A-Za-z0-9_-]+\.(?:png|jpe?g|webp|gif|svg|avif))$/;
/** System and generic families that aren't Google Fonts. */
const NOT_GOOGLE = /^(system-ui|-apple-system|blinkmacsystemfont|ui-[a-z-]+|sans-serif|serif|monospace|cursive|fantasy|helvetica( neue)?|arial|times( new roman)?|georgia|courier( new)?|verdana|tahoma|menlo|monaco|sf pro.*|sf mono|new york)$/i;

export interface PaperFile {
  id: string;
  name: string;
  updatedAt?: number;
  open?: boolean;
  active?: boolean;
}

interface Artboard {
  id: string;
  name: string;
  width: number | null;
  height: number | null;
  worldX: number | null;
  worldY: number | null;
}

/** One conversation with `paper mcp`: started, initialized, asked tool calls in turn, closed. */
export class PaperSession {
  private proc: ChildProcessWithoutNullStreams;
  private buffer = '';
  private next = 1;
  private waiting = new Map<number, (msg: any) => void>();
  private ready: Promise<void>;

  constructor(bin = paperBin()) {
    this.proc = spawn(bin, ['mcp'], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk: string) => {
      this.buffer += chunk;
      let nl: number;
      while ((nl = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, nl).trim();
        this.buffer = this.buffer.slice(nl + 1);
        if (!line) continue;
        let msg: any;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        const done = typeof msg.id === 'number' ? this.waiting.get(msg.id) : undefined;
        if (done) {
          this.waiting.delete(msg.id);
          done(msg);
        }
      }
    });
    this.proc.stderr.resume();
    const gone = (why: string) => {
      for (const done of this.waiting.values()) done({ error: { message: why } });
      this.waiting.clear();
    };
    this.proc.on('error', (e) => gone(e.message));
    this.proc.on('exit', () => gone('Paper\u2019s agent connection closed'));
    this.ready = this.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'agent-office', version: '1' } }).then(() => {
      this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    });
  }

  private request(method: string, params: unknown): Promise<any> {
    const id = this.next++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new Error(`Paper took too long to answer ${method}`));
      }, CALL_MS);
      this.waiting.set(id, (msg) => {
        clearTimeout(timer);
        if (msg.error) reject(new Error(msg.error.message ?? 'Paper said no'));
        else resolve(msg.result);
      });
      this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  /** A tool's answer: the text parts after the file header Paper puts first (see get_basic_info). */
  async tool(name: string, args: Record<string, unknown>): Promise<string[]> {
    await this.ready;
    const result = await this.request('tools/call', { name, arguments: args });
    const texts = (Array.isArray(result?.content) ? result.content : []).filter((c: any) => c?.type === 'text').map((c: any) => String(c.text));
    if (result?.isError) throw new Error(texts.join(' ').slice(0, 300) || `Paper couldn\u2019t ${name.replace(/_/g, ' ')}`);
    return texts;
  }

  close() {
    this.proc.stdin.end();
    setTimeout(() => this.proc.kill(), 2000).unref();
  }
}

/** The JSON in a tool's answer: the part that isn't the file header. */
function body(texts: string[]): any {
  for (const t of [...texts].reverse()) {
    try {
      const v = JSON.parse(t);
      if (!(v && typeof v === 'object' && 'contentHash' in v && Object.keys(v).length <= 2)) return v;
    } catch {
      /* not JSON */
    }
  }
  return undefined;
}

/** Whether Paper's command is on this computer. */
export const paperInstalled = () => existsSync(paperBin());

/** The files in the Paper team: the ones open in Paper Desktop first, then the recent ones. */
export async function listPaperFiles(session = new PaperSession()): Promise<PaperFile[]> {
  try {
    const v = body(await session.tool('list_files', {}));
    const files: unknown[] = Array.isArray(v?.files) ? v.files : [];
    return files
      .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object' && typeof (f as any).id === 'string' && typeof (f as any).name === 'string')
      .map((f) => ({ id: String(f.id), name: String(f.name).slice(0, 200), ...(typeof f.updatedAt === 'number' ? { updatedAt: f.updatedAt } : {}), ...(f.open ? { open: true } : {}), ...(f.active ? { active: true } : {}) }));
  } finally {
    session.close();
  }
}

/**
 * Families whose Google Fonts version has an optical size axis, with its range: a design tool draws
 * their big type with the tighter display cut, so the design asks for the axis too (see fontLinks).
 */
const OPTICAL: Readonly<Record<string, string>> = { Inter: '14..32', 'Roboto Flex': '8..144', Fraunces: '9..144', Literata: '7..72', Newsreader: '6..72', 'Bodoni Moda': '6..96', 'Source Serif 4': '8..60', Piazzolla: '8..30' };

/**
 * A Google Fonts stylesheet for each family the design asks for, at the weights it uses: one link
 * each, so one missing weight doesn't lose the rest. A family with an optical size axis gets a second
 * link with it, after the first, so its display cut is used at large sizes where it loads.
 */
export function fontLinks(fonts: Map<string, Set<number>>): string[] {
  const links: string[] = [];
  for (const [family, weights] of fonts) {
    if (NOT_GOOGLE.test(family) || !/^[\w .-]{1,60}$/.test(family)) continue;
    const name = encodeURIComponent(family).replace(/%20/g, '+');
    for (const w of [...weights].sort((a, b) => a - b)) {
      const weight = Math.round(Math.min(1000, Math.max(1, w)));
      links.push(`https://fonts.googleapis.com/css2?family=${name}:wght@${weight}&display=swap`);
      if (OPTICAL[family]) links.push(`https://fonts.googleapis.com/css2?family=${name}:opsz,wght@${OPTICAL[family]},${weight}&display=swap`);
    }
  }
  return [...new Set(links)];
}

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export interface Imported {
  /** The design file, relative to the folder it was imported into. */
  path: string;
  artboards: number;
  pictures: number;
  /** What couldn't come across, said plainly. */
  notes: string[];
}

/**
 * Imports one page of a Paper file (the one it's on, unless `pageId` says) into `root`, as
 * `<dir>/<name>/<name>.design.html` with its pictures in `.assets` beside it. `dir` is relative to root.
 */
export async function importPaperPage(root: string, dir: string, fileId: string, pageId?: string, session = new PaperSession()): Promise<Imported | string> {
  try {
    const info = body(await session.tool('get_basic_info', { fileId, ...(pageId ? { pageId } : {}) }));
    const boards: Artboard[] = (Array.isArray(info?.artboards) ? info.artboards : []).filter((a: any) => a && typeof a.id === 'string');
    if (!boards.length) return 'That page has no artboards to bring across';
    const notes: string[] = [];
    if (boards.length > IMPORT_LIMITS.artboards) notes.push(`Only the first ${IMPORT_LIMITS.artboards} of ${boards.length} artboards came across`);
    const title = String(info?.pageName && info.pageName !== 'Page 1' ? `${info.fileName} \u00b7 ${info.pageName}` : (info?.fileName ?? 'Paper design'));
    const slug = slugOf(String(info?.fileName ?? 'paper-design'));
    // A new folder each time, so an import never writes over one made before.
    let folder = path.join(dir, slug);
    for (let n = 2; existsSync(path.join(root, folder)); n++) folder = path.join(dir, `${slug}-${n}`);
    const assets = path.join(root, folder, ASSETS_DIR);
    await mkdir(assets, { recursive: true });

    const parsed: { board: Artboard; el: ReturnType<typeof parseJsx> }[] = [];
    for (const board of boards.slice(0, IMPORT_LIMITS.artboards)) {
      const texts = await session.tool('get_jsx', { fileId, nodeId: board.id, format: 'inline-styles' });
      const jsx = texts.find((t) => t.trimStart().startsWith('(') || t.trimStart().startsWith('<'));
      if (!jsx) {
        notes.push(`${board.name} had no code to bring across`);
        continue;
      }
      try {
        parsed.push({ board, el: parseJsx(jsx) });
      } catch (e) {
        notes.push(`${board.name} couldn\u2019t be read (${e instanceof Error ? e.message : 'unknown'})`);
      }
    }
    if (!parsed.length) return notes[0] ?? 'Nothing came across';

    // Its pictures, each once, under the name Paper gave it.
    const local = new Map<string, string>();
    let total = 0;
    const urls = new Set<string>();
    for (const { el } of parsed) urlsIn(el, urls);
    for (const url of urls) {
      const m = PAPER_ASSET.exec(url);
      if (!m) continue;
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
        const size = Number(res.headers.get('content-length') ?? 0);
        if (!res.ok || size > IMPORT_LIMITS.picture || total + size > IMPORT_LIMITS.pictures) {
          notes.push(`A picture stayed on Paper\u2019s servers (${res.ok ? 'too big to copy' : `it answered ${res.status}`})`);
          continue;
        }
        const bytes = Buffer.from(await res.arrayBuffer());
        total += bytes.length;
        await writeFile(path.join(assets, m[1]), bytes);
        local.set(url, `${ASSETS_DIR}/${m[1]}`);
      } catch {
        notes.push('A picture couldn\u2019t be copied, so it still loads from Paper');
      }
    }

    const fonts = new Map<string, Set<number>>();
    for (const { el } of parsed) fontsIn(el, fonts);
    const sections = parsed.map(({ board, el }) =>
      toHtml(el, {
        url: (u) => local.get(u) ?? u,
        root: {
          attrs: [[ARTBOARD, board.name], ...(board.worldX !== null && board.worldY !== null ? ([['data-x', String(Math.round(board.worldX))], ['data-y', String(Math.round(board.worldY))]] as [string, string][]) : [])],
          style: { ...(board.width ? { width: `${board.width}px` } : {}), ...(board.height ? { height: `${board.height}px` } : {}) },
        },
      }),
    );
    const html = [
      '<!doctype html>',
      '<html lang="en">',
      '<head>',
      '<meta charset="utf-8">',
      `<title>${escapeAttr(title)}</title>`,
      `<meta name="generator" content="${escapeAttr(`Imported from Paper: ${title}`)}">`,
      ...fontLinks(fonts).map((href) => `<link rel="stylesheet" href="${escapeAttr(href)}">`),
      '<style>body { margin: 0; } [data-artboard] { flex: none; }</style>',
      '</head>',
      '<body>',
      ...sections,
      '</body>',
      '</html>',
      '',
    ].join('\n');
    const file = path.join(folder, `${slug}${DESIGN_SUFFIX}`);
    const tmp = path.join(root, `${file}.tmp`);
    await writeFile(tmp, html);
    await rename(tmp, path.join(root, file));
    return { path: file, artboards: parsed.length, pictures: local.size, notes };
  } catch (e) {
    return e instanceof Error ? e.message : 'The import stopped';
  } finally {
    session.close();
  }
}
