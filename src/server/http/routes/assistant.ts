import { assistantOf } from '../../assistant/runner.js';
import { readBody, sameOrigin, send } from '../util.js';
import type { Route } from '../router.js';

// The executive assistant (server/assistant/): GET /api/assistant is the conversation, what it's doing and the plans'
// usage; POST /api/assistant/ask asks it something; POST /api/assistant/reset starts a new conversation. Only admins:
// it acts on every agent on every floor.

const CONTROL = /[\x00-\x08\x0b-\x1f\x7f]/;

export const assistantRoute = {
  path: ['/api/assistant', '/api/assistant/ask', '/api/assistant/reset'],
  auth: 'session',
  async handle(ctx, { req, res, path: p, session }) {
    if (!ctx.meOf(session.account?.id).admin) return send(res, 403, { error: 'Only an admin has the assistant' });
    const a = assistantOf(ctx);
    if (p === '/api/assistant') return req.method === 'GET' ? send(res, 200, await a.view()) : send(res, 405, { error: 'Method not allowed' });
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
    if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
    if (p === '/api/assistant/reset') {
      a.reset();
      return send(res, 200, await a.view());
    }
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(await readBody(req, 40_000));
    } catch {
      return send(res, 400, { error: 'Invalid request' });
    }
    const text = typeof body.text === 'string' ? body.text.replace(/\r\n?/g, '\n').trim() : '';
    if (!text || text.length > 8000 || CONTROL.test(text.replace(/[\n\t]/g, ''))) return send(res, 400, { error: 'Ask in up to 8,000 characters' });
    const by = session.account?.name ?? (typeof body.by === 'string' && body.by.length <= 40 && !CONTROL.test(body.by) ? body.by : 'Someone');
    a.ask(text, by);
    return send(res, 200, await a.view());
  },
} satisfies Route;
