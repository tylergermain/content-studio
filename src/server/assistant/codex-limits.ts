import { open, readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { windowLabel, type PlanUsage } from '../../shared/assistant.js';

// Codex's plan usage, as Codex itself last saw it: every turn's token_count event in a session's rollout carries the
// plan's rate limits (how much of each window is used, when it starts again) and the credits left. The newest
// rollout under CODEX_HOME/sessions that has them says where the plan stands now.

const TAIL = 512 * 1024;
const CACHE_MS = 60_000;
let cached: { at: number; usage?: PlanUsage } | undefined;

interface Window { used_percent?: unknown; window_minutes?: unknown; resets_at?: unknown }

/** The plan usage in one token_count event's rate_limits, or undefined when it says nothing. */
export function codexPlan(rateLimits: unknown, at: number): PlanUsage | undefined {
  const r = (rateLimits && typeof rateLimits === 'object' ? rateLimits : {}) as Record<string, unknown>;
  const windows = [r.primary, r.secondary].flatMap((w) => {
    const x = (w && typeof w === 'object' ? w : {}) as Window;
    const pct = Number(x.used_percent), minutes = Number(x.window_minutes), resets = Number(x.resets_at);
    return Number.isFinite(pct) && minutes > 0 ? [{ label: windowLabel(minutes), pct, ...(resets > 0 ? { resetsAt: resets * 1000 } : {}), minutes }] : [];
  }).sort((a, b) => a.minutes - b.minutes).map(({ minutes: _, ...w }) => w);
  if (!windows.length) return undefined;
  const credits = (r.credits && typeof r.credits === 'object' ? r.credits : {}) as Record<string, unknown>;
  const balance = typeof credits.balance === 'string' && credits.has_credits !== false && !credits.unlimited ? credits.balance : undefined;
  return { provider: 'codex', ...(typeof r.plan_type === 'string' ? { plan: r.plan_type } : {}), windows, ...(balance ? { credits: String(Math.round(Number(balance))) } : {}), at };
}

/** The newest rollouts first: year, month and day folders newest first, then the files in them. */
async function newest(root: string, want: number): Promise<string[]> {
  const out: string[] = [];
  const names = async (dir: string) => (await readdir(dir).catch(() => [] as string[])).sort().reverse();
  for (const y of await names(root)) {
    for (const m of await names(path.join(root, y))) {
      for (const d of await names(path.join(root, y, m))) {
        const dir = path.join(root, y, m, d);
        const files = (await names(dir)).filter((f) => f.startsWith('rollout-') && f.endsWith('.jsonl'));
        const timed = await Promise.all(files.map(async (f) => ({ f: path.join(dir, f), t: (await stat(path.join(dir, f)).catch(() => undefined))?.mtimeMs ?? 0 })));
        out.push(...timed.sort((a, b) => b.t - a.t).map((x) => x.f));
        if (out.length >= want) return out.slice(0, want);
      }
    }
  }
  return out;
}

/** Codex's plan usage now, read again at most once a minute. */
export async function codexPlanUsage(home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex')): Promise<PlanUsage | undefined> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.usage;
  let usage: PlanUsage | undefined;
  for (const file of await newest(path.join(home, 'sessions'), 12)) {
    try {
      const fh = await open(file, 'r');
      try {
        const { size, mtimeMs } = await fh.stat();
        const start = Math.max(0, size - TAIL);
        const buf = Buffer.alloc(size - start);
        await fh.read(buf, 0, buf.length, start);
        const lines = buf.toString('utf8').split('\n').filter((l) => l.includes('"rate_limits"'));
        for (const line of lines.reverse()) {
          try {
            const e = JSON.parse(line) as { timestamp?: string; payload?: { rate_limits?: unknown } };
            usage = codexPlan(e.payload?.rate_limits, Date.parse(e.timestamp ?? '') || mtimeMs);
          } catch {
            /* a line cut by the tail */
          }
          if (usage) break;
        }
      } finally {
        await fh.close();
      }
    } catch {
      /* gone, or not readable */
    }
    if (usage) break;
  }
  cached = { at: Date.now(), usage };
  return usage;
}
