import type { GhPull } from './protocol.js';

// A project table's panel (server/table-info.ts, client/ui/table-info/): what E at its screen opens. Every branch of
// its repository with who's on it, its pull request and its app as it is now, and the repository's pull requests,
// issues and latest commits. No Node and no DOM here: both sides read it.

/** Something on a branch to look at: an agent's server, or (for the default branch) the table's app address. */
export interface BranchApp {
  /** What its picture is kept under, after the room's id (server/room-screens.ts): p<port>, or url. */
  key: string;
  label: string;
  port?: number;
  url?: string;
}

export interface BranchAgent {
  id: string;
  name: string;
  status: string;
  /** What it's on, from its task card. */
  task?: string;
}

export interface TableBranch {
  name: string;
  /** The repository's default branch, which the others are measured against. */
  base?: true;
  /** A worktree that isn't on a branch: what `name` is then is its commit. */
  detached?: true;
  /** Its last commit. */
  sha: string;
  subject: string;
  author: string;
  /** When that was committed (ms). */
  at: number;
  /** Commits it has that the default branch doesn't, and the other way round; absent for that branch itself, or when git couldn't say. */
  ahead?: number;
  behind?: number;
  /** In the table's checkout, on GitHub, or both. */
  local?: true;
  remote?: true;
  /** The table's agents working on it now: in a worktree on it, or in the table's checkout. */
  agents: BranchAgent[];
  /** Files changed in those agents' worktrees that aren't committed yet. */
  dirty?: number;
  /** Its pull request: the open one, else the latest merged or closed. */
  pull?: number;
  /** What's running on it now. */
  apps: BranchApp[];
}

export type TablePull = Pick<GhPull, 'number' | 'title' | 'state' | 'isDraft' | 'url' | 'author' | 'reviewDecision' | 'headRefName' | 'baseRefName' | 'updatedAt' | 'additions' | 'deletions' | 'checks'>;

export interface TableIssue {
  number: number;
  title: string;
  url: string;
  author: string;
  labels: { name: string; color: string }[];
  updatedAt: string;
  comments: number;
}

export interface TableCommit {
  sha: string;
  subject: string;
  author: string;
  at: number;
}

export interface TableInfo {
  room: { id: string; name: string; repo?: string; dir?: string; url?: string; seats: number; free?: string };
  /** The default branch's name. */
  base?: string;
  /** Default branch first, then the ones agents are on, then open pull requests', then the newest. */
  branches: TableBranch[];
  /** Branches left off the end of that list. */
  more?: number;
  /** Open pull requests, then the latest merged and closed. */
  pulls: TablePull[];
  /** Open issues, newest first. */
  issues: TableIssue[];
  /** The latest commits on the default branch. */
  commits: TableCommit[];
  /** When the checkout last fetched from GitHub. */
  fetchedAt?: number;
  /** What couldn't be found out, in words: no checkout, git or gh failing. */
  problems: string[];
}

export interface ChangedPath {
  path: string;
  /** A added, D deleted, R renamed, M modified, ? not tracked yet. */
  status: 'A' | 'D' | 'R' | 'M' | '?';
  added: number;
  removed: number;
}

/** A branch close up (GET /api/table-info/branch): what it has that the default branch doesn't. */
export interface BranchDetail {
  branch: string;
  /** Its commits the default branch doesn't have, newest first. */
  commits: TableCommit[];
  /** Commits past those shown. */
  moreCommits?: number;
  /** The files those commits change, against where it left the default branch. */
  files: ChangedPath[];
  moreFiles?: number;
  /** What an agent on it has changed and not committed yet. */
  uncommitted: ChangedPath[];
}

/** A branch name as git allows it, to look one up by: no spaces, control characters or leading dash. */
export const BRANCH_NAME = /^(?!-)(?!.*\.\.)[^\s\x00-\x1f\x7f~^:?*[\\]{1,200}$/;

/** The first request of an agent hired to run a branch's app at a table, so it shows on the table's screen and in its panel. */
export function runBranchTask(table: string, branch: string): string {
  return `Get the app on the branch ${branch} running so it can be seen and reviewed at ${table}'s table. In your worktree, fetch it if it's on GitHub (git fetch origin ${branch}) and switch to its latest without taking it over: git switch --detach origin/${branch} (or git switch --detach ${branch} when it's only here). Install its packages there, run its dev server on a free port and leave it running: the table's screen and panel show it as soon as it answers. Say the address when it's up, and if it needs settings or keys it doesn't have, say which. Don't commit onto ${branch}: if something needs changing, ask first.`;
}
