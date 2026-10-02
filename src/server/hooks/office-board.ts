import type http from 'node:http';
import { STUDIO_BOARDS, boardNamed } from '../../shared/studio.js';
import type { Ctx } from '../office/context.js';
import { readBody, send } from '../http/util.js';

/**
 * A floor's own bulletin boards, for any worker on it (see shared/studio.ts, and bin/office-board.js,
 * the command that calls this): GET lists the boards and their posts, POST puts a post up, DELETE
 * with ?post= takes one down. The worker's own hook token says who's asking, and the floor sees who posted.
 */
export async function officeBoard(ctx: Ctx, req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const workerId = url.searchParams.get('worker') ?? '';
  const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const floor = ctx.workerFloor(workerId);
  const me = floor?.workers.authenticate(workerId, token);
  if (!floor || !me) return send(res, 401, { error: 'Send your own AGENT_OFFICE_WORKER_ID as ?worker= and AGENT_OFFICE_HOOK_TOKEN as the bearer token' });
  const told = () => ctx.toFloor(floor, { t: 'studio', studio: floor.studio.state() });
  const { setup, posts } = floor.studio.state();
  if (req.method === 'GET') {
    const only = url.searchParams.get('board');
    const want = only ? boardNamed(setup, only) : undefined;
    if (only && !want) return send(res, 404, { error: `This floor has no board called "${only}"` });
    return send(res, 200, {
      floor: floor.def.name,
      boards: STUDIO_BOARDS.filter((b) => setup.boards[b] && (!want || b === want)).map((b) => ({ title: setup.boards[b]!.title, about: setup.boards[b]!.about, filled: !!setup.boards[b]!.feed, posts: posts.filter((p) => p.board === b).map(({ board: _board, ...p }) => p) })),
    });
  }
  if (req.method === 'DELETE') {
    const r = floor.studio.remove(url.searchParams.get('post') ?? '');
    if (typeof r === 'string') return send(res, 400, { error: r });
    told();
    return send(res, 200, { ok: true });
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'GET, POST or DELETE' });
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(await readBody(req)) as Record<string, unknown>;
  } catch {
    return send(res, 400, { error: 'Send JSON: {"board": "Newsroom", "title": "…", "url": "https://…", "source": "…", "body": "…"}' });
  }
  const board = boardNamed(setup, body?.board);
  if (!board) return send(res, 400, { error: body?.board ? `This floor has no board called "${String(body.board)}": office-board list shows the ones it has` : 'This floor has no bulletin boards to post to' });
  const r = floor.studio.post({ ...body, board }, me.name);
  if (typeof r === 'string') return send(res, 400, { error: r });
  told();
  ctx.toastFloor(floor, `${setup.boards[board]!.icon} ${me.name} posted to ${setup.boards[board]!.title}: “${r.title}”`);
  send(res, 200, { ok: true, board: setup.boards[board]!.title, post: { id: r.id, title: r.title } });
}
