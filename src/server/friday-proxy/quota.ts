// Every Friday Proxy account's live quota, read through the proxy's management API: its credentials,
// then each one's usage endpoint called with that account's own token (requests/api-call, $TOKEN$).
// The same reading as the proxy's own console (internal/console in the Friday Proxy repo).
import type { FridayProxyQuota, ProxyAccount, ProxyFlag, ProxyWindow } from '../../shared/protocol.js';

/** What the proxy lists for a credential (GET /v8/management/credentials), the parts read here. */
export interface ProxyCred {
  auth_index: string;
  name: string;
  provider?: string;
  type?: string;
  disabled?: boolean;
  account_type?: string;
  id_token?: { chatgpt_account_id?: string; plan_type?: string };
}

/** An upstream reply relayed by the proxy. */
export interface Relayed {
  status: number;
  json: unknown;
  body: string;
}

/** How quota reaches the proxy: real fetches in the office, fakes in tests. */
export interface ProxyApi {
  credentials(): Promise<ProxyCred[]>;
  call(authIndex: string, method: string, url: string, header: Record<string, string>, data?: string): Promise<Relayed>;
}

const CLAUDE_USAGE = 'https://api.anthropic.com/api/oauth/usage';
const CLAUDE_PROFILE = 'https://api.anthropic.com/api/oauth/profile';
const CLAUDE_HEADERS = {
  'User-Agent': 'claude-cli/2.1.280 (external, cli)',
  Authorization: 'Bearer $TOKEN$',
  'Content-Type': 'application/json',
  'anthropic-beta': 'oauth-2025-04-20',
};
const CLAUDE_WINDOWS: [key: string, id: string, label: string][] = [
  ['iguana_necktie', 'fable', '7-day Fable 5'],
  ['five_hour', '5h', '5-hour limit'],
  ['seven_day', '7d', '7-day limit'],
  ['seven_day_opus', 'opus', '7-day Opus'],
  ['seven_day_sonnet', 'sonnet', '7-day Sonnet'],
];
const CODEX_USAGE = 'https://chatgpt.com/backend-api/wham/usage';
const CODEX_HEADERS = {
  Authorization: 'Bearer $TOKEN$',
  'Content-Type': 'application/json',
  'User-Agent': 'codex-tui/0.149.1 (Mac OS 26.5.2; arm64) iTerm.app/3.6.11 (codex-tui; 0.149.1)',
};
const CODEX_PLANS: Record<string, string> = { pro: 'Pro', prolite: 'Pro Lite', plus: 'Plus', team: 'Team', free: 'Free', business: 'Business', enterprise: 'Enterprise' };

type J = Record<string, any>;
const num = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};
const clamp = (n: number) => Math.max(0, Math.min(100, n));
const money = (v: number) => `$${v.toFixed(v % 1 ? 2 : 0)}`;

/** ISO text, epoch seconds or epoch ms; undefined when it isn't a time. */
export function toMs(v: unknown): number | undefined {
  if (v == null || v === '') return undefined;
  const n = num(v);
  if (n !== null) return n > 0 ? (n < 1e11 ? n * 1000 : n) : undefined;
  const t = new Date(String(v).replace(/(\.\d{3})\d+/, '$1')).getTime();
  return Number.isFinite(t) ? t : undefined;
}

/** claude-tyler@example.dev.json → claude-t•••@e•••.dev.json: the office is shared, the emails aren't. */
export function maskName(name: string): string {
  const m = /^(.*?-)?([^@\s]+)@([^.@\s]+)(\..+)?$/.exec(name);
  if (!m) return name;
  const [, prefix = '', local, domain, rest = ''] = m;
  return `${prefix}${local[0]}•••@${domain[0]}•••${rest}`;
}

export function providerOf(c: ProxyCred): string {
  const raw = String(c.provider || c.type || '').toLowerCase();
  if (raw === 'anthropic') return 'claude';
  if (raw.startsWith('kimi')) return 'kimi';
  return raw || 'unknown';
}

function failed(res: Relayed, what: string): Error {
  const b = res.json as J | null;
  const msg = b?.error?.message || b?.detail || b?.message || (typeof b?.error === 'string' ? b.error : '') || res.body.slice(0, 160);
  if (res.status === 401) return new Error(`${what}: token rejected (401), sign in again on the proxy`);
  if (res.status === 429) return new Error(`${what}: rate limited (429)`);
  return new Error(`${what}: HTTP ${res.status}${msg ? ` · ${msg}` : ''}`);
}
const ok = (r: Relayed) => r.status >= 200 && r.status < 300;

/** A Claude subscription's windows, the limits it has hit, and its usage credits. */
export function readClaude(data: J, profile?: J): { plan?: string; windows: ProxyWindow[]; flags: ProxyFlag[] } {
  const limits: J[] = Array.isArray(data.limits) ? data.limits : [];
  const scoped = limits.filter((l) => l?.kind === 'weekly_scoped' && /^fable( 5)?$/i.test(String(l?.scope?.model?.display_name ?? '')) && num(l?.percent) !== null);
  const fable = scoped.find((l) => l.is_active === true) ?? scoped[0];
  const windows: ProxyWindow[] = [];
  for (const [key, id, label] of CLAUDE_WINDOWS) {
    if (id === 'fable' && fable) {
      windows.push({ id, label, remaining: clamp(100 - num(fable.percent)!), resetAt: toMs(fable.resets_at) });
      continue;
    }
    const w = data[key];
    // A dollar allowance isn't a percentage window (see below).
    if (!w || typeof w !== 'object' || !('utilization' in w) || num(w.limit_dollars) !== null) continue;
    const used = num(w.utilization);
    windows.push({ id, label, remaining: used === null ? null : clamp(100 - used), resetAt: toMs(w.resets_at) });
  }
  const pool = data.iguana_necktie;
  const poolCap = num(pool?.limit_dollars);
  if (poolCap) {
    const spent = num(pool.used_dollars) ?? 0;
    const left = num(pool.remaining_dollars) ?? poolCap - spent;
    windows.push({ id: 'fable-credit', label: 'Fable 5 credit', remaining: clamp((left / poolCap) * 100), resetAt: toMs(pool.resets_at), detail: `${money(spent)} of ${money(poolCap)} used` });
  }
  const flags: ProxyFlag[] = [];
  const names: Record<string, string> = { session: '5-hour limit', weekly_all: '7-day limit', weekly_scoped: 'Fable 5 limit' };
  const reached = limits.filter((l) => (num(l?.percent) ?? 0) >= 100).map((l) => names[l.kind] ?? 'Limit');
  if (!limits.length) for (const [k, n] of [['five_hour', '5-hour limit'], ['seven_day', '7-day limit']]) if ((num(data[k]?.utilization) ?? 0) >= 100) reached.push(n);
  for (const n of reached) flags.push({ tone: 'bad', text: `${n} reached` });
  const extra = data.extra_usage;
  if (extra?.is_enabled) {
    const places = num(extra.decimal_places) ?? 2;
    const used = (num(extra.used_credits) ?? 0) / 10 ** places;
    const cap = num(extra.monthly_limit);
    if (cap) windows.push({ id: 'credits', label: 'Usage credits', remaining: clamp(100 - (used / (cap / 10 ** places)) * 100), detail: `${money(used)} of ${money(cap / 10 ** places)} this month` });
    if (extra.spend_limit_reached) flags.push({ tone: 'bad', text: 'Usage credits used up' });
    else if (reached.length) flags.push({ tone: 'ok', text: 'Running on usage credits' });
  }
  return { plan: claudePlan(profile), windows, flags };
}

function claudePlan(p?: J): string | undefined {
  if (!p) return undefined;
  const tier = String(p.organization?.rate_limit_tier ?? '').toLowerCase();
  if (p.organization?.organization_type === 'claude_team' && p.organization?.subscription_status === 'active') return 'Team';
  if (p.account?.has_claude_max === true || tier.includes('max')) return tier.includes('20x') ? 'Max 20x' : tier.includes('5x') ? 'Max 5x' : 'Max';
  if (p.account?.has_claude_pro === true) return 'Pro';
  return undefined;
}

/** A ChatGPT subscription's Codex windows, resets and credits. */
export function readCodex(data: J): { plan?: string; windows: ProxyWindow[]; flags: ProxyFlag[] } {
  const windows: ProxyWindow[] = [];
  const secs = (w: J | null | undefined) => num(w?.limit_window_seconds);
  const monthly = (w: J | null | undefined) => {
    const s = secs(w);
    return s !== null && s >= 2419200 && s <= 2678400;
  };
  const rate: J | undefined = data.rate_limit;
  const primary: J | null = rate?.primary_window ?? null;
  const secondary: J | null = rate?.secondary_window ?? null;
  let five: J | null = null;
  let week: J | null = null;
  for (const w of [primary, secondary]) {
    if (!w) continue;
    if (secs(w) === 18000 && !five) five = w;
    else if ((secs(w) === 604800 || monthly(w)) && !week) week = w;
  }
  if (!five && primary && primary !== week) five = primary;
  if (!week && secondary && secondary !== five) week = secondary;
  const push = (w: J | null, id: string, label: string) => {
    if (!w) return;
    let used = num(w.used_percent);
    if (used === null && (rate?.limit_reached || rate?.allowed === false)) used = 100;
    const after = num(w.reset_after_seconds);
    windows.push({ id, label, remaining: used === null ? null : clamp(100 - used), resetAt: toMs(w.reset_at) ?? (after !== null ? Date.now() + after * 1000 : undefined) });
  };
  push(five, '5h', '5-hour limit');
  push(week, monthly(week) ? 'monthly' : 'weekly', monthly(week) ? 'Monthly limit' : 'Weekly limit');

  const flags: ProxyFlag[] = [];
  if (rate?.limit_reached || rate?.allowed === false) flags.push({ tone: 'bad', text: 'Limit reached' });
  const rc = data.rate_limit_reset_credits;
  const resets = num(rc?.available_count) ?? 0;
  const resetsUsable = num(rc?.applicable_available_count) ?? 0;
  // Usable now only while a limit is hit; redeeming one is done in the proxy's console.
  if (resets) flags.push({ tone: resetsUsable ? 'ok' : '', text: `${resets} reset${resets === 1 ? '' : 's'} available` });
  if (data.credits?.unlimited) flags.push({ tone: '', text: 'Unlimited credits' });
  else if ((num(data.credits?.balance) ?? 0) > 0) flags.push({ tone: '', text: `${Math.floor(num(data.credits.balance)!).toLocaleString('en-US')} credits` });
  const raw = String(data.plan_type ?? '').toLowerCase();
  return { plan: CODEX_PLANS[raw] ?? (raw ? raw[0].toUpperCase() + raw.slice(1) : undefined), windows, flags };
}

function codexHeaders(c: ProxyCred): Record<string, string> {
  const id = c.id_token?.chatgpt_account_id;
  return id ? { ...CODEX_HEADERS, 'Chatgpt-Account-Id': id } : { ...CODEX_HEADERS };
}

/** One account's quota; never throws (a failure is the account's `error`). */
export async function readAccount(api: ProxyApi, c: ProxyCred): Promise<ProxyAccount> {
  const provider = providerOf(c);
  const base = { id: c.auth_index, provider, name: maskName(c.name), disabled: !!c.disabled, windows: [], flags: [] };
  if (c.disabled) return { ...base, status: 'ok', plan: c.account_type };
  try {
    if (provider === 'claude') {
      const [usage, profile] = await Promise.all([api.call(c.auth_index, 'GET', CLAUDE_USAGE, CLAUDE_HEADERS), api.call(c.auth_index, 'GET', CLAUDE_PROFILE, CLAUDE_HEADERS).catch(() => undefined)]);
      if (!ok(usage)) throw failed(usage, 'Claude usage');
      const r = readClaude((usage.json as J) ?? {}, profile && ok(profile) ? (profile.json as J) : undefined);
      return { ...base, status: 'ok', plan: r.plan ?? c.account_type, windows: r.windows, flags: r.flags };
    }
    if (provider === 'codex') {
      const res = await api.call(c.auth_index, 'GET', CODEX_USAGE, codexHeaders(c));
      if (!ok(res)) throw failed(res, 'Codex usage');
      const r = readCodex((res.json as J) ?? {});
      return { ...base, status: 'ok', plan: r.plan ?? c.id_token?.plan_type, windows: r.windows, flags: r.flags };
    }
    return { ...base, status: 'unsupported', plan: c.account_type, error: 'The proxy has no live quota for this provider yet' };
  } catch (e) {
    return { ...base, status: 'error', plan: c.account_type, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Every account's quota, a few at a time. */
export async function readQuota(api: ProxyApi): Promise<FridayProxyQuota> {
  const creds = await api.credentials();
  const out: ProxyAccount[] = new Array(creds.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, creds.length) }, async () => {
      while (next < creds.length) {
        const i = next++;
        out[i] = await readAccount(api, creds[i]);
      }
    }),
  );
  return { at: Date.now(), accounts: out };
}

/** The proxy's management API at `url`, with its management key. */
export function httpProxyApi(url: string, managementKey: string, timeoutMs = 20_000): ProxyApi {
  const req = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(`${url}/v8/management${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${managementKey}`, 'Content-Type': 'application/json', ...(init.headers as Record<string, string> | undefined) },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* not JSON */
    }
    if (res.status === 401 || res.status === 403) throw new Error('The proxy turned the management key down');
    if (!res.ok) throw new Error(`The proxy said HTTP ${res.status}`);
    return json as J;
  };
  return {
    async credentials() {
      const r = await req('/credentials');
      return Array.isArray(r?.files) ? (r.files as ProxyCred[]) : [];
    },
    async call(authIndex, method, target, header, data) {
      const r = await req('/requests/api-call', { method: 'POST', body: JSON.stringify({ auth_index: authIndex, method, url: target, header, ...(data ? { data } : {}) }) });
      const body = typeof r?.body === 'string' ? r.body : '';
      let json: unknown = null;
      try {
        json = body ? JSON.parse(body) : null;
      } catch {
        /* not JSON */
      }
      return { status: Number(r?.status_code) || 0, json, body };
    },
  };
}
