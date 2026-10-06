import { employeeWorkerError } from '../../org-chart/access.js';
import { cleanSoftwareNotes, softwareReviewText } from '../../../shared/software-review.js';
import { sendable, sendToWorker } from '../../worker-chat/send.js';
import { readBody, sameOrigin, send } from '../util.js';
import { floorParam } from './files.js';
import type { Route } from '../router.js';

// Software review (shared/software-review.ts): POST /api/review/notes?floor&worker sends the comments
// pinned to a worker's running app as one request, written here from what was pinned.

const CONTROL = /[\x00-\x08\x0b-\x1f\x7f]/;

export const reviewRoute = {
  path: '/api/review/notes',
  method: 'POST',
  auth: 'session',
  async handle(ctx, { req, res, url, session }) {
    if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
    const floor = floorParam(ctx, url);
    const id = url.searchParams.get('worker') ?? '';
    if (!floor || !/^[a-zA-Z0-9_-]{1,80}$/.test(id) || !floor.workers.get(id)) return send(res, 404, { error: 'No such worker' });
    const denied = employeeWorkerError(ctx, floor, session.account?.id, id);
    if (denied) return send(res, 403, { error: denied });
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(await readBody(req, 120_000));
    } catch {
      return send(res, 400, { error: 'Invalid request' });
    }
    const notes = cleanSoftwareNotes(body.notes);
    if (typeof notes === 'string') return send(res, 400, { error: notes });
    const app = typeof body.app === 'string' && body.app.length <= 300 && !CONTROL.test(body.app) ? body.app.trim() : '';
    const s = (body.size && typeof body.size === 'object' ? body.size : {}) as Record<string, unknown>;
    const w = Number(s.w), h = Number(s.h);
    if (!app || !(w > 0 && w < 10000 && h > 0 && h < 10000)) return send(res, 400, { error: 'Say which app and what size it was seen at' });
    const label = typeof s.label === 'string' && /^[A-Za-z ]{1,20}$/.test(s.label) ? s.label : undefined;
    const extra = typeof body.text === 'string' && body.text.length <= 4000 && !CONTROL.test(body.text) ? body.text : undefined;
    const requestId = typeof body.requestId === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(body.requestId) ? body.requestId : '';
    if (!requestId) return send(res, 400, { error: 'Invalid message id' });
    const text = softwareReviewText(app, { w: Math.round(w), h: Math.round(h), label }, notes, extra);
    if (!sendable(text)) return send(res, 400, { error: 'These comments come to more than 20,000 characters. Send some of them first.' });
    const sent = sendToWorker(floor, id, text, requestId, session.account?.name ?? 'Studio review');
    return send(res, sent.status, sent.body);
  },
} satisfies Route;
