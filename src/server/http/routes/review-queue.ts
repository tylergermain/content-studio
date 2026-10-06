import { reviewQueueOf } from '../../review-queue/service.js';
import type { ReviewState } from '../../../shared/review-queue.js';
import { readBody, sameOrigin, send } from '../util.js';
import type { Route } from '../router.js';

// The review queue (server/review-queue/): GET /api/review-queue is every floor's finished tasks and what became of
// them (with `?count` only how many wait, for the menu's badge); POST /api/review-queue/decide approves one, sends it
// notes, dismisses it, or puts it back.

const STATES: readonly ReviewState[] = ['waiting', 'approved', 'notes', 'dismissed'];
const CONTROL = /[\x00-\x1f\x7f]/;

export const reviewQueueRoute = {
  path: ['/api/review-queue', '/api/review-queue/decide'],
  auth: 'session',
  async handle(ctx, { req, res, url, path: p, session }) {
    const queue = reviewQueueOf(ctx);
    if (p === '/api/review-queue') {
      if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
      const view = queue.view();
      return send(res, 200, url.searchParams.has('count') ? { waiting: view.waiting } : view);
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
    if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
    let b: Record<string, unknown>;
    try {
      b = JSON.parse(await readBody(req, 24_000));
    } catch {
      return send(res, 400, { error: 'Invalid request' });
    }
    const id = typeof b.id === 'string' && /^[a-z0-9]{1,40}$/.test(b.id) ? b.id : '';
    const state = STATES.find((s) => s === b.state);
    if (!id || !state) return send(res, 400, { error: 'Say which item and what became of it' });
    const by = session.account?.name ?? (typeof b.by === 'string' && b.by.length <= 40 && !CONTROL.test(b.by) ? b.by : 'Someone');
    const why = await queue.decide(id, state, by, session.account?.id, typeof b.notes === 'string' ? b.notes : undefined);
    return why ? send(res, 400, { error: why }) : send(res, 200, queue.view());
  },
} satisfies Route;
