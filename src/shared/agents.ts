import type { WorkerInfo } from './protocol/workers.js';

// The Agents panel (client/features/agents/): every worker on every floor in one place, from GET /api/agents
// (server/http/routes/agents.ts). No Node and no DOM here: both sides read it.

/** A worker as the panel lists it: where it is, whether you may direct it, and the web servers it's running. */
export interface AgentRow extends WorkerInfo {
  floor: string;
  floorName: string;
  /** You may message it, interrupt it, wake it or send it home (an admin, or its owner within their roles). */
  canControl: boolean;
  apps: { port: number; title: string }[];
}

export interface AgentsView {
  floors: { id: string; name: string }[];
  agents: AgentRow[];
}

/** Which agents a filter shows. */
export type AgentFilter = 'all' | 'needs' | 'working' | 'ready' | 'asleep';

export function agentFilter(a: Pick<WorkerInfo, 'status'>, f: AgentFilter): boolean {
  if (f === 'all') return true;
  if (f === 'needs') return a.status === 'needs_input' || a.status === 'done';
  if (f === 'working') return a.status === 'working' || a.status === 'starting';
  if (f === 'ready') return a.status === 'idle';
  return a.status === 'offline' || a.status === 'exited';
}

/** Needs you first (the longest waiting first), then working, then ready, then asleep; by name within each. */
export function agentOrder(a: Pick<WorkerInfo, 'status' | 'name' | 'waitingSince'>, b: Pick<WorkerInfo, 'status' | 'name' | 'waitingSince'>): number {
  const rank = (s: string) => (s === 'needs_input' ? 0 : s === 'done' ? 1 : s === 'working' || s === 'starting' ? 2 : s === 'idle' ? 3 : 4);
  return rank(a.status) - rank(b.status) || (a.waitingSince ?? Infinity) - (b.waitingSince ?? Infinity) || a.name.localeCompare(b.name);
}

/** What a search matches: the name, the floor, the task, what it's doing, its model and its branch. */
export function agentMatches(a: AgentRow, q: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = [a.name, a.floorName, a.task?.name, a.task?.summary, a.activity, a.title, a.prompt, a.provider, a.model, a.usage?.model, a.specialist, a.worktree?.branch, a.project?.name].filter(Boolean).join(' ').toLowerCase();
  return words.every((w) => hay.includes(w));
}
