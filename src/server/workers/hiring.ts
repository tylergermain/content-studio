import type { AgentProvider, WorkerKind } from '../../shared/protocol.js';
import type { WorkerProject } from '../../shared/project-rooms.js';
import { STATION_AGENT, type DeskDef } from '../../shared/layout.js';
import type { RepoSource } from './types.js';

/** The most other repositories one worker can take on (see WorkerInfo.repos). */
export const MAX_REPOS = 8;

/** What's asked of a hire at a desk (see WorkerManager.spawn), for the checks made before anything's made for it. */
export interface SeatAsk {
  kind: WorkerKind;
  prompt?: string;
  worktree: boolean;
  meeting: boolean;
  repos: RepoSource[];
  /** The provider asked for; none for a shell. */
  provider?: AgentProvider;
  /** The office's configured one (see WorkerManager.defaultProvider). */
  configured: AgentProvider;
  /** Someone's there already. */
  occupied: boolean;
  /** What the floor calls a board agent's kiosk. */
  stationName?: string;
  /** The project room the desk is in (see shared/project-rooms.ts). */
  project?: WorkerProject;
}

/** Why a worker can't be hired at `seat` as asked; nothing when it can. */
export function seatProblem(seat: DeskDef, a: SeatAsk): string | undefined {
  if (a.occupied) return seat.station ? `The ${a.stationName ?? STATION_AGENT[seat.station].name} is already there` : `That ${seat.beanbag ? 'bean bag' : 'desk'} is taken`;
  if (a.kind === 'shell' && seat.station) return 'A board agent is always an agent, not a shell';
  if (seat.station && !a.prompt?.trim()) return 'Tell the board agent what to do';
  if (!seat.room !== !a.meeting) return seat.room ? 'Only a meeting seats workers at the meeting table: call one in the meeting room' : 'A meeting seats its workers at the meeting table';
  if (a.meeting && (a.kind !== 'agent' || a.worktree)) return 'A meeting seats agents, in its own worktree';
  if (a.repos.length && (a.kind !== 'agent' || !a.worktree || seat.station || a.meeting)) return 'Only a worker in its own worktree can work in other repositories too';
  if (a.repos.length > MAX_REPOS) return `A worker can take on at most ${MAX_REPOS} other repositories`;
  if (a.kind === 'shell' && a.provider !== undefined) return 'Shell workers do not have an agent provider';
  if (a.kind === 'agent' && a.provider === 'custom' && a.configured !== 'custom') return 'Custom is not the configured agent provider';
  // A worktree is the floor's own repository's, which isn't the room's project.
  if (a.project?.dir && a.worktree) return `Workers in the ${a.project.name} room work in its project folder: hire without a worktree of this floor`;
  return undefined;
}
