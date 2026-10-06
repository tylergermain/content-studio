// Friday Proxy: its settings (admins) and its accounts' quota (everyone).
import type { FridayProxyClientMsg } from '../../../shared/protocol.js';
import type { ProxyPatch } from '../../friday-proxy/service.js';
import type { HandlerMap } from './types.js';

export const fridayProxyHandlers = {
  'fridayProxy.get'(ctx, c) {
    ctx.sendTo(c, { t: 'fridayProxy', state: ctx.fridayProxy.state() });
    ctx.sendTo(c, { t: 'fridayProxy.quota', quota: ctx.fridayProxy.lastQuota() });
  },
  'fridayProxy.refresh'(ctx) {
    void ctx.fridayProxy.refresh();
  },
  'fridayProxy.set'(ctx, c, msg) {
    const who = c.peer.name;
    if (!ctx.meOf(c.accountId).admin) return ctx.warn(c, 'Only admins can change where workers’ inference goes');
    const patch: ProxyPatch = {};
    if (typeof msg.url === 'string') patch.url = msg.url;
    if (typeof msg.apiKey === 'string') patch.apiKey = msg.apiKey.trim();
    if (typeof msg.managementKey === 'string') patch.managementKey = msg.managementKey.trim();
    if (typeof msg.codex === 'boolean') patch.codex = msg.codex;
    if (typeof msg.claude === 'boolean') patch.claude = msg.claude;
    const was = ctx.fridayProxy.state();
    const err = ctx.fridayProxy.set(patch, who);
    if (err) return ctx.warn(c, err);
    const now = ctx.fridayProxy.state();
    for (const p of ['codex', 'claude'] as const) {
      if (was[p] === now[p]) continue;
      const name = p === 'codex' ? 'Codex' : 'Claude';
      ctx.toastAll(now[p] ? `⚡ ${who} sent ${name} workers’ inference through Friday Proxy (new and restarted ones)` : `${who} put ${name} workers back on their own sign-ins`);
    }
  },
} satisfies HandlerMap<FridayProxyClientMsg>;
