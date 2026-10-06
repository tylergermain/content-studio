// Friday Proxy: the local CLIProxyAPI that workers' inference can go through, and its accounts' quota.

/** One usage window of a proxy account: how much of it is left. */
export interface ProxyWindow {
  id: string;
  label: string;
  /** Percent left, 0–100; null when the provider didn't say. */
  remaining: number | null;
  /** When it starts over (ms). */
  resetAt?: number;
  /** Said instead of the reset time, for an allowance in dollars: "$12 of $100 this month". */
  detail?: string;
}

/** Something worth knowing about an account at a glance: a limit reached, credits covering it, resets left. */
export interface ProxyFlag {
  tone: 'ok' | 'bad' | '';
  text: string;
}

/** One subscription account signed in to the proxy, with its live quota. */
export interface ProxyAccount {
  id: string;
  /** claude, codex, kimi, xai… */
  provider: string;
  /** Its auth file's name, with the email partly hidden. */
  name: string;
  plan?: string;
  disabled?: boolean;
  /** `unsupported`: the proxy has no way to read this provider's quota. */
  status: 'ok' | 'error' | 'unsupported';
  error?: string;
  windows: ProxyWindow[];
  flags: ProxyFlag[];
}

/** Every proxy account's quota, as last read. */
export interface FridayProxyQuota {
  at: number;
  accounts: ProxyAccount[];
  /** Why there's nothing to show: no management key, the proxy isn't running… */
  error?: string;
}

/** The office's Friday Proxy settings (⚙️ Settings → Workers), without its keys. */
export interface FridayProxyState {
  url: string;
  hasApiKey: boolean;
  hasManagementKey: boolean;
  /** Whether Codex and Claude workers (and the assistant, with Codex) run their inference through it. */
  codex: boolean;
  claude: boolean;
  by?: string;
  at?: number;
}

export type FridayProxyClientMsg =
  /** Send me the settings and the last quota read (sent on arrival). */
  | { t: 'fridayProxy.get' }
  /** Read every account's quota again now. */
  | { t: 'fridayProxy.refresh' }
  /** Admins: change the settings. A key left out stays as it is; '' removes it. */
  | { t: 'fridayProxy.set'; url?: string; apiKey?: string; managementKey?: string; codex?: boolean; claude?: boolean };

export type FridayProxyServerMsg = { t: 'fridayProxy'; state: FridayProxyState } | { t: 'fridayProxy.quota'; quota: FridayProxyQuota };
