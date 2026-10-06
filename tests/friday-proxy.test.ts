import test from 'node:test';
import assert from 'node:assert/strict';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CODEX_KEY_ENV, claudeRouteEnv, codexRouteArgs, inferenceRoute, normalizeProxyUrl, setInferenceSource } from '../src/server/friday-proxy/route.js';
import { maskName, readAccount, readClaude, readCodex, readQuota, type ProxyApi, type ProxyCred } from '../src/server/friday-proxy/quota.js';
import { FridayProxy } from '../src/server/friday-proxy/service.js';
import { prepareClaudeHome } from '../src/server/friday-proxy/claude-home.js';
import { effectiveRemaining, summarize } from '../src/shared/friday-proxy.js';
import { codex } from '../src/server/providers/codex.js';
import { claude } from '../src/server/providers/claude.js';

const ROUTE = { baseUrl: 'http://127.0.0.1:8317', apiKey: 'sk-cpa-test' };

test('proxy addresses are plain http(s) URLs that cannot break out of a TOML string', () => {
  assert.equal(normalizeProxyUrl(' http://127.0.0.1:8317/ '), 'http://127.0.0.1:8317');
  assert.equal(normalizeProxyUrl('https://studio.tail.ts.net:8317'), 'https://studio.tail.ts.net:8317');
  assert.equal(normalizeProxyUrl('ftp://127.0.0.1'), undefined);
  assert.equal(normalizeProxyUrl('http://user:pw@127.0.0.1:8317'), undefined);
  assert.equal(normalizeProxyUrl('http://127.0.0.1:8317/?x="1"'), undefined);
  assert.equal(normalizeProxyUrl('not a url'), undefined);
});

test('Codex goes through the proxy by config overrides, with its key only in the environment', () => {
  const args = codexRouteArgs(ROUTE);
  assert.ok(args.includes('model_provider="friday_proxy"'));
  assert.ok(args.includes('model_providers.friday_proxy.base_url="http://127.0.0.1:8317/v1"'));
  assert.ok(args.includes(`model_providers.friday_proxy.env_key="${CODEX_KEY_ENV}"`));
  assert.ok(args.includes('model_providers.friday_proxy.wire_api="responses"'));
  assert.ok(!args.join(' ').includes(ROUTE.apiKey));
});

test('Claude Code is pointed at the proxy last, over any sign-in an account put in', () => {
  const env: Record<string, string> = { ANTHROPIC_API_KEY: 'sk-ant-old', CLAUDE_CODE_OAUTH_TOKEN: 'oauth', CLAUDE_CONFIG_DIR: '/acct/claude', PATH: '/bin' };
  claudeRouteEnv(env, ROUTE, '/repo');
  assert.deepEqual(env, { CLAUDE_CONFIG_DIR: '/acct/claude', PATH: '/bin', ANTHROPIC_BASE_URL: ROUTE.baseUrl, ANTHROPIC_AUTH_TOKEN: ROUTE.apiKey });
});

test('the Codex and Claude adapters follow the route at launch, and leave workers alone without one', () => {
  const launchCodex = () => codex.launch({ h: { info: {}, state: codex.createState!() } as never, args: [], cwd: '/tmp', setup: { hook: '/data/hook.cjs' }, prompt: 'go' });
  const launchClaude = () => claude.launch({ h: { info: {} } as never, args: [], cwd: '/tmp', setup: { settings: '/data/claude-hooks.json' } });
  try {
    setInferenceSource(undefined);
    assert.ok(!launchCodex().args.some((a) => a.includes('friday_proxy')));
    assert.equal(launchCodex().env, undefined);
    assert.equal(launchClaude().finishEnv, undefined);
    assert.equal(claude.signIn, 'claude');

    setInferenceSource((p) => (p === 'codex' || p === 'claude' ? ROUTE : undefined));
    const c = launchCodex();
    assert.ok(c.args.includes('model_provider="friday_proxy"'));
    // Config overrides go ahead of the prompt, which ends the command line.
    assert.ok(c.args.indexOf('model_provider="friday_proxy"') < c.args.indexOf('--'));
    assert.deepEqual(c.env, { [CODEX_KEY_ENV]: ROUTE.apiKey });
    const env: Record<string, string> = { ANTHROPIC_API_KEY: 'x' };
    launchClaude().finishEnv!(env);
    assert.equal(env.ANTHROPIC_BASE_URL, ROUTE.baseUrl);
    assert.equal(env.ANTHROPIC_API_KEY, undefined);
    assert.equal(env.CLAUDE_CONFIG_DIR, undefined, 'no folder of its own without one in the route');
    // Through the proxy, a worker needs no Claude sign-in of its own.
    assert.equal(claude.signIn, undefined);
  } finally {
    setInferenceSource(undefined);
  }
});

// A Claude Max account whose 7-day limit is spent and that runs on usage credits, as the API says it.
const SPENT_CLAUDE = {
  five_hour: { utilization: 0, resets_at: null },
  seven_day: { utilization: 100, resets_at: '2026-10-06T22:00:00.033514+00:00' },
  seven_day_opus: null,
  iguana_necktie: { utilization: 0, resets_at: '2026-11-05T07:59:00+00:00', limit_dollars: 250, used_dollars: 0, remaining_dollars: 250 },
  extra_usage: { is_enabled: true, monthly_limit: 10000, used_credits: 2286, decimal_places: 2, spend_limit_reached: false },
  limits: [
    { kind: 'session', percent: 0, is_active: false, resets_at: null },
    { kind: 'weekly_all', percent: 100, is_active: true, resets_at: '2026-10-06T22:00:00.033514+00:00' },
    { kind: 'weekly_scoped', percent: 0, is_active: false, resets_at: '2026-10-06T22:00:00+00:00', scope: { model: { display_name: 'Fable' } } },
  ],
};

test('a Claude account reads its windows, the limit it hit, its usage credits and its Fable allowance', () => {
  const r = readClaude(SPENT_CLAUDE, { account: { has_claude_max: true }, organization: { rate_limit_tier: 'default_claude_max_20x' } });
  assert.equal(r.plan, 'Max 20x');
  const byId = Object.fromEntries(r.windows.map((w) => [w.id, w]));
  assert.equal(byId.fable.remaining, 100);
  assert.equal(byId['7d'].remaining, 0);
  assert.equal(byId['5h'].remaining, 100);
  assert.equal(byId['fable-credit'].detail, '$0 of $250 used');
  assert.equal(byId.credits.detail, '$22.86 of $100 this month');
  assert.ok(Math.abs(byId.credits.remaining! - 77.14) < 0.01);
  assert.deepEqual(r.flags, [
    { tone: 'bad', text: '7-day limit reached' },
    { tone: 'ok', text: 'Running on usage credits' },
  ]);
  // Fable 5 can't be used while the 7-day limit is spent, whatever its own window says.
  assert.equal(effectiveRemaining('claude', r.windows, 'fable'), 0);
});

test('a Codex account reads a weekly-only window, its resets and its credits', () => {
  const r = readCodex({
    plan_type: 'pro',
    rate_limit: { allowed: true, limit_reached: false, primary_window: { used_percent: 18, limit_window_seconds: 604800, reset_at: 1791592389 }, secondary_window: null },
    credits: { unlimited: false, balance: '53288.6798575000' },
    rate_limit_reset_credits: { available_count: 1, applicable_available_count: 0 },
  });
  assert.equal(r.plan, 'Pro');
  assert.deepEqual(r.windows, [{ id: 'weekly', label: 'Weekly limit', remaining: 82, resetAt: 1791592389000 }]);
  assert.deepEqual(r.flags, [
    { tone: '', text: '1 reset available' },
    { tone: '', text: '53,288 credits' },
  ]);
});

test('accounts are read a few at a time, failures and unknown providers stay in the list', async () => {
  const creds: ProxyCred[] = [
    { auth_index: 'a', name: 'claude-tyler@fridaylabs.com.json', provider: 'claude' },
    { auth_index: 'b', name: 'codex-ops@pixel.gg.json', provider: 'codex', id_token: { chatgpt_account_id: 'acct-1' } },
    { auth_index: 'c', name: 'xai-me@x.co.json', provider: 'xai' },
    { auth_index: 'd', name: 'claude-off@x.co.json', provider: 'claude', disabled: true },
  ];
  const headers: Record<string, Record<string, string>> = {};
  const api: ProxyApi = {
    credentials: async () => creds,
    async call(idx, _m, url, header) {
      headers[idx] = header;
      if (url.endsWith('/oauth/profile')) return { status: 200, json: {}, body: '{}' };
      if (idx === 'a') return { status: 200, json: SPENT_CLAUDE, body: '' };
      return { status: 401, json: { error: { message: 'expired' } }, body: '' };
    },
  };
  const q = await readQuota(api);
  assert.deepEqual(q.accounts.map((a) => [a.provider, a.status, a.name]), [
    ['claude', 'ok', 'claude-t•••@f•••.com.json'],
    ['codex', 'error', 'codex-o•••@p•••.gg.json'],
    ['xai', 'unsupported', 'xai-m•••@x•••.co.json'],
    ['claude', 'ok', 'claude-o•••@x•••.co.json'],
  ]);
  assert.match(q.accounts[1].error!, /401/);
  assert.equal(headers.b['Chatgpt-Account-Id'], 'acct-1');
  assert.equal(headers.d, undefined, 'a disabled account is not read');
  // The disabled one doesn't count toward the provider's total.
  const s = summarize('claude', q.accounts.filter((a) => a.provider === 'claude'));
  assert.equal(s.label, '7-day Fable 5');
  assert.deepEqual(s.shares, [0]);
});

test('an unreadable account never takes the others down', async () => {
  const api: ProxyApi = { credentials: async () => [], call: async () => Promise.reject(new Error('socket hang up')) };
  const a = await readAccount(api, { auth_index: 'x', name: 'codex-a@b.c.json', provider: 'codex' });
  assert.equal(a.status, 'error');
  assert.equal(a.error, 'socket hang up');
  assert.equal(maskName('no-email.json'), 'no-email.json');
});

test('the settings need an API key before workers can be sent through, are kept 0600, and answer the route', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'fp-'));
  try {
    const states: unknown[] = [];
    const quotas: unknown[] = [];
    const fake = (): ProxyApi => ({ credentials: async () => [], call: async () => ({ status: 200, json: {}, body: '' }) });
    const fp = new FridayProxy(dir, (s) => states.push(s), (q) => quotas.push(q), () => true, fake);
    assert.equal(inferenceRoute('codex'), undefined);
    assert.match(fp.set({ codex: true }, 'Tyler')!, /API key/);
    assert.match(fp.set({ url: 'javascript:alert(1)' }, 'Tyler')!, /http/);
    assert.equal(fp.set({ apiKey: 'sk-cpa-1', managementKey: 'm-1', codex: true }, 'Tyler'), undefined);
    assert.deepEqual(inferenceRoute('codex'), { baseUrl: 'http://127.0.0.1:8317', apiKey: 'sk-cpa-1' });
    assert.equal(inferenceRoute('claude'), undefined);
    const state = fp.state();
    assert.equal(state.hasApiKey, true);
    assert.ok(!JSON.stringify(state).includes('sk-cpa-1'), 'keys never go to browsers');
    const file = path.join(dir, 'friday-proxy.json');
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).apiKey, 'sk-cpa-1');
    await fp.refresh(true);
    assert.deepEqual((quotas.at(-1) as { accounts: unknown[] }).accounts, []);
    // Restored from disk by the next office.
    const again = new FridayProxy(dir, () => {}, () => {}, () => true, fake);
    assert.deepEqual(again.route('codex'), { baseUrl: 'http://127.0.0.1:8317', apiKey: 'sk-cpa-1' });
    // Removing the key turns routing off with it.
    assert.match(again.set({ apiKey: '' }, 'Tyler')!, /API key/);
    assert.equal(again.set({ apiKey: '', codex: false }, 'Tyler'), undefined);
    assert.equal(inferenceRoute('codex'), undefined);
  } finally {
    setInferenceSource(undefined);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('with no management key the quota says how to get one, and a proxy that is down says so', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'fp-'));
  try {
    let last: { error?: string } = {};
    const down = (): ProxyApi => ({ credentials: () => Promise.reject(new TypeError('fetch failed')), call: async () => ({ status: 0, json: null, body: '' }) });
    const fp = new FridayProxy(dir, () => {}, (q) => (last = q), () => true, down);
    await fp.refresh(true);
    assert.match(last.error!, /management key/);
    fp.set({ managementKey: 'm' }, 'Tyler');
    await fp.refresh(true);
    assert.match(last.error!, /isn’t answering at http:\/\/127\.0\.0\.1:8317/);
  } finally {
    setInferenceSource(undefined);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('routed Claude workers get a login-free folder with the person’s own skills and settings, first run done, trust carried over', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'fp-home-'));
  try {
    const own = { dir: path.join(dir, 'own'), json: path.join(dir, 'own.claude.json') };
    mkdirSync(path.join(own.dir, 'skills'), { recursive: true });
    writeFileSync(path.join(own.dir, 'settings.json'), '{}');
    writeFileSync(path.join(own.dir, '.credentials.json'), '{"secret":1}');
    writeFileSync(own.json, JSON.stringify({ projects: { '/work': { hasTrustDialogAccepted: true } } }));
    const home = path.join(dir, 'routed');
    prepareClaudeHome(home, '/work/repo/.worktrees/w1', own);
    prepareClaudeHome(home, '/elsewhere', own);
    assert.equal(readlinkSync(path.join(home, 'skills')), path.join(own.dir, 'skills'));
    assert.equal(readlinkSync(path.join(home, 'settings.json')), path.join(own.dir, 'settings.json'));
    assert.throws(() => lstatSync(path.join(home, '.credentials.json')), 'its login stays behind');
    const c = JSON.parse(readFileSync(path.join(home, '.claude.json'), 'utf8'));
    assert.equal(c.hasCompletedOnboarding, true);
    assert.deepEqual(Object.keys(c.projects), ['/work/repo/.worktrees/w1'], 'inside a trusted folder: trusted; elsewhere: asked');
    const env: Record<string, string> = { CLAUDE_SECURESTORAGE_CONFIG_DIR: '/x' };
    claudeRouteEnv(env, { ...ROUTE, claudeHome: home }, '/work');
    assert.equal(env.CLAUDE_CONFIG_DIR, home);
    assert.equal(env.CLAUDE_SECURESTORAGE_CONFIG_DIR, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
