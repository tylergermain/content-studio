// The ⚡ Inference panel: every Friday Proxy account's quota, provider by provider, in slanted tick
// meters like the proxy's own console (and the Friday Labs mark).
import type { ProxyAccount, ProxyWindow } from '../../../shared/protocol';
import { quotaTone, summarize } from '../../../shared/friday-proxy';
import type { Net } from '../../net';
import { store } from '../../state';
import { h, openModal, type Modal } from '../../ui/dom';
import { fmtReset } from '../../ui/limits';

const NAMES: Record<string, string> = { claude: 'Claude', codex: 'Codex', kimi: 'Kimi', xai: 'xAI', antigravity: 'Antigravity', gemini: 'Gemini' };
export const providerName = (p: string) => NAMES[p] ?? p.charAt(0).toUpperCase() + p.slice(1);
const ORDER = ['claude', 'codex', 'antigravity', 'kimi', 'xai'];

/** A share left as slanted ticks: green, amber or red, dim where it's used up. */
export function meter(remaining: number | null, small = false): HTMLElement {
  const v = remaining == null ? 0 : Math.max(0, Math.min(100, remaining));
  return h(
    'div.fp-meter',
    {
      class: `tone-${quotaTone(remaining)}${small ? ' small' : ''}`,
      style: `--v:${v}`,
      role: remaining == null ? undefined : 'meter',
      'aria-valuemin': 0,
      'aria-valuemax': 100,
      'aria-valuenow': remaining == null ? undefined : Math.round(v),
    },
    h('i'),
  );
}

/** The accounts grouped by provider, in a steady order. */
export function byProvider(accounts: readonly ProxyAccount[]): [string, ProxyAccount[]][] {
  const groups = new Map<string, ProxyAccount[]>();
  for (const a of accounts) groups.set(a.provider, [...(groups.get(a.provider) ?? []), a]);
  const rank = (p: string) => (ORDER.includes(p) ? ORDER.indexOf(p) : ORDER.length);
  return [...groups.entries()].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b));
}

function windowCell(w: ProxyWindow, now: number): HTMLElement {
  const foot = w.detail ?? (w.resetAt && w.resetAt > now ? `resets ${fmtReset(w.resetAt, now)}` : w.remaining === 100 ? 'nothing used' : '');
  return h(
    'div.fp-win',
    {},
    h('div.fp-win-top', {}, h('span', {}, w.label), h('b', {}, w.remaining == null ? '--' : `${Math.round(w.remaining)}%`)),
    meter(w.remaining),
    h('div.fp-win-foot', {}, foot),
  );
}

function accountRow(a: ProxyAccount, now: number): HTMLElement {
  const flags = a.flags.map((f) => h('span.fp-flag', { class: f.tone || 'plain' }, f.text));
  if (a.disabled) flags.unshift(h('span.fp-flag.plain', {}, 'Disabled'));
  const body = a.windows.length
    ? h('div.fp-wins', {}, ...a.windows.map((w) => windowCell(w, now)))
    : h('div.fp-note', { class: a.status === 'error' ? 'bad' : '' }, a.disabled ? 'Turned off on the proxy' : (a.error ?? 'No quota yet'));
  return h(
    'div.fp-account',
    {},
    h('div.fp-account-head', {}, h('span.fp-name', {}, a.name), a.plan ? h('span.fp-plan', {}, a.plan) : null, ...flags),
    a.status === 'error' && a.windows.length ? h('div.fp-note.bad', {}, a.error ?? '') : null,
    body,
  );
}

function summaryCard(provider: string, accounts: ProxyAccount[], now: number): HTMLElement {
  const s = summarize(provider, accounts);
  const routed = (provider === 'codex' && store.fridayProxy.codex) || (provider === 'claude' && store.fridayProxy.claude);
  return h(
    'div.fp-card',
    {},
    h('div.fp-card-head', {}, h('b', {}, providerName(provider)), routed ? h('span.fp-flag.ok', { title: 'Its workers run through Friday Proxy' }, 'Workers') : null, h('span.fp-count', {}, `${accounts.length} account${accounts.length === 1 ? '' : 's'}`)),
    h('div.fp-card-label', {}, s.label),
    h('div.fp-big', {}, h('b', {}, s.known ? `${Math.round(s.total)}%` : '--'), h('span', {}, ` of ${Math.max(s.shares.length, 1) * 100}%`)),
    h('div.fp-segs', {}, ...(s.shares.length ? s.shares : [null]).map((v) => meter(v, true))),
    h('div.fp-win-foot', {}, s.soonest ? `next reset ${fmtReset(s.soonest, now)}` : s.known ? 'nothing to reset' : 'no data yet'),
  );
}

/** The panel's content for the quota as it stands. */
function paint(body: HTMLElement, foot: HTMLElement) {
  const q = store.proxyQuota;
  const now = Date.now();
  const groups = byProvider(q.accounts);
  const route = store.fridayProxy;
  const routes = h(
    'p.fp-routes',
    {},
    `Codex workers: ${route.codex ? 'through Friday Proxy' : 'their own sign-in'} · Claude workers: ${route.claude ? 'through Friday Proxy' : 'their own sign-in'}`,
  );
  const parts: Node[] = [routes];
  if (q.error) parts.push(h('div.fp-error', {}, q.error));
  if (groups.length) parts.push(h('div.fp-cards', {}, ...groups.map(([p, list]) => summaryCard(p, list, now))));
  for (const [p, list] of groups) parts.push(h('h3.fp-group', {}, providerName(p), h('span', {}, String(list.length))), ...list.map((a) => accountRow(a, now)));
  if (!groups.length && !q.error) parts.push(h('div.fp-note', {}, q.at ? 'No accounts are signed in to the proxy yet.' : 'Reading the proxy…'));
  body.replaceChildren(...parts);
  foot.replaceChildren(h('span.fp-asof', {}, q.at ? `As of ${new Date(q.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : ''));
  if (route.url) foot.append(h('a.btn', { href: consoleUrl(route.url), target: '_blank', rel: 'noopener' }, 'Open the proxy’s console ↗'));
}

/**
 * The proxy's console, as this browser can reach it: a proxy on the office machine's loopback is the
 * same port on whatever name the office was opened by (its tailnet name, from a laptop).
 */
export function consoleUrl(url: string): string {
  try {
    const u = new URL(url);
    if (['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) && !['127.0.0.1', 'localhost'].includes(location.hostname)) {
      return `${location.protocol}//${location.hostname}:${u.port || '80'}/console/`;
    }
    return `${u.origin}/console/`;
  } catch {
    return '#';
  }
}

let open: Modal | undefined;

/** Opens the ⚡ panel (or brings it back up), and reads the quota again. */
export function openProxyPanel(net: Net) {
  if (open) return;
  const body = h('div.body.fp-body');
  const foot = h('footer');
  const refresh = h('button.btn', { type: 'button', title: 'Read every account again now', onclick: () => net.send({ t: 'fridayProxy.refresh' }) }, 'Refresh');
  const box = h('div.modal.fp-panel', { role: 'dialog', 'aria-label': 'Inference usage' }, h('header', {}, h('h2', {}, '⚡ Inference usage'), refresh), body, foot);
  const repaint = () => paint(body, foot);
  const offs = [store.on('proxyQuota', repaint), store.on('fridayProxy', repaint)];
  const tick = setInterval(repaint, 30_000);
  repaint();
  net.send({ t: 'fridayProxy.refresh' });
  open = openModal(box, {
    doing: 'checking inference usage',
    onClose: () => {
      offs.forEach((off) => off());
      clearInterval(tick);
      open = undefined;
    },
  });
}
