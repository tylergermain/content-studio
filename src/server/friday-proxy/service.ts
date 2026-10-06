import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FridayProxyQuota, FridayProxyState } from '../../shared/protocol.js';
import { httpProxyApi, readQuota, type ProxyApi } from './quota.js';
import { normalizeProxyUrl, setInferenceSource, type InferenceRoute, type RoutedProvider } from './route.js';

/** How often every account's quota is read again while anyone's in the office. */
const EVERY_MS = 5 * 60_000;
/** A refresh asked for sooner than this after the last one reuses it. */
const MIN_GAP_MS = 20_000;

export const DEFAULT_PROXY_URL = 'http://127.0.0.1:8317';

interface Saved {
  url: string;
  apiKey?: string;
  managementKey?: string;
  codex: boolean;
  claude: boolean;
  by?: string;
  at?: number;
}

export interface ProxyPatch {
  url?: string;
  apiKey?: string;
  managementKey?: string;
  codex?: boolean;
  claude?: boolean;
}

/**
 * Friday Proxy (a CLIProxyAPI fork pooling several Claude and ChatGPT subscriptions): whether Codex and
 * Claude workers run their inference through it, set by admins in ⚙️ Settings and kept, keys and all,
 * in .agent-office/friday-proxy.json (0600). It also reads every proxy account's quota for the ⚡ panel.
 * Off until an admin turns it on; a worker started before a change keeps what it started with.
 */
export class FridayProxy {
  private saved: Saved = { url: DEFAULT_PROXY_URL, codex: false, claude: false };
  private quota: FridayProxyQuota = { at: 0, accounts: [] };
  private file: string;
  private claudeHome: string;
  private timer?: NodeJS.Timeout;
  private reading?: Promise<void>;

  constructor(
    dataDir: string,
    private onState: (state: FridayProxyState) => void,
    private onQuota: (quota: FridayProxyQuota) => void,
    /** Whether anyone's here to see the quota (it isn't read for nobody). */
    private watched: () => boolean = () => true,
    private api: (url: string, managementKey: string) => ProxyApi = httpProxyApi,
  ) {
    this.file = path.join(dataDir, 'friday-proxy.json');
    this.claudeHome = path.join(dataDir, 'friday-proxy', 'claude');
    this.restore();
    setInferenceSource((p) => this.route(p));
  }

  /** Where `provider`'s workers send their inference: the proxy when it's on for them and has a key. */
  route(provider: RoutedProvider): InferenceRoute | undefined {
    const s = this.saved;
    return s[provider] && s.apiKey ? { baseUrl: s.url, apiKey: s.apiKey, ...(provider === 'claude' ? { claudeHome: this.claudeHome } : {}) } : undefined;
  }

  state(): FridayProxyState {
    const s = this.saved;
    return { url: s.url, hasApiKey: !!s.apiKey, hasManagementKey: !!s.managementKey, codex: s.codex, claude: s.claude, by: s.by, at: s.at };
  }

  lastQuota(): FridayProxyQuota {
    return this.quota;
  }

  /** Changes the settings; a message saying what's wrong, or undefined once they're saved. */
  set(patch: ProxyPatch, by: string): string | undefined {
    const next = { ...this.saved };
    if (patch.url !== undefined) {
      const url = normalizeProxyUrl(patch.url);
      if (!url) return 'The proxy address is an http(s) URL, like http://127.0.0.1:8317';
      next.url = url;
    }
    for (const k of ['apiKey', 'managementKey'] as const) {
      const v = patch[k];
      if (v === undefined) continue;
      if (v.length > 512 || /\s/.test(v)) return 'A key is one word, at most 512 characters';
      next[k] = v || undefined;
    }
    if (patch.codex !== undefined) next.codex = patch.codex;
    if (patch.claude !== undefined) next.claude = patch.claude;
    if ((next.codex || next.claude) && !next.apiKey) return 'Add the proxy’s API key first: workers sign in to it with that';
    this.saved = { ...next, by, at: Date.now() };
    this.persist();
    this.onState(this.state());
    void this.refresh(true);
    return undefined;
  }

  start() {
    void this.refresh(true);
    this.timer = setInterval(() => {
      if (this.watched()) void this.refresh(true);
    }, EVERY_MS);
    this.timer.unref?.();
  }

  stop() {
    clearInterval(this.timer);
  }

  /** Reads every account's quota again, unless that was just done (or `force`). */
  refresh(force = false): Promise<void> {
    if (this.reading) return this.reading;
    if (!force && Date.now() - this.quota.at < MIN_GAP_MS) {
      this.onQuota(this.quota);
      return Promise.resolve();
    }
    const { url, managementKey } = this.saved;
    if (!managementKey) {
      this.publish({ at: Date.now(), accounts: [], error: 'Add the proxy’s management key in ⚙️ Settings → Workers to see its accounts' });
      return Promise.resolve();
    }
    this.reading = readQuota(this.api(url, managementKey))
      .then((q) => this.publish(q))
      .catch((e) => {
        const why = e instanceof Error ? e.message : String(e);
        const down = /fetch failed|ECONNREFUSED|timed? ?out|aborted/i.test(why);
        this.publish({ at: Date.now(), accounts: this.quota.accounts, error: down ? `Friday Proxy isn’t answering at ${url}` : why });
      })
      .finally(() => {
        this.reading = undefined;
      });
    return this.reading;
  }

  private publish(q: FridayProxyQuota) {
    this.quota = q;
    this.onQuota(q);
  }

  private restore() {
    try {
      const s = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Saved>;
      const url = typeof s.url === 'string' ? normalizeProxyUrl(s.url) : undefined;
      this.saved = {
        url: url ?? DEFAULT_PROXY_URL,
        apiKey: typeof s.apiKey === 'string' && s.apiKey ? s.apiKey : undefined,
        managementKey: typeof s.managementKey === 'string' && s.managementKey ? s.managementKey : undefined,
        codex: s.codex === true,
        claude: s.claude === true,
        by: typeof s.by === 'string' ? s.by : undefined,
        at: typeof s.at === 'number' ? s.at : undefined,
      };
    } catch {
      // never set: workers use their own sign-ins
    }
  }

  private persist() {
    try {
      writeFileSync(this.file, JSON.stringify(this.saved, null, 2), { mode: 0o600 });
    } catch {
      // disk issues shouldn't take the office down
    }
  }
}
