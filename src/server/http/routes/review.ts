import type http from 'node:http';
import { employeeWorkerError } from '../../org-chart/access.js';
import { cleanSoftwareNotes, softwareReviewText } from '../../../shared/software-review.js';
import { addRound, markDone, nextNumbers, reviewState, setApproved } from '../../review/store.js';
import { sendable, sendToWorker } from '../../worker-chat/send.js';
import { readBody, sameOrigin, send } from '../util.js';
import { floorParam } from './files.js';
import type { Route } from '../router.js';

// Software review (shared/software-review.ts), each ?floor&worker:
//   GET  /api/review/state     the review as kept (server/review/store.ts)
//   POST /api/review/notes     sends the comments pinned to the worker's running app as one request, and keeps them as a round
//   POST /api/review/done      marks a comment done, or not done again
//   POST /api/review/approve   approves the app as it is (telling the worker), or takes it back
// Whoever may direct the worker may review it.

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

export const reviewRoute = {
  prefix: '/api/review/',
  auth: 'session',
  async handle(ctx, { req, res, url, path: p, session }) {
    const action = p.slice('/api/review/'.length);
    if (!['state', 'notes', 'done', 'approve'].includes(action)) return send(res, 404, { error: 'Not found' });
    if ((action === 'state') !== (req.method === 'GET') || (action !== 'state' && req.method !== 'POST')) return send(res, 405, { error: 'Method not allowed' });
    if (action !== 'state' && !sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
    const floor = floorParam(ctx, url);
    const id = url.searchParams.get('worker') ?? '';
    if (!floor || !/^[a-zA-Z0-9_-]{1,80}$/.test(id) || !floor.workers.get(id)) return send(res, 404, { error: 'No such worker' });
    const denied = employeeWorkerError(ctx, floor, session.account?.id, id);
    if (denied) return send(res, 403, { error: denied });
    if (action === 'state') return send(res, 200, { state: reviewState(floor.dir, id) });

    const b = await body(req);
    if (!b) return send(res, 400, { error: 'Invalid request' });
    // On the shared password there's no account: the name they came in with, as the office shows it elsewhere.
    const by = session.account?.name ?? (line(b.by, 40) || 'Studio review');

    if (action === 'done') {
      const commentId = line(b.id, 40);
      const state = commentId ? markDone(floor.dir, id, commentId, b.done !== false, by) : undefined;
      return state ? send(res, 200, { state }) : send(res, 404, { error: 'No such comment' });
    }

    const app = line(b.app, 300);
    if (!app) return send(res, 400, { error: 'Say which app' });
    const requestId = messageId(b.requestId);

    if (action === 'approve') {
      const on = b.on !== false;
      if (on) {
        if (!requestId) return send(res, 400, { error: 'Invalid message id' });
        const sent = sendToWorker(floor, id, `Approved: the app at ${app} is good as it is, so no more changes to it for now.`, requestId, by);
        if (sent.status !== 200) return send(res, sent.status, sent.body);
      }
      return send(res, 200, { ok: true, state: setApproved(floor.dir, id, on, by, app) });
    }

    // notes
    const notes = cleanSoftwareNotes(b.notes);
    if (typeof notes === 'string') return send(res, 400, { error: notes });
    const s = (b.size && typeof b.size === 'object' ? b.size : {}) as Record<string, unknown>;
    const w = Number(s.w), h = Number(s.h);
    if (!(w > 0 && w < 10000 && h > 0 && h < 10000)) return send(res, 400, { error: 'Say what size the app was seen at' });
    const label = typeof s.label === 'string' && /^[A-Za-z ]{1,20}$/.test(s.label) ? s.label : undefined;
    const size = { w: Math.round(w), h: Math.round(h), ...(label ? { label } : {}) };
    const extra = line(b.text, 4000) || undefined;
    if (!requestId) return send(res, 400, { error: 'Invalid message id' });
    const numbers = nextNumbers(reviewState(floor.dir, id), notes.length);
    const text = softwareReviewText(app, size, notes.map((n, i) => ({ ...n, n: numbers[i] })), extra);
    if (!sendable(text)) return send(res, 400, { error: 'These comments come to more than 20,000 characters. Send some of them first.' });
    const sent = sendToWorker(floor, id, text, requestId, by);
    if (sent.status !== 200) return send(res, sent.status, sent.body);
    // A retried Send (the same message id) went the first time, and was kept then.
    const state = 'duplicate' in sent.body && sent.body.duplicate ? reviewState(floor.dir, id) : addRound(floor.dir, id, { at: Date.now(), by, app, size }, notes);
    return send(res, 200, { ...sent.body, state });
  },
} satisfies Route;
