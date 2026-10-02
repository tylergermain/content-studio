import { api, authorize, callback, configure, disconnect, load } from '../../spotify/account.js';
import type { Route } from '../router.js';
import { readBody, sameOrigin, send } from '../util.js';
export const spotifyRoutes = {
  callback: { path: '/api/spotify/callback', method: 'GET', auth: 'public', async handle(ctx, { url, res }) {
    let message = 'Spotify connected. Return to Content Studio and reopen the jukebox.';
    try { await callback(ctx.cfg.dataDir, url.searchParams.get('state') ?? '', url.searchParams.get('code') ?? ''); }
    catch { message = 'Spotify connection failed or was cancelled. Return to the jukebox and try again.'; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'", 'referrer-policy': 'no-referrer' });
    res.end(`<html><title>Content Studio Spotify</title><body style="font:20px system-ui;padding:48px"><h1>Content Studio</h1><p>${message}</p></body></html>`);
  } },
  account: { prefix: '/api/spotify', auth: 'session', async handle(ctx, { req, res, path, session }) {
    const admin = ctx.meOf(session.account?.id).admin;
    if (!admin) return send(res, 403, { error: 'Only an office admin can use this Spotify account' });
    if (req.method === 'POST' && !sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
    const dir = ctx.cfg.dataDir;
    try {
      if (path === '/api/spotify' && req.method === 'GET') {
        const s = load(dir); if (!s.refresh) return send(res, 200, { configured: !!s.clientId, connected: false });
        const [me, player, devices] = await Promise.all([api(dir, 'me'), api(dir, 'me/player'), api(dir, 'me/player/devices')]);
        return send(res, 200, { configured: true, connected: true, name: me.display_name ?? 'Spotify', player, devices: devices.devices });
      }
      if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
      const b = JSON.parse(await readBody(req, 4096));
      if (path === '/api/spotify/config') { configure(dir, String(b.clientId ?? ''), String(b.redirect ?? '')); return send(res, 200, { ok: true }); }
      if (path === '/api/spotify/connect') return send(res, 200, { url: authorize(dir) });
      if (path === '/api/spotify/disconnect') { disconnect(dir); return send(res, 200, { ok: true }); }
      if (path !== '/api/spotify/playback') return send(res, 404, { error: 'Not found' });
      const device = typeof b.device === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(b.device) ? b.device : '';
      const query = device ? `?device_id=${encodeURIComponent(device)}` : '';
      if (b.action === 'play') {
        let body;
        if (b.uri) {
          if (typeof b.uri !== 'string' || !/^spotify:(track|album|playlist):[a-zA-Z0-9]{22}$/.test(b.uri)) throw new Error('Paste a Spotify track, album, or playlist link');
          body = b.uri.startsWith('spotify:track:') ? { uris: [b.uri] } : { context_uri: b.uri };
        }
        await api(dir, `me/player/play${query}`, 'PUT', body);
      } else if (b.action === 'pause') await api(dir, `me/player/pause${query}`, 'PUT');
      else if (b.action === 'next' || b.action === 'previous') await api(dir, `me/player/${b.action}${query}`, 'POST');
      else if (b.action === 'device' && device) await api(dir, 'me/player', 'PUT', { device_ids: [device], play: false });
      else throw new Error('Choose a valid playback action');
      return send(res, 200, { ok: true });
    } catch (e) { return send(res, 400, { error: e instanceof Error ? e.message : 'Spotify request failed' }); }
  } },
} satisfies Record<string, Route>;
