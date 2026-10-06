/**
 * Friday Proxy: the local CLIProxyAPI that pools the office's Claude and ChatGPT subscriptions. Admins
 * send Codex and Claude workers' inference through it in ⚙️ Settings → Workers; the ☰ menu's ⚡
 * Inference usage shows every account's quota (and comes up on the top bar when one that workers run
 * on is nearly spent). The office reads the quota through the proxy's management API, never the browser.
 */
import './friday-proxy.css';
import { summarize } from '../../../shared/friday-proxy';
import type { Ctx } from '../../core/context';
import { store } from '../../state';
import { addHudAction } from '../../ui/menu';
import { addSetting } from '../../ui/settings-rows';
import { byProvider, openProxyPanel, providerName } from './panel';
import { proxySetting } from './settings';

/** Below this average share left, a provider workers run on puts ⚡ up on the top bar. */
const LOW = 15;

/** The providers workers run through the proxy on, with their average share left on the headline window. */
function routedHeadroom(): { name: string; avg: number }[] {
  const s = store.fridayProxy;
  return byProvider(store.proxyQuota.accounts)
    .filter(([p]) => (p === 'codex' && s.codex) || (p === 'claude' && s.claude))
    .map(([p, list]) => {
      const sum = summarize(p, list);
      return { name: providerName(p), avg: sum.known ? sum.total / sum.known : NaN };
    })
    .filter((x) => Number.isFinite(x.avg));
}

export function installFridayProxy(ctx: Ctx) {
  const { net } = ctx;
  const low = () => routedHeadroom().some((x) => x.avg < LOW);
  addHudAction({
    id: 'friday-proxy',
    icon: '⚡',
    label: 'Inference usage',
    section: 'Office',
    status: low,
    chip: () =>
      routedHeadroom()
        .map((x) => `${x.name} ${Math.round(x.avg)}%`)
        .join(' · ') || 'Inference',
    tone: () => (low() ? 'danger' : undefined),
    title: () => 'Every Friday Proxy account’s quota: Claude, Codex and the rest',
    run: () => openProxyPanel(net),
  });
  addSetting({ pane: 'workers', title: 'Friday Proxy', scope: 'office', make: () => proxySetting(net) });
  // The settings and the last quota read, on arrival and after every reconnect.
  ctx.messages.on('welcome', () => net.send({ t: 'fridayProxy.get' }));
  store.on('proxyQuota', () => ctx.hud.refresh());
  store.on('fridayProxy', () => ctx.hud.refresh());
}
