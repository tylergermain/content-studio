import { releaseRoom, roomsOf, setUpRoom } from '../../factory-rooms.js';
import { REPO_NAME, cleanProjectUrl } from '../../../shared/project-rooms.js';
import { readBody, sameOrigin, send } from '../util.js';
import { floorParam } from './files.js';
import type { Route } from '../router.js';

// The Rooms panel's (server/factory-rooms.ts): GET /api/rooms?floor lists the floor's project rooms; an admin sets
// one up for a GitHub repository or renames it (POST /api/rooms/setup), clears its repository (POST
// /api/rooms/release), and lists the repositories the office's gh login can clone (GET /api/rooms/repos).

const CONTROL = /[\x00-\x1f\x7f]/;

export const roomsRoute = {
  path: ['/api/rooms', '/api/rooms/setup', '/api/rooms/release', '/api/rooms/repos'],
  auth: 'session',
  async handle(ctx, { req, res, url, path: p, session }) {
    const admin = ctx.meOf(session.account?.id).admin;
    if (p === '/api/rooms/repos') {
      if (!admin) return send(res, 403, { error: 'Only an admin sets rooms up' });
      try {
        return send(res, 200, { repos: await ctx.building.repos(url.searchParams.get('refresh') === '1') });
      } catch (e) {
        return send(res, 502, { error: e instanceof Error ? e.message : 'GitHub didn’t answer' });
      }
    }
    const floor = floorParam(ctx, url);
    if (!floor) return send(res, 404, { error: 'No such floor' });
    if (p === '/api/rooms') return req.method === 'GET' ? send(res, 200, { rooms: roomsOf(floor), admin }) : send(res, 405, { error: 'Method not allowed' });
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
    if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
    if (!admin) return send(res, 403, { error: 'Only an admin sets rooms up' });
    let b: Record<string, unknown>;
    try {
      b = JSON.parse(await readBody(req, 4000));
    } catch {
      return send(res, 400, { error: 'Invalid request' });
    }
    const room = typeof b.room === 'string' && b.room.length <= 32 ? b.room : '';
    const by = session.account?.name ?? (typeof b.by === 'string' && b.by.length <= 40 && !CONTROL.test(b.by) ? b.by : 'Someone');
    if (p === '/api/rooms/release') {
      const err = releaseRoom(ctx, floor, room, by);
      return err ? send(res, 400, { error: err }) : send(res, 200, { rooms: roomsOf(floor) });
    }
    const name = typeof b.name === 'string' && b.name.length <= 60 && !CONTROL.test(b.name) ? b.name.trim() : undefined;
    const repo = typeof b.repo === 'string' && REPO_NAME.test(b.repo.trim()) ? b.repo.trim() : undefined;
    if (b.repo !== undefined && b.repo !== '' && !repo) return send(res, 400, { error: 'Pick a repository as owner/name' });
    // An app's address, as a project room keeps one; empty takes it away.
    const app = b.url === '' ? null : b.url === undefined ? undefined : cleanProjectUrl(b.url);
    if (app === undefined && b.url !== undefined) return send(res, 400, { error: 'Use an http or https address for the app' });
    const err = setUpRoom(ctx, floor, room, { name, repo, ...(app !== undefined ? { url: app } : {}) }, by);
    return err ? send(res, 400, { error: err }) : send(res, 200, { rooms: roomsOf(floor) });
  },
} satisfies Route;
