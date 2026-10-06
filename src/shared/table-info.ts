import type { GhPull } from './protocol.js';

// A project table's panel (server/table-info.ts, client/ui/table-info/): what E at its screen opens. Every branch of
// its repository with who's on it, its pull request and its app as it is now, and the repository's pull requests,
// issues and latest commits. No Node and no DOM here: both sides read it.

/** Something on a branch to look at: an agent's server, or (for the default branch) the table's app address. */
export interface BranchApp {
  /** What its picture is kept under, after the room's id (server/room-screens.ts): live, b-<branch> for a preview, p<port>, or url. */
  key: string;
  label: string;
  /** The live site, a branch's preview, or something running on the office's computer. */
  kind: 'live' | 'preview' | 'local';
  port?: number;
  url?: string;
}

/** Where a branch is deployed (server/deploys.ts): the live site (the default branch's), or a branch's preview. */
export interface Deploy {
  env: 'production' | 'preview';
  /** The branch it was built from, and the commit, when the host says. */
  branch?: string;
  sha?: string;
  url: string;
  state: 'ready' | 'building' | 'error' | 'canceled';
  /** When it was made (ms). */
  at: number;
  /** Who hosts it, and its page there. */
  from: 'vercel' | 'github';
  inspect?: string;
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
  /** Where it's deployed: the live site on the default branch, its newest preview on any other. */
  deploys: Deploy[];
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
  /** The live site, if it has one: Vercel's production address, else the table's own app address when that's not on this computer. */
  live?: string;
  /** Previews of branches the repository hasn't (or that are another repository's): newest first. */
  previews: Deploy[];
  /** The office's Vercel sign-in: whether it has one and who as, the project this table's deploys come from, and (for admins) the projects to pick from. */
  vercel: { connected: boolean; user?: string; project?: string; projects?: string[] };
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

const LOCAL = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(?::\d{1,5})?(?:\/|$)/i;
/** Whether an address is on this computer (a dev server), rather than somewhere anyone can reach (a deployment). */
export const isLocal = (url: string) => LOCAL.test(url);

/** What a branch's preview's picture is kept under (server/room-screens.ts): `b-` and its name, as a file name can have it. */
export const previewKey = (branch: string) => `b-${branch.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 60)}`;

/** A branch name as git allows it, to look one up by: no spaces, control characters or leading dash. */
export const BRANCH_NAME = /^(?!-)(?!.*\.\.)[^\s\x00-\x1f\x7f~^:?*[\\]{1,200}$/;

/** The first request of an agent hired to run a branch's app at a table, so it shows on the table's screen and in its panel. */
export function runBranchTask(table: string, branch: string): string {
  return `Get the app on the branch ${branch} running so it can be seen and reviewed at ${table}'s table. In your worktree, fetch it if it's on GitHub (git fetch origin ${branch}) and switch to its latest without taking it over: git switch --detach origin/${branch} (or git switch --detach ${branch} when it's only here). Install its packages there, run its dev server on a free port and leave it running: the table's screen and panel show it as soon as it answers. Say the address when it's up, and if it needs settings or keys it doesn't have, say which. Don't commit onto ${branch}: if something needs changing, ask first.`;
}
