import { existsSync } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { employeeWorkerError } from '../../org-chart/access.js';
import { ASSET_POLICY, DESIGN_POLICY, isDesignFile } from '../../../shared/design-canvas.js';
import { canvasFile } from '../../canvas/files.js';
import { exportDesign } from '../../canvas/export.js';
import { importPaperPage, listPaperFiles, paperInstalled } from '../../canvas/paper.js';
import { defaultRoot } from '../../worker-chat/links.js';
import { readBody, sameOrigin, send } from '../util.js';
import type { Route } from '../router.js';
import type { Floor } from '../../floor.js';
import type { Ctx } from '../../office/context.js';

// The design canvas's side of the office (client/ui/workspace/canvas.ts, shared/design-canvas.ts):
//
//   GET  /api/canvas/doc/<floor>/<worker>/<path>  a design, or a file it loads, from the worker's folder.
//        A path of its own (not ?path=) so a design's relative links (.assets/hero.jpg) resolve.
//   GET  /api/canvas/stat?floor&worker&path        a design's size and time, which the canvas polls to show changes live.
//   POST /api/canvas/export?floor&worker           { path, only? }: its artboards as PNGs beside it.
//   GET  /api/canvas/paper?floor&worker            admins: whether Paper is here, and its files.
//   POST /api/canvas/paper?floor&worker            admins: { fileId, pageId? }: a page of a Paper file as a design in the worker's folder.

const WORKER = /^[a-zA-Z0-9_-]{1,80}$/;
/** The biggest file the canvas serves. */
const MAX_SERVE = 200 * 1024 * 1024;

function workerOf(ctx: Ctx, floorId: string | null, id: string | null): { floor: Floor; id: string } | undefined {
  const floor = ctx.floors.get(floorId ?? '');
  if (!floor || !id || !WORKER.test(id) || !floor.workers.get(id)) return undefined;
  return { floor, id };
}

/** Where an import from Paper goes in a worker's folder: under outputs/designs when there's an outputs folder, else designs. */
const importDir = (root: string) => (existsSync(path.join(root, 'outputs')) ? path.join('outputs', 'designs') : 'designs');

export const canvasRoute = {
  prefix: '/api/canvas/',
  auth: 'session',
  async handle(ctx, { req, res, url, path: p, session }) {
    if (p.startsWith('/api/canvas/doc/') && req.method === 'GET') {
      const [floorId, id, ...rest] = p.slice('/api/canvas/doc/'.length).split('/');
      let rel: string;
      try {
        rel = rest.map((s) => decodeURIComponent(s)).join('/');
      } catch {
        return send(res, 400, { error: 'Bad path' });
      }
      const w = workerOf(ctx, decodeURIComponent(floorId ?? ''), decodeURIComponent(id ?? ''));
      if (!w) return send(res, 404, { error: 'No such worker' });
      const found = await canvasFile(defaultRoot(w.floor, w.id), rel);
      const fd = found && (await open(found.file, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => undefined));
      if (!found || !fd) return send(res, 404, { error: 'No such file' });
      const s = await fd.stat();
      if (!s.isFile() || s.size > MAX_SERVE) {
        await fd.close();
        return send(res, 413, { error: 'File is too large' });
      }
      const design = isDesignFile(rel);
      res.writeHead(200, {
        'content-type': design ? 'text/html; charset=utf-8' : found.type,
        'content-length': String(s.size),
        'cache-control': design ? 'no-store' : 'private, max-age=60',
        'x-content-type-options': 'nosniff',
        'content-security-policy': design ? DESIGN_POLICY : ASSET_POLICY,
        'cross-origin-resource-policy': 'same-origin',
        'referrer-policy': 'no-referrer',
      });
      if (!s.size) {
        await fd.close();
        return res.end();
      }
      const stream = fd.createReadStream({ autoClose: true });
      res.on('close', () => stream.destroy());
      stream.on('error', () => res.destroy());
      stream.pipe(res);
      return;
    }

    const w = workerOf(ctx, url.searchParams.get('floor'), url.searchParams.get('worker'));
    if (!w) return send(res, 404, { error: 'No such worker' });
    const root = defaultRoot(w.floor, w.id);
    const admin = ctx.meOf(session.account?.id).admin;

    if (p === '/api/canvas/stat' && req.method === 'GET') {
      const found = await canvasFile(root, url.searchParams.get('path') ?? '');
      if (!found) return send(res, 404, { error: 'No such design' });
      const s = await stat(found.file);
      return send(res, 200, { size: s.size, modified: s.mtimeMs });
    }

    if (p === '/api/canvas/paper' && req.method === 'GET') {
      if (!admin) return send(res, 403, { error: 'Only an admin can bring designs in from Paper' });
      if (!paperInstalled()) return send(res, 200, { installed: false, files: [] });
      try {
        return send(res, 200, { installed: true, files: await listPaperFiles() });
      } catch (e) {
        return send(res, 502, { error: `Paper didn\u2019t answer: ${e instanceof Error ? e.message : 'unknown error'}. Is Paper Desktop open and signed in?` });
      }
    }

    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
    if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
    const denied = employeeWorkerError(ctx, w.floor, session.account?.id, w.id);
    if (denied) return send(res, 403, { error: denied });
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(await readBody(req, 8192));
    } catch {
      return send(res, 400, { error: 'Invalid request' });
    }

    if (p === '/api/canvas/export') {
      const rel = typeof body.path === 'string' ? body.path : '';
      if (!isDesignFile(rel)) return send(res, 400, { error: 'Choose a design to export' });
      const only = Array.isArray(body.only) ? body.only.filter((n): n is string => typeof n === 'string').slice(0, 60) : undefined;
      const done = await exportDesign(root, rel, only);
      return typeof done === 'string' ? send(res, 500, { error: done }) : send(res, 200, done);
    }

    if (p === '/api/canvas/paper') {
      if (!admin) return send(res, 403, { error: 'Only an admin can bring designs in from Paper' });
      const fileId = typeof body.fileId === 'string' && /^[A-Za-z0-9_-]{4,64}$/.test(body.fileId) ? body.fileId : undefined;
      const pageId = typeof body.pageId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(body.pageId) ? body.pageId : undefined;
      if (!fileId) return send(res, 400, { error: 'Choose a Paper file' });
      if (!paperInstalled()) return send(res, 400, { error: 'Paper Desktop isn\u2019t installed on the office\u2019s computer' });
      const done = await importPaperPage(root, importDir(root), fileId, pageId);
      if (typeof done === 'string') return send(res, 502, { error: done });
      ctx.toastFloor(w.floor, `${session.account?.name ?? 'Someone'} brought a design in from Paper for ${w.floor.workers.get(w.id)?.name ?? 'a worker'}`);
      return send(res, 200, done);
    }

    return send(res, 404, { error: 'Not found' });
  },
} satisfies Route;
