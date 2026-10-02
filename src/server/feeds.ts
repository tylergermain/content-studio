import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Floor } from './floor.js';
import type { IntegrationsState, Post, Quote, SlackChannel, TickerState } from '../shared/studio.js';

// What the office reads from outside by itself, for the floors that show it (see shared/studio.ts):
// the market's prices for a floor's stock ticker, the latest in the Slack channels a board
// watches, and how the socials are doing on Metricool. One of these for the whole building.

const TICKER_MS = 60_000;
const SLACK_MS = 45_000;
const METRICOOL_MS = 15 * 60_000;
const TIMEOUT_MS = 10_000;
/** How many of a channel's latest messages a board keeps. */
const PER_CHANNEL = 8;

/** The office's own sign-ins to the services it reads, kept in integrations.json (0600). They never leave the office. */
interface Secrets {
  slack?: string;
  metricool?: { token: string; userId: string; blogId: string };
}

export interface FeedsOut {
  floors(): Iterable<Floor>;
  /** A floor's boards changed, or its ticker's prices did. */
  studio(floor: Floor): void;
  ticker(floor: Floor): void;
  integrations(state: IntegrationsState): void;
}

async function getJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (office)', ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`.trim());
  return res.json();
}

/** A symbol's price now and at the last close, from Yahoo's chart of it. */
async function quote(symbol: string): Promise<Quote | undefined> {
  const data = (await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`)) as { chart?: { result?: { meta?: { regularMarketPrice?: number; chartPreviousClose?: number; previousClose?: number } }[] } };
  const meta = data.chart?.result?.[0]?.meta;
  const price = meta?.regularMarketPrice;
  const was = meta?.chartPreviousClose ?? meta?.previousClose;
  if (typeof price !== 'number' || typeof was !== 'number' || !was) return undefined;
  return { symbol, price, change: price - was, pct: ((price - was) / was) * 100 };
}

/** What Slack's markup says, as people read it: mentions and links by their names, no angle brackets. */
function plain(text: string, names: Map<string, string>): string {
  return text
    .replace(/<@([A-Z0-9]+)(?:\|[^>]*)?>/g, (_, id: string) => `@${names.get(id) ?? 'someone'}`)
    .replace(/<#[A-Z0-9]+\|([^>]*)>/g, '#$1')
    .replace(/<!(here|channel|everyone)>/g, '@$1')
    .replace(/<([^|>]+)\|([^>]+)>/g, '$2')
    .replace(/<(https?:[^>]+)>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

export class Feeds {
  private secrets: Secrets = {};
  private file: string;
  private quotes = new Map<string, Quote>();
  private tickerAt = 0;
  private errors: IntegrationsState['errors'] & { ticker?: string } = {};
  private timers: NodeJS.Timeout[] = [];
  /** Slack: who's who, and where the workspace is (for links to messages). */
  private names = new Map<string, string>();
  private workspace?: string;

  constructor(
    dataDir: string,
    private out: FeedsOut,
  ) {
    this.file = path.join(dataDir, 'integrations.json');
    try {
      if (existsSync(this.file)) this.secrets = JSON.parse(readFileSync(this.file, 'utf8')) as Secrets;
    } catch {
      // unreadable: signed in to nothing
    }
  }

  start() {
    const every = (ms: number, fn: () => Promise<void>) => {
      const run = () => void fn().catch(() => {});
      const t = setInterval(run, ms);
      t.unref();
      this.timers.push(t);
      // Soon after the floors are open, not an interval from now.
      setTimeout(run, 1500).unref();
    };
    every(TICKER_MS, () => this.readTicker());
    every(SLACK_MS, () => this.readSlack());
    every(METRICOOL_MS, () => this.readMetricool());
  }

  stop() {
    for (const t of this.timers) clearInterval(t);
  }

  state(): IntegrationsState {
    const { slack, metricool } = this.errors;
    return { slack: !!this.secrets.slack, metricool: !!this.secrets.metricool, errors: { ...(slack ? { slack } : {}), ...(metricool ? { metricool } : {}) } };
  }

  /** Signs the office in to Slack or Metricool, or out again with nothing: admins do it, in ⚙️ on the floor's boards. */
  signIn(what: { slack?: unknown; metricool?: unknown }) {
    if (what.slack !== undefined) {
      const token = typeof what.slack === 'string' ? what.slack.trim().slice(0, 300) : '';
      if (token) this.secrets.slack = token;
      else delete this.secrets.slack;
      delete this.errors.slack;
      this.workspace = undefined;
    }
    if (what.metricool !== undefined) {
      const m = what.metricool && typeof what.metricool === 'object' ? (what.metricool as Record<string, unknown>) : {};
      const [token, userId, blogId] = [m.token, m.userId, m.blogId].map((v) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim().slice(0, 300) : ''));
      if (token && userId && blogId) this.secrets.metricool = { token, userId, blogId };
      else delete this.secrets.metricool;
      delete this.errors.metricool;
    }
    try {
      writeFileSync(this.file, JSON.stringify(this.secrets, null, 2), { mode: 0o600 });
    } catch {
      // kept until the office closes, at least
    }
    this.out.integrations(this.state());
    void this.readSlack().catch(() => {});
    void this.readMetricool().catch(() => {});
  }

  /** The prices a floor's ticker shows: its symbols', in its order. */
  ticker(symbols: readonly string[]): TickerState {
    const quotes = symbols.flatMap((s) => this.quotes.get(s) ?? []);
    return { quotes, at: this.tickerAt, ...(this.errors.ticker && !quotes.length ? { error: this.errors.ticker } : {}) };
  }

  /** A floor's ticker has new symbols: read them now rather than at the next minute. */
  refreshTicker() {
    void this.readTicker().catch(() => {});
  }

  private async readTicker() {
    const floors = [...this.out.floors()];
    const symbols = [...new Set(floors.flatMap((f) => f.studio.symbols()))];
    if (!symbols.length) return;
    const before = JSON.stringify([...this.quotes]);
    const read = await Promise.allSettled(symbols.map(quote));
    read.forEach((r, i) => r.status === 'fulfilled' && r.value && this.quotes.set(symbols[i], r.value));
    const failed = read.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    this.errors.ticker = read.some((r) => r.status === 'fulfilled' && r.value) ? undefined : `The market's prices couldn't be read${failed ? `: ${(failed.reason as Error).message}` : ''}`;
    this.tickerAt = Date.now();
    if (JSON.stringify([...this.quotes]) !== before || this.errors.ticker) for (const f of floors) if (f.studio.symbols().length) this.out.ticker(f);
  }

  private async slack(method: string, params: Record<string, string>): Promise<Record<string, unknown>> {
    const data = (await getJson(`https://slack.com/api/${method}?${new URLSearchParams(params)}`, { authorization: `Bearer ${this.secrets.slack}` })) as Record<string, unknown>;
    if (!data.ok) throw new Error(`Slack says ${String(data.error ?? 'no')}`);
    return data;
  }

  /** The channels the office's Slack sign-in can read, for picking which a board watches. */
  async slackChannels(): Promise<SlackChannel[] | string> {
    if (!this.secrets.slack) return 'Sign the office in to Slack first';
    try {
      const out: SlackChannel[] = [];
      let cursor = '';
      for (let page = 0; page < 5; page++) {
        const data = await this.slack('conversations.list', { types: 'public_channel,private_channel', exclude_archived: 'true', limit: '200', ...(cursor ? { cursor } : {}) });
        for (const c of (data.channels as { id: string; name: string }[]) ?? []) out.push({ id: c.id, name: c.name });
        cursor = (data.response_metadata as { next_cursor?: string } | undefined)?.next_cursor ?? '';
        if (!cursor) break;
      }
      return out.sort((a, b) => a.name.localeCompare(b.name));
    } catch (err) {
      return (err as Error).message;
    }
  }

  private async nameOf(user: string): Promise<string> {
    const known = this.names.get(user);
    if (known) return known;
    let name = 'someone';
    try {
      const u = (await this.slack('users.info', { user })).user as { real_name?: string; name?: string; profile?: { display_name?: string } };
      name = u.profile?.display_name || u.real_name || u.name || name;
    } catch {
      // nameless
    }
    this.names.set(user, name);
    return name;
  }

  private async readSlack() {
    const watching = [...this.out.floors()].flatMap((floor) => floor.studio.feeds().flatMap((f) => (f.feed.kind === 'slack' ? [{ floor, board: f.board, channels: f.feed.channels }] : [])));
    if (!watching.length) return;
    if (!this.secrets.slack) {
      for (const w of watching) if (w.floor.studio.fill(w.board, [])) this.out.studio(w.floor);
      return;
    }
    try {
      this.workspace ??= String((await this.slack('auth.test', {})).url ?? '');
      // Each channel once, however many boards watch it.
      const read = new Map<string, Omit<Post, 'board'>[]>();
      for (const ch of new Map(watching.flatMap((w) => w.channels).map((c) => [c.id, c])).values()) {
        const data = await this.slack('conversations.history', { channel: ch.id, limit: String(PER_CHANNEL) });
        const posts: Omit<Post, 'board'>[] = [];
        for (const m of (data.messages as { ts: string; text?: string; user?: string; subtype?: string; bot_profile?: { name?: string }; username?: string }[]) ?? []) {
          if (m.subtype && m.subtype !== 'bot_message' && m.subtype !== 'thread_broadcast') continue;
          const by = m.user ? await this.nameOf(m.user) : (m.bot_profile?.name ?? m.username ?? 'a bot');
          const text = plain(m.text ?? '', this.names) || '(an attachment)';
          posts.push({ id: `${ch.id}-${m.ts}`.slice(0, 40), title: text.slice(0, 140), ...(text.length > 140 ? { body: text.slice(0, 600) } : {}), source: `#${ch.name}`, by, at: Math.round(Number(m.ts) * 1000), ...(this.workspace ? { url: `${this.workspace}archives/${ch.id}/p${m.ts.replace('.', '')}` } : {}) });
        }
        read.set(ch.id, posts);
      }
      delete this.errors.slack;
      for (const w of watching) {
        const posts = w.channels.flatMap((c) => read.get(c.id) ?? []).sort((a, b) => b.at - a.at);
        if (w.floor.studio.fill(w.board, posts)) this.out.studio(w.floor);
      }
    } catch (err) {
      const was = this.errors.slack;
      this.errors.slack = (err as Error).message;
      if (was !== this.errors.slack) this.out.integrations(this.state());
    }
  }

  /** One of a brand's numbers on Metricool over the last `days`: its latest value, and how far it's come. */
  private async metric(network: string, metric: string, days: number): Promise<{ now: number; change: number } | undefined> {
    const m = this.secrets.metricool!;
    const to = new Date();
    const from = new Date(to.getTime() - days * 86_400_000);
    const iso = (d: Date) => d.toISOString().slice(0, 19);
    const data = (await getJson(`https://app.metricool.com/api/v2/analytics/timelines?${new URLSearchParams({ from: iso(from), to: iso(to), metric, network, subject: 'account', timezone: 'UTC', userId: m.userId, blogId: m.blogId })}`, { 'x-mc-auth': m.token })) as { data?: { values?: { value?: number }[] }[] };
    const values = (data.data?.[0]?.values ?? []).map((v) => v.value).filter((v): v is number => typeof v === 'number');
    if (!values.length) return undefined;
    // Newest first, as Metricool sends them.
    return { now: values[0], change: values[0] - values[values.length - 1] };
  }

  private async readMetricool() {
    const showing = [...this.out.floors()].flatMap((floor) => floor.studio.feeds().flatMap((f) => (f.feed.kind === 'metricool' ? [{ floor, board: f.board }] : [])));
    if (!showing.length) return;
    const posts: Omit<Post, 'board'>[] = [];
    if (this.secrets.metricool) {
      const wanted: [network: string, metric: string, label: string, icon: string][] = [
        ['instagram', 'followers', 'Instagram followers', '📸'],
        ['instagram', 'reach', 'Instagram reach today', '👀'],
        ['youtube', 'totalSubscribers', 'YouTube subscribers', '▶️'],
        ['youtube', 'views', 'YouTube views today', '📺'],
        ['tiktok', 'followers_count', 'TikTok followers', '🎵'],
        ['linkedin', 'followers', 'LinkedIn followers', '💼'],
      ];
      const fmt = (n: number) => (Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : Math.abs(n) >= 1e4 ? `${(n / 1e3).toFixed(1)}K` : Math.round(n).toLocaleString('en-US'));
      const read = await Promise.allSettled(wanted.map(([network, metric]) => this.metric(network, metric, 7)));
      read.forEach((r, i) => {
        if (r.status !== 'fulfilled' || !r.value) return;
        const [, , label, icon] = wanted[i];
        const { now, change } = r.value;
        posts.push({ id: `mc-${i}`, title: `${icon} ${fmt(now)} ${label}`, body: `${change >= 0 ? '▲' : '▼'} ${fmt(Math.abs(change))} in the last 7 days`, source: 'Metricool', by: 'Metricool', at: Date.now() - i });
      });
      const failed = read.find((r): r is PromiseRejectedResult => r.status === 'rejected');
      const was = this.errors.metricool;
      this.errors.metricool = posts.length ? undefined : `Metricool gave no numbers${failed ? `: ${(failed.reason as Error).message}` : ''}`;
      if (was !== this.errors.metricool) this.out.integrations(this.state());
      if (!posts.length) return;
    }
    for (const s of showing) if (s.floor.studio.fill(s.board, posts)) this.out.studio(s.floor);
  }
}
