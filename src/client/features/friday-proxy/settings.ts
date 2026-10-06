// ⚙️ Settings → Workers → Friday Proxy: where Codex and Claude workers' inference goes. Admins change it.
import type { Net } from '../../net';
import { store } from '../../state';
import { h, timeAgo } from '../../ui/dom';

const KEY_SAVED = 'saved, type to replace';

export function proxySetting(net: Net): { body: Node[]; close: () => void } {
  const url = h('input', { type: 'text', placeholder: 'http://127.0.0.1:8317', 'aria-label': 'Friday Proxy address', spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
  const apiKey = h('input', { type: 'password', 'aria-label': 'Friday Proxy API key', spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
  const mgmtKey = h('input', { type: 'password', 'aria-label': 'Friday Proxy management key', spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
  const save = h('button.btn.primary', { type: 'button' }, 'Save');
  const fields = h(
    'div.fp-fields',
    {},
    h('label', {}, 'Address', url),
    h('label', {}, 'API key (what workers sign in with)', apiKey),
    h('label', {}, 'Management key (to read each account’s quota)', mgmtKey),
    h('div.webhook', {}, save),
  );
  const routes = h('div.seg.fp-route-seg', { role: 'group', 'aria-label': 'Workers that run through Friday Proxy' });
  const note = h('p.setting-note');

  const toggle = (p: 'codex' | 'claude', label: string) => {
    const on = store.fridayProxy[p];
    return h(
      'button.btn',
      {
        type: 'button',
        role: 'switch',
        'aria-checked': String(on),
        class: on ? 'on' : '',
        disabled: !store.me.admin,
        onclick: () => net.send({ t: 'fridayProxy.set', [p]: !store.fridayProxy[p] }),
      },
      `${on ? '⚡' : '○'} ${label}`,
    );
  };

  const paint = () => {
    const s = store.fridayProxy;
    const admin = store.me.admin;
    fields.classList.toggle('hidden', !admin);
    if (document.activeElement !== url) url.value = s.url;
    apiKey.placeholder = s.hasApiKey ? KEY_SAVED : 'from access.api-keys in the proxy’s config.yaml';
    mgmtKey.placeholder = s.hasManagementKey ? KEY_SAVED : 'management.secret-key (before it was hashed)';
    routes.replaceChildren(toggle('codex', 'Codex workers'), toggle('claude', 'Claude workers'));
    const on = [s.codex && 'Codex', s.claude && 'Claude'].filter(Boolean).join(' and ');
    const now = on
      ? `${on} workers run their inference through Friday Proxy at ${s.url}, which spreads it over every account signed in to it. New and restarted workers pick this up; ones already running keep what they started with.`
      : 'Workers use their own Claude and ChatGPT sign-ins. Turned on, a provider’s workers (and, for Codex, the executive assistant) send their inference through the proxy instead.';
    note.textContent = `${now} The ⚡ Inference usage panel shows each account’s quota.${s.by ? ` Set by ${s.by}${s.at ? ` ${timeAgo(s.at)}` : ''}.` : ''}`;
  };

  save.addEventListener('click', () => {
    const msg: { t: 'fridayProxy.set'; url?: string; apiKey?: string; managementKey?: string } = { t: 'fridayProxy.set' };
    if (url.value.trim() && url.value.trim() !== store.fridayProxy.url) msg.url = url.value.trim();
    if (apiKey.value.trim()) msg.apiKey = apiKey.value.trim();
    if (mgmtKey.value.trim()) msg.managementKey = mgmtKey.value.trim();
    apiKey.value = '';
    mgmtKey.value = '';
    if (Object.keys(msg).length > 1) net.send(msg);
  });

  paint();
  const off = store.on('fridayProxy', paint);
  return { body: [routes, fields, note], close: off };
}
