import { createReadStream } from 'node:fs';
import { roomScreensOf } from '../../room-screens.js';
import { send } from '../util.js';
import { floorParam } from './files.js';
import type { Route } from '../router.js';

// The project rooms' TVs (server/room-screens.ts): GET /api/room-screens?floor is what each room on the floor has to
// show, and GET /api/room-screen?floor&room the picture of its app.

export const roomScreensRoute = {
  path: ['/api/room-screens', '/api/room-screen'],
  auth: 'session',
  async handle(ctx, { req, res, url, path: p }) {
    if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
    const floor = floorParam(ctx, url);
    if (!floor) return send(res, 404, { error: 'No such floor' });
    const screens = roomScreensOf(ctx);
    if (p === '/api/room-screens') return send(res, 200, screens.view(floor));
    const file = screens.file(floor, url.searchParams.get('room') ?? '');
    if (!file) return send(res, 404, { error: 'No picture of that room yet' });
    res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'cross-origin-resource-policy': 'same-origin' });
    createReadStream(file).on('error', () => res.destroy()).pipe(res);
  },
} satisfies Route;
