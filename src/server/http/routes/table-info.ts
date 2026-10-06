import type http from 'node:http';
import { BRANCH_NAME, runBranchTask } from '../../../shared/table-info.js';
import { floorAccessError } from '../../org-chart/access.js';
import { hireAtTable, startAppTask } from '../../review/tables.js';
import { branchDetail, hasBranch, tableInfo } from '../../table-info.js';
import { deploysOf } from '../../deploys.js';
import { layoutFurniture } from '../../../shared/office-builder.js';
import { VERCEL_PROJECT } from '../../../shared/project-rooms.js';
import { readBody, sameOrigin, send } from '../util.js';
import { floorParam } from './files.js';
import type { Route } from '../router.js';

// A project table's panel (server/table-info.ts), each ?floor&room (the project room's id):
//   GET  /api/table-info          its branches, who's on each and what's running there, its pull requests, issues and latest commits
//   GET  /api/table-info/branch   &branch: a branch close up, its commits and changed files
//   POST /api/table-info/run      { branch, requestId }: hires a new agent at the table to run that branch's app
//   POST /api/table-info/vercel   { token }: signs the office in to Vercel (admins; '' signs it out), see server/deploys.ts
//   POST /api/table-info/vercel-project   { project }: the Vercel project the table's deploys come from (admins; '' is its repository's)
// Anyone signed in may look; running a branch is hiring, which is up to the floor's hiring rules.

const ROOM = /^[A-Za-z0-9_-]{1,64}$/;
const NAME = /^[^\x00-\x1f\x7f]{1,40}$/;
const messageId = (v: unknown) => (typeof v === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(v) ? v : '');

async function body(req: http.IncomingMessage): Promise<Record<string, unknown> | undefined> {
  try {
    const v = JSON.parse(await readBody(req, 10_000));
    return v && typeof v === 'object' ? v : undefined;
  } catch {
    return undefined;
  }
}

export const tableInfoRoute = {
  path: ['/api/table-info', '/api/table-info/branch', '/api/table-info/run', '/api/table-info/vercel', '/api/table-info/vercel-project'],
  auth: 'session',
  async handle(ctx, { req, res, url, path: p, session }) {
    const floor = floorParam(ctx, url);
    const room = url.searchParams.get('room') ?? '';
    if (!floor || !ROOM.test(room)) return send(res, 404, { error: 'No such table' });
    const admin = ctx.meOf(session.account?.id).admin;
    if (p === '/api/table-info/vercel' || p === '/api/table-info/vercel-project') {
      if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
      if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
      if (!admin) return send(res, 403, { error: 'Only an admin connects the office to Vercel' });
      const b = await body(req);
      const deploys = deploysOf(ctx.cfg.dataDir);
      if (p === '/api/table-info/vercel') {
        const done = await deploys.connect(typeof b?.token === 'string' ? b.token : '');
        return typeof done === 'string' ? send(res, 400, { error: done }) : send(res, 200, { vercel: deploys.status() });
      }
      const name = typeof b?.project === 'string' ? b.project.trim() : '';
      if (name && !VERCEL_PROJECT.test(name)) return send(res, 400, { error: 'That isn’t a Vercel project name' });
      const piece = layoutFurniture(floor.plan.state()).find((x) => x.id === room && x.kind === 'project-room');
      if (!piece) return send(res, 404, { error: 'No such table' });
      const { vercel: _was, ...rest } = piece.project ?? {};
      const r = floor.plan.setRoom(room, { project: { ...rest, ...(name ? { vercel: name } : {}) } });
      if (typeof r === 'string') return send(res, 409, { error: r });
      ctx.toFloor(floor, { t: 'plan', plan: floor.plan.state() });
      return send(res, 200, { ok: true });
    }
    if (p === '/api/table-info/run') {
      if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
      if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
      const readOnly = floorAccessError(ctx, floor, session.account?.id);
      if (readOnly) return send(res, 403, { error: readOnly });
      const b = await body(req);
      const branch = typeof b?.branch === 'string' && BRANCH_NAME.test(b.branch) ? b.branch : '';
      const requestId = messageId(b?.requestId);
      if (!branch || !requestId) return send(res, 400, { error: 'Invalid request' });
      const known = await hasBranch(floor, room, branch);
      if (!known) return send(res, 404, { error: 'There is no such branch' });
      const by = session.account?.name ?? (typeof b?.by === 'string' && NAME.test(b.by.trim()) ? b.by.trim() : 'Someone');
      const task = known.base ? startAppTask(known.table) : runBranchTask(known.table, branch);
      const hired = await hireAtTable(ctx, floor, room, task, by, session.account?.id, requestId);
      return typeof hired === 'string' ? send(res, 409, { error: hired }) : send(res, 200, { hired: { id: hired.id, name: hired.name } });
    }
    if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
    if (p === '/api/table-info/branch') {
      const branch = url.searchParams.get('branch') ?? '';
      if (!BRANCH_NAME.test(branch)) return send(res, 400, { error: 'Say which branch' });
      const detail = await branchDetail(floor, room, branch).catch((e: Error) => `git couldn't read it: ${e.message}`);
      return typeof detail === 'string' ? send(res, 404, { error: detail }) : send(res, 200, detail);
    }
    const info = tableInfo(ctx, floor, room);
    if (!info) return send(res, 404, { error: 'No such table' });
    const out = await info;
    // The Vercel projects to pick the table's from: for an admin only.
    if (admin && out.vercel.connected) return send(res, 200, { ...out, vercel: { ...out.vercel, projects: await deploysOf(ctx.cfg.dataDir).names() } });
    return send(res, 200, out);
  },
} satisfies Route;
