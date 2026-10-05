import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ARTBOARD, slugOf } from '../../shared/design-canvas.js';
import { canvasFile } from './files.js';

// A design's artboards as PNGs (POST /api/canvas/export): each rendered by a headless Chromium at its
// own size, scripts off, and saved beside the design as `<design>-<artboard>.png`, so the Board shows
// them and they're ready to post. The browser only gets the design's own files (through the same
// gate as the canvas) and pictures, stylesheets and fonts from the web; nothing from the disk besides.

/** The most artboards one export renders. */
export const MAX_EXPORT = 60;
/** The host the design is loaded from inside the headless browser: never asked of the network. */
const HOST = 'design.local';
const ALLOWED_REMOTE = new Set(['image', 'font', 'stylesheet', 'media']);

export interface Exported {
  /** Each PNG written, as a path relative to the worker's folder. */
  files: string[];
}

/** The PNG names for these artboards: the design's name and each artboard's, made unique. */
export function exportNames(design: string, artboards: string[]): string[] {
  const base = path.basename(design).replace(/\.design\.html$/i, '');
  const seen = new Map<string, number>();
  return artboards.map((name) => {
    const slug = slugOf(name || 'artboard');
    const n = (seen.get(slug) ?? 0) + 1;
    seen.set(slug, n);
    return `${base}-${n > 1 ? `${slug}-${n}` : slug}.png`;
  });
}

/**
 * Renders the artboards of the design at `rel` under `root` (all of them, or those named in `only`)
 * and saves them beside it. What was written, or why it couldn't be.
 */
export async function exportDesign(root: string, rel: string, only?: string[]): Promise<Exported | string> {
  const design = await canvasFile(root, rel);
  if (!design || design.type !== 'text/html') return 'That design is no longer here';
  let chromium: typeof import('playwright-core').chromium;
  try {
    ({ chromium } = await import('playwright-core'));
  } catch {
    return 'Exporting needs playwright-core, which this office was installed without';
  }
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.AGENT_OFFICE_CHROME ? { executablePath: process.env.AGENT_OFFICE_CHROME } : {}) });
  } catch (e) {
    return `Exporting needs a headless Chromium: run npx playwright install chromium on the office's computer (${e instanceof Error ? e.message.split('\n')[0] : 'it would not start'})`;
  }
  try {
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.route('**/*', async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      if (url.hostname === HOST) {
        const asked = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
        const found = await canvasFile(root, asked);
        if (!found) return route.fulfill({ status: 404, body: '' });
        return route.fulfill({ status: 200, contentType: found.type, body: await readFile(found.file) });
      }
      if (url.protocol === 'https:' && req.method() === 'GET' && ALLOWED_REMOTE.has(req.resourceType())) return route.continue();
      if (url.protocol === 'data:') return route.continue();
      return route.abort();
    });
    const where = rel.split('/').map(encodeURIComponent).join('/');
    await page.goto(`http://${HOST}/${where}`, { waitUntil: 'load', timeout: 60_000 });
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
    const boards = page.locator(`[${ARTBOARD}]`);
    const count = Math.min(await boards.count(), MAX_EXPORT);
    if (!count) return 'That design has no artboards: give each one data-artboard="its name"';
    const names: string[] = [];
    for (let i = 0; i < count; i++) names.push((await boards.nth(i).getAttribute(ARTBOARD)) ?? '');
    const widest = Math.max(1600, ...(await Promise.all(names.map((_, i) => boards.nth(i).boundingBox().then((b) => Math.ceil(b?.width ?? 0))))));
    await page.setViewportSize({ width: Math.min(widest, 16000), height: 1200 });
    const files = exportNames(rel, names);
    const dir = path.dirname(design.file);
    const written: string[] = [];
    for (let i = 0; i < count; i++) {
      if (only?.length && !only.includes(names[i])) continue;
      await boards.nth(i).screenshot({ path: path.join(dir, files[i]), animations: 'disabled', timeout: 60_000 });
      written.push(path.join(path.dirname(rel), files[i]));
    }
    return { files: written };
  } catch (e) {
    return `The export stopped: ${e instanceof Error ? e.message.split('\n')[0] : 'unknown error'}`;
  } finally {
    await browser.close().catch(() => {});
  }
}
