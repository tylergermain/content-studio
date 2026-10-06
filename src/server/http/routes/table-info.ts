import type http from 'node:http';
import { BRANCH_NAME, runBranchTask } from '../../../shared/table-info.js';
import { floorAccessError } from '../../org-chart/access.js';
import { hireAtTable, startAppTask } from '../../review/tables.js';
import { branchDetail, hasBranch, tableInfo } from '../../table-info.js';
import { readBody, sameOrigin, send } from '../util.js';
import { floorParam } from './files.js';
import type { Route } from '../router.js';

// A project table's panel (server/table-info.ts), each ?floor&room (the project room's id):
//   GET  /api/table-info          its branches, who's on each and what's running there, its pull requests, issues and latest commits
//   GET  /api/table-info/branch   &branch: a branch close up, its commits and changed files
//   POST /api/table-info/run      { branch, requestId }: hires a new agent at the table to run that branch's app
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
  path: ['/api/table-info', '/api/table-info/branch', '/api/table-info/run'],
  auth: 'session',
  async handle(ctx, { req, res, url, path: p, session }) {
    const floor = floorParam(ctx, url);
    const room = url.searchParams.get('room') ?? '';
    if (!floor || !ROOM.test(room)) return send(res, 404, { error: 'No such table' });
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
    return send(res, 200, await info);
  },
} satisfies Route;
