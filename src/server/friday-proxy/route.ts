// Where a worker's inference goes when Friday Proxy is on: what the Codex and Claude adapters (and the
// assistant) ask as they start one. The FridayProxy service answers (see ./service.ts); with no service,
// as in tests that don't set one, every worker talks to its provider directly, as it always did.
import { prepareClaudeHome } from './claude-home.js';

export type RoutedProvider = 'codex' | 'claude';

/** The proxy's address (no trailing slash) and the API key it accepts from workers. */
export interface InferenceRoute {
  baseUrl: string;
  apiKey: string;
  /** Claude workers' own config folder (see claude-home.ts): Claude Code sends a claude.ai login over the proxy's key otherwise. */
  claudeHome?: string;
}

let source: ((provider: RoutedProvider) => InferenceRoute | undefined) | undefined;

/** Who answers inferenceRoute: the FridayProxy service, once it's made. */
export function setInferenceSource(fn: typeof source) {
  source = fn;
}

/** Where `provider`'s workers send their inference now: the proxy, or undefined for their own sign-in. */
export function inferenceRoute(provider: RoutedProvider): InferenceRoute | undefined {
  return source?.(provider);
}

/** The model provider id Codex is told about, and the variable its key is read from. */
export const CODEX_PROVIDER = 'friday_proxy';
export const CODEX_KEY_ENV = 'FRIDAY_PROXY_API_KEY';

/** Codex's config overrides (`-c`) that send it through the proxy's Responses API. The key comes from the environment, never the command line. */
export function codexRouteArgs(route: InferenceRoute): string[] {
  const p = `model_providers.${CODEX_PROVIDER}`;
  return [
    '-c', `model_provider="${CODEX_PROVIDER}"`,
    '-c', `${p}.name="Friday Proxy"`,
    '-c', `${p}.base_url="${route.baseUrl}/v1"`,
    '-c', `${p}.env_key="${CODEX_KEY_ENV}"`,
    '-c', `${p}.wire_api="responses"`,
  ];
}

/** The variables that otherwise pick Claude Code's sign-in: they'd win over the proxy's token. */
const CLAUDE_SIGN_INS = ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_OAUTH_REFRESH_TOKEN', 'CLAUDE_CODE_OAUTH_FILE_DESCRIPTOR', 'CLAUDE_SECURESTORAGE_CONFIG_DIR'];

/**
 * Points Claude Code, starting in `cwd`, at the proxy. Last of all, after an account's sign-ins are
 * applied, so they don't undo it.
 */
export function claudeRouteEnv(env: Record<string, string>, route: InferenceRoute, cwd: string) {
  for (const k of CLAUDE_SIGN_INS) delete env[k];
  env.ANTHROPIC_BASE_URL = route.baseUrl;
  env.ANTHROPIC_AUTH_TOKEN = route.apiKey;
  if (route.claudeHome) {
    prepareClaudeHome(route.claudeHome, cwd);
    env.CLAUDE_CONFIG_DIR = route.claudeHome;
  }
}

/** A proxy address the office will use: http(s), nothing that could break out of Codex's TOML string. */
export function normalizeProxyUrl(raw: string): string | undefined {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return undefined;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined;
  if (u.username || u.password || u.search || u.hash) return undefined;
  const out = u.href.replace(/\/+$/, '');
  return /["\\\s]/.test(out) ? undefined : out;
}
