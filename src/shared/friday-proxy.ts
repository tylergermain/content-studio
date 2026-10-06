// How Friday Proxy quota adds up, the same on the server and in the browser.
import type { ProxyAccount, ProxyWindow } from './protocol/friday-proxy.js';

/** The window a provider's summary leads with, first found first. */
export const HEADLINE: Record<string, readonly string[]> = {
  claude: ['fable', '7d', '5h'],
  codex: ['weekly', 'monthly', '5h'],
};

/** Windows that cap another: Fable 5 can't be used once the account's 7-day limit is spent. */
const CAPS: Record<string, Record<string, readonly string[]>> = { claude: { fable: ['7d'] } };

/** What's really left of window `id`: no more than what caps it. */
export function effectiveRemaining(provider: string, windows: readonly ProxyWindow[], id: string): number | null {
  const w = windows.find((x) => x.id === id);
  if (!w || w.remaining == null) return null;
  let v = w.remaining;
  for (const capId of CAPS[provider]?.[id] ?? []) {
    const cap = windows.find((x) => x.id === capId);
    if (cap?.remaining != null) v = Math.min(v, cap.remaining);
  }
  return v;
}

/** green, amber or red for a share left. */
export function quotaTone(remaining: number | null | undefined): 'g' | 'a' | 'r' | 'none' {
  if (remaining == null) return 'none';
  if (remaining >= 65) return 'g';
  if (remaining >= 25) return 'a';
  return 'r';
}

/** One provider's accounts added up on its headline window: each account's share left, and the total. */
export interface ProviderSummary {
  provider: string;
  label: string;
  /** Per account (enabled ones), its effective share left, null when unknown. */
  shares: (number | null)[];
  /** The sum of what's known, out of shares.length × 100. */
  total: number;
  known: number;
  soonest?: number;
}

export function summarize(provider: string, accounts: readonly ProxyAccount[]): ProviderSummary {
  const active = accounts.filter((a) => !a.disabled);
  const seen: ProxyWindow[] = [];
  for (const a of active) for (const w of a.windows) if (!seen.some((s) => s.id === w.id)) seen.push(w);
  const pick = (HEADLINE[provider] ?? []).find((id) => seen.some((w) => w.id === id)) ?? seen[0]?.id;
  const label = seen.find((w) => w.id === pick)?.label ?? 'Quota';
  let total = 0;
  let known = 0;
  let soonest: number | undefined;
  const now = Date.now();
  const shares = active.map((a) => {
    if (!pick) return null;
    const v = effectiveRemaining(provider, a.windows, pick);
    if (v == null) return null;
    total += v;
    known += 1;
    const at = a.windows.find((w) => w.id === pick)?.resetAt;
    if (at && at > now && (soonest === undefined || at < soonest)) soonest = at;
    return v;
  });
  return { provider, label, shares, total, known, soonest };
}
