import { store } from '../../state';
import type { BranchDetail, TableInfo } from '../../../shared/table-info';

// What a project table's panel asks the office (server/http/routes/table-info.ts, room-screens.ts).

/** A picture of something running at a table (server/room-screens.ts): by <room>--<key>, and the TV's by room. */
export interface Shot {
  at: number;
  of: string;
}

export interface Shots {
  rooms: Record<string, Shot>;
  apps: Record<string, Shot>;
}

async function get<T>(path: string, params: Record<string, string>): Promise<T> {
  const res = await fetch(`${path}?${new URLSearchParams(params)}`, { credentials: 'same-origin', cache: 'no-store' });
  const out = await res.json().catch(() => undefined);
  if (!res.ok || !out) throw new Error(out?.error ?? 'The office didn’t answer');
  return out as T;
}

export const loadInfo = (floor: string, room: string) => get<TableInfo>('/api/table-info', { floor, room });
export const loadBranch = (floor: string, room: string, branch: string) => get<BranchDetail>('/api/table-info/branch', { floor, room, branch });
export const loadShots = (floor: string) => get<Shots>('/api/room-screens', { floor });

/** Where the picture of the app `key` at table `room` is, as taken `at`. */
export const shotUrl = (floor: string, room: string, key: string, at: number) => `/api/room-screen?${new URLSearchParams({ floor, room: `${room}--${key}`, v: String(at) })}`;

/** Hires a new agent at the table to run `branch`'s app; its name, or why not. */
export async function runBranch(floor: string, room: string, branch: string): Promise<string> {
  const res = await fetch(`/api/table-info/run?${new URLSearchParams({ floor, room })}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ branch, requestId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`, by: store.me.account?.name ?? store.profile.name }),
  });
  const out = (await res.json().catch(() => undefined)) as { hired?: { name: string }; error?: string } | undefined;
  if (!res.ok || !out?.hired) throw new Error(out?.error ?? 'The office didn’t answer');
  return out.hired.name;
}

/** A link to `repo` on GitHub: its branch, commit or comparison. */
export const github = {
  repo: (repo: string) => `https://github.com/${repo}`,
  branch: (repo: string, branch: string) => `https://github.com/${repo}/tree/${branch.split('/').map(encodeURIComponent).join('/')}`,
  commit: (repo: string, sha: string) => `https://github.com/${repo}/commit/${sha}`,
  compare: (repo: string, base: string, branch: string) => `https://github.com/${repo}/compare/${encodeURIComponent(base)}...${branch.split('/').map(encodeURIComponent).join('/')}`,
};
