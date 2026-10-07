import type http from 'node:http';
import { layoutFurniture } from '../../../shared/office-builder.js';
import { cleanSoftwareNotes, softwareReviewText } from '../../../shared/software-review.js';
import { addRound, markDone, nextNumbers, reviewState } from '../../review/store.js';
import { hireAtTable, startAppTask, tableKey } from '../../review/tables.js';
import { sendable } from '../../worker-chat/send.js';
import { readBody, sameOrigin, send } from '../util.js';
import { floorParam } from './files.js';
import type { Route } from '../router.js';
import { floorAccessError } from '../../org-chart/access.js';

// Software review of a project table's app (shared/software-review.ts), each ?floor&room (the project room's id):
//   GET  /api/table-review/state   the review as kept (server/review/store.ts, under tableKey)
//   POST /api/table-review/notes   hires a new agent at the table to do the comments, and keeps them as a round
//   POST /api/table-review/done    marks a comment done, or not done again
//   POST /api/table-review/start   hires a new agent at the table to get its app running
// Anyone signed in may read one; sending or starting is hiring, which is up to the floor's hiring rules.

const CONTROL = /[\x00-\x08\x0b-\x1f\x7f]/;
const line = (v: unknown, max: number) => (typeof v === 'string' && v.length <= max && !CONTROL.test(v) ? v.trim() : '');
const messageId = (v: unknown) => (typeof v === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(v) ? v : '');

async function body(req: http.IncomingMessage): Promise<Record<string, unknown> | undefined> {
  try {
    const v = JSON.parse(await readBody(req, 120_000));
    return v && typeof v === 'object' ? v : undefined;
  } catch {
    return undefined;
  }
}

export const tableReviewRoute = {
  prefix: '/api/table-review/',
  auth: 'session',
  async handle(ctx, { req, res, url, path: p, session }) {
    const action = p.slice('/api/table-review/'.length);
    if (!['state', 'notes', 'done', 'start'].includes(action)) return send(res, 404, { error: 'Not found' });
    if (action === 'state' ? req.method !== 'GET' : req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
    if (req.method === 'POST' && !sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
    const floor = floorParam(ctx, url);
    const room = url.searchParams.get('room') ?? '';
    const table = floor && /^[A-Za-z0-9_-]{1,64}$/.test(room) ? layoutFurniture(floor.plan.state()).find((x) => x.id === room && x.kind === 'project-room') : undefined;
    if (!floor || !table) return send(res, 404, { error: 'No such table' });
    const key = tableKey(room);
    if (action === 'state') return send(res, 200, { state: reviewState(floor.dir, key) });

    const readOnly = floorAccessError(ctx, floor, session.account?.id);
    if (readOnly) return send(res, 403, { error: readOnly });
    const b = await body(req);
    if (!b) return send(res, 400, { error: 'Invalid request' });
    const by = session.account?.name ?? (line(b.by, 40) || 'Studio review');
    const requestId = messageId(b.requestId);
    const name = table.text || 'this table';

    if (action === 'done') {
      const id = line(b.id, 40);
      const state = id ? markDone(floor.dir, key, id, b.done !== false, by) : undefined;
      return state ? send(res, 200, { state }) : send(res, 404, { error: 'No such comment' });
    }
    if (!requestId) return send(res, 400, { error: 'Invalid message id' });
    if (action === 'start') {
      const hired = await hireAtTable(ctx, floor, room, startAppTask(name), by, session.account?.id, requestId);
      return typeof hired === 'string' ? send(res, 409, { error: hired }) : send(res, 200, { state: reviewState(floor.dir, key), hired: { id: hired.id, name: hired.name } });
    }

    // notes
    const app = line(b.app, 300);
    if (!app) return send(res, 400, { error: 'Say which app' });
    const notes = cleanSoftwareNotes(b.notes);
    if (typeof notes === 'string') return send(res, 400, { error: notes });
    const s = (b.size && typeof b.size === 'object' ? b.size : {}) as Record<string, unknown>;
    const w = Number(s.w), h = Number(s.h);
    if (!(w > 0 && w < 10000 && h > 0 && h < 10000)) return send(res, 400, { error: 'Say what size the app was seen at' });
    const label = typeof s.label === 'string' && /^[A-Za-z ]{1,20}$/.test(s.label) ? s.label : undefined;
    const size = { w: Math.round(w), h: Math.round(h), ...(label ? { label } : {}) };
    const numbers = nextNumbers(reviewState(floor.dir, key), notes.length);
    const text = softwareReviewText(app, size, notes.map((n, i) => ({ ...n, n: numbers[i] })), line(b.text, 4000) || undefined, true);
    if (!sendable(text)) return send(res, 400, { error: 'These comments come to more than 20,000 characters. Send some of them first.' });
    const hired = await hireAtTable(ctx, floor, room, text, by, session.account?.id, requestId);
    if (typeof hired === 'string') return send(res, 409, { error: hired });
    const state = addRound(floor.dir, key, { at: Date.now(), by, app, size, to: hired.name }, notes);
    return send(res, 200, { state, hired: { id: hired.id, name: hired.name } });
  },
} satisfies Route;
