import { realpathSync } from 'node:fs';
import path from 'node:path';
import { layoutFurniture } from '../shared/office-builder.js';
import type { WorkerInfo } from '../shared/protocol.js';
import type { BranchAgent, BranchApp, BranchDetail, ChangedPath, TableBranch, TableCommit, TableInfo, TableIssue, TablePull } from '../shared/table-info.js';
import { roomsOf } from './factory-rooms.js';
import { checksOf, gh } from './github.js';
import { git } from './git-read.js';
import { roomApps } from './room-screens.js';
import type { Floor } from './floor.js';
import type { Ctx } from './office/context.js';

// A project table's panel (shared/table-info.ts): every branch of its repository, from the table's checkout (which
// fetches from GitHub every couple of minutes while somebody looks), with the table's agents on each (by the branch
// their worktree is on), the pull request for it and what's running on it (server/room-screens.ts photographs those);
// and the repository's pull requests and issues, asked of GitHub at most once a minute. It's worked out when asked,
// and kept a few seconds for whoever asks next.

const FETCH_EVERY = 2 * 60_000;
const FETCH_MS = 60_000;
const GITHUB_EVERY = 60_000;
/** How long the first look at a repository waits for GitHub before answering without it. */
const GITHUB_WAIT_MS = 12_000;
const KEEP_MS = 3000;
const MAX_BRANCHES = 60;
const MAX_COMMITS = 30;
const MAX_FILES = 200;
const PULL_FIELDS = 'number,title,state,isDraft,url,author,reviewDecision,headRefName,baseRefName,updatedAt,additions,deletions,statusCheckRollup';

const real = (p: string) => {
  try {
    return realpathSync(p);
  } catch {
    return path.resolve(p);
  }
};

/** Runs `fn` over `items`, `n` at a time. */
async function eachLimit<T, R>(items: readonly T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

// ---- GitHub's copy of the branches: fetched now and then, never waited for ----

const fetches = new Map<string, { at: number; going?: Promise<void>; error?: string }>();

/** Brings the checkout's copy of GitHub's branches up to date, at most every FETCH_EVERY; what's known now is answered with. */
function freshen(dir: string): { at?: number; error?: string } {
  let f = fetches.get(dir);
  if (!f) fetches.set(dir, (f = { at: 0 }));
  if (!f.going && Date.now() - f.at > FETCH_EVERY) {
    const entry = f;
    entry.going = git(['fetch', '--prune', '--quiet', '--no-tags', 'origin'], dir, FETCH_MS)
      .then(() => void (entry.error = undefined), (e: Error) => void (entry.error = e.message))
      .finally(() => {
        entry.at = Date.now();
        entry.going = undefined;
      });
  }
  return { ...(f.at ? { at: f.at } : {}), ...(f.error ? { error: f.error } : {}) };
}

// ---- The repository's pull requests and issues, from GitHub ----

interface Hub {
  at: number;
  going?: Promise<void>;
  pulls: TablePull[];
  issues: TableIssue[];
  error?: string;
}
const hubs = new Map<string, Hub>();

const pullOf = (p: any): TablePull => ({
  number: Number(p.number),
  title: String(p.title ?? ''),
  state: String(p.state ?? ''),
  isDraft: !!p.isDraft,
  url: String(p.url ?? ''),
  author: p.author?.login ?? '',
  reviewDecision: p.reviewDecision ?? '',
  headRefName: String(p.headRefName ?? ''),
  baseRefName: String(p.baseRefName ?? ''),
  updatedAt: String(p.updatedAt ?? ''),
  additions: Number(p.additions ?? 0),
  deletions: Number(p.deletions ?? 0),
  checks: checksOf(p.statusCheckRollup),
});

async function askGitHub(repo: string, cwd: string): Promise<{ pulls: TablePull[]; issues: TableIssue[] }> {
  const [open, recent, issues] = await Promise.all([
    gh(['pr', 'list', '--repo', repo, '--state', 'open', '--limit', '50', '--json', PULL_FIELDS], cwd),
    gh(['pr', 'list', '--repo', repo, '--state', 'all', '--limit', '20', '--json', PULL_FIELDS], cwd),
    gh(['issue', 'list', '--repo', repo, '--state', 'open', '--limit', '30', '--json', 'number,title,url,author,labels,updatedAt,comments'], cwd),
  ]);
  const opened = (JSON.parse(open) as any[]).map(pullOf);
  const shut = (JSON.parse(recent) as any[]).map(pullOf).filter((p) => p.state !== 'OPEN').slice(0, 10);
  return {
    pulls: [...opened, ...shut],
    issues: (JSON.parse(issues) as any[]).map((i) => ({
      number: Number(i.number),
      title: String(i.title ?? ''),
      url: String(i.url ?? ''),
      author: i.author?.login ?? '',
      labels: (i.labels ?? []).map((l: any) => ({ name: String(l.name), color: `#${l.color ?? '888888'}` })),
      updatedAt: String(i.updatedAt ?? ''),
      comments: Array.isArray(i.comments) ? i.comments.length : Number(i.comments ?? 0),
    })),
  };
}

/** What GitHub last said of `repo`, asking again when that's a minute old; the first time, it waits for the answer a while. */
async function github(repo: string, cwd: string): Promise<Hub> {
  const key = repo.toLowerCase();
  let hub = hubs.get(key);
  if (!hub) hubs.set(key, (hub = { at: 0, pulls: [], issues: [] }));
  if (!hub.going && Date.now() - hub.at > GITHUB_EVERY) {
    const h = hub;
    h.going = askGitHub(repo, cwd)
      .then((r) => {
        h.pulls = r.pulls;
        h.issues = r.issues;
        h.error = undefined;
      }, (e: Error) => void (h.error = e.message))
      .finally(() => {
        h.at = Date.now();
        h.going = undefined;
      });
  }
  if (!hub.at && hub.going) await Promise.race([hub.going, new Promise((r) => setTimeout(r, GITHUB_WAIT_MS))]);
  return hub;
}

// ---- The checkout's branches and worktrees ----

interface Tip {
  sha: string;
  at: number;
  author: string;
  subject: string;
}
interface Ref {
  name: string;
  local?: Tip;
  remote?: Tip;
}

async function refsOf(dir: string): Promise<Map<string, Ref>> {
  const out = await git(['for-each-ref', '--format=%(refname)%00%(objectname)%00%(committerdate:unix)%00%(authorname)%00%(subject)', 'refs/heads', 'refs/remotes/origin'], dir);
  const refs = new Map<string, Ref>();
  for (const line of out.split('\n')) {
    const [ref, sha, at, author, subject] = line.split('\0');
    if (!ref || !sha) continue;
    const local = ref.startsWith('refs/heads/');
    const name = local ? ref.slice('refs/heads/'.length) : ref.slice('refs/remotes/origin/'.length);
    if (!local && name === 'HEAD') continue;
    const r = refs.get(name) ?? { name };
    r[local ? 'local' : 'remote'] = { sha, at: Number(at) * 1000, author: author ?? '', subject: subject ?? '' };
    refs.set(name, r);
  }
  return refs;
}

/** The repository's default branch: GitHub's, as the checkout knows it, else the one the checkout is on, else a usual name. */
async function baseOf(dir: string, refs: Map<string, Ref>): Promise<string | undefined> {
  const head = await git(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], dir).then((s) => s.trim().replace(/^origin\//, ''), () => '');
  if (head && refs.has(head)) return head;
  const on = await git(['rev-parse', '--abbrev-ref', 'HEAD'], dir).then((s) => s.trim(), () => '');
  if (on && on !== 'HEAD' && refs.has(on)) return on;
  return ['main', 'master', 'trunk', 'develop'].find((b) => refs.has(b));
}

/** The ref a branch is read from: the default branch as GitHub has it, any other as it is here when it's here. */
const refName = (r: Ref, base: boolean) => ((base ? r.remote : !r.local) ? `refs/remotes/origin/${r.name}` : `refs/heads/${r.name}`);
const tipOf = (r: Ref, base: boolean) => ((base ? (r.remote ?? r.local) : (r.local ?? r.remote)) as Tip);

async function worktreesOf(dir: string): Promise<Map<string, { sha: string; branch?: string }>> {
  const out = await git(['worktree', 'list', '--porcelain'], dir).catch(() => '');
  const trees = new Map<string, { sha: string; branch?: string }>();
  for (const block of out.split('\n\n')) {
    const lines = block.split('\n');
    const at = lines.find((l) => l.startsWith('worktree '))?.slice('worktree '.length);
    if (!at) continue;
    const branch = lines.find((l) => l.startsWith('branch refs/heads/'))?.slice('branch refs/heads/'.length);
    trees.set(real(at), { sha: lines.find((l) => l.startsWith('HEAD '))?.slice(5) ?? '', ...(branch ? { branch } : {}) });
  }
  return trees;
}

/** Where a table's agent works in its repository `dir`: its worktree of it, or the checkout itself; none when it works elsewhere. */
function workDir(w: WorkerInfo, dir: string): string | undefined {
  if (w.worktree) return w.worktree.root && real(w.worktree.root) === real(dir) ? path.join(w.worktree.root, w.worktree.path) : undefined;
  return w.project?.dir && real(w.project.dir) === real(dir) ? dir : undefined;
}

/** `git status --porcelain -z` as changed paths. */
function statusPaths(out: string): ChangedPath[] {
  const f = out.split('\0');
  const paths: ChangedPath[] = [];
  for (let i = 0; i < f.length; i++) {
    const rec = f[i];
    if (rec.length < 4) continue;
    const xy = rec.slice(0, 2);
    if (/[RC]/.test(xy)) i++;
    const status: ChangedPath['status'] = xy === '??' ? '?' : xy.includes('A') ? 'A' : xy.includes('D') ? 'D' : xy.includes('R') ? 'R' : 'M';
    paths.push({ path: rec.slice(3), status, added: 0, removed: 0 });
  }
  return paths;
}

const commitsOf = (out: string): TableCommit[] =>
  out.split('\n').filter(Boolean).map((l) => {
    const [sha, at, author, subject] = l.split('\0');
    return { sha, at: Number(at) * 1000, author: author ?? '', subject: subject ?? '' };
  });
const LOG_FORMAT = '--format=%H%x00%ct%x00%an%x00%s';

// ---- The panel ----

interface Table {
  id: string;
  name: string;
  repo?: string;
  dir?: string;
  url?: string;
  git: boolean;
  seats: number;
  free?: string;
  agents: WorkerInfo[];
}

function tableOf(floor: Floor, room: string): Table | undefined {
  const piece = layoutFurniture(floor.plan.state()).find((p) => p.id === room && p.kind === 'project-room');
  const view = roomsOf(floor).find((r) => r.id === room);
  if (!piece || !view) return undefined;
  const agents = view.agents.map((a) => floor.workers.get(a.id)).filter((w): w is WorkerInfo => !!w);
  return { id: room, name: view.name, repo: view.repo, dir: view.dir, url: view.url, git: !!view.git, seats: view.seats, free: view.free, agents };
}

const agentOf = (w: WorkerInfo): BranchAgent => ({ id: w.id, name: w.name, status: w.status, ...(w.task?.name ? { task: w.task.name } : {}) });

const kept = new Map<string, { at: number; info: Promise<TableInfo> }>();

/** The panel of the table `room` on `floor`, or undefined when there's no such table. */
export function tableInfo(ctx: Ctx, floor: Floor, room: string): Promise<TableInfo> | undefined {
  const table = tableOf(floor, room);
  if (!table) return undefined;
  // Kept by its checkout too, so a table set up for another repository isn't answered with the last one's.
  const key = `${floor.id}:${room}:${table.dir ?? ''}`;
  const had = kept.get(key);
  if (had && Date.now() - had.at < KEEP_MS) return had.info;
  const info = workOut(ctx, floor, table);
  kept.set(key, { at: Date.now(), info });
  info.catch(() => kept.delete(key));
  return info;
}

async function workOut(ctx: Ctx, floor: Floor, t: Table): Promise<TableInfo> {
  const info: TableInfo = {
    room: { id: t.id, name: t.name, ...(t.repo ? { repo: t.repo } : {}), ...(t.dir ? { dir: t.dir } : {}), ...(t.url ? { url: t.url } : {}), seats: t.seats, ...(t.free ? { free: t.free } : {}) },
    branches: [],
    pulls: [],
    issues: [],
    commits: [],
    problems: [],
  };
  const hub = t.repo ? github(t.repo, t.dir ?? ctx.cfg.dataDir) : undefined;
  if (t.dir && t.git) await branches(ctx, floor, t, info).catch((e: Error) => info.problems.push(`git couldn't read ${t.dir}: ${e.message}`));
  else info.problems.push(t.repo ? `${t.name} isn't checked out on the office's computer yet` : `${t.name} isn't set up for a repository yet: an admin sets it up in the Rooms panel`);
  if (hub) {
    const h = await hub;
    info.pulls = h.pulls;
    info.issues = h.issues;
    if (h.error) info.problems.push(`GitHub didn't answer: ${h.error}`);
    // Each branch's pull request: its open one, else the latest.
    for (const b of info.branches) {
      const pr = h.pulls.find((p) => p.headRefName === b.name && p.state === 'OPEN') ?? h.pulls.find((p) => p.headRefName === b.name);
      if (pr && !b.base) b.pull = pr.number;
    }
    info.branches = order(info.branches, h.pulls);
  }
  return info;
}

async function branches(ctx: Ctx, floor: Floor, t: Table, info: TableInfo) {
  const dir = t.dir!;
  const fetched = freshen(dir);
  if (fetched.at) info.fetchedAt = fetched.at;
  if (fetched.error) info.problems.push(`Couldn't fetch from GitHub: ${fetched.error}`);
  const [refs, trees] = await Promise.all([refsOf(dir), worktreesOf(dir)]);
  const base = await baseOf(dir, refs);
  if (base) info.base = base;
  const baseRef = base ? refName(refs.get(base)!, true) : undefined;
  const list = new Map<string, TableBranch>();
  for (const r of refs.values()) {
    const tip = tipOf(r, r.name === base);
    list.set(r.name, { name: r.name, ...(r.name === base ? { base: true as const } : {}), sha: tip.sha, subject: tip.subject, author: tip.author, at: tip.at, ...(r.local ? { local: true as const } : {}), ...(r.remote ? { remote: true as const } : {}), agents: [], apps: [] });
  }
  // The agents, on the branches their worktrees are on (one not on a branch, by the branch whose tip it's at), and what they've left uncommitted.
  const branchOf = new Map<string, string>();
  await eachLimit(t.agents, 6, async (w) => {
    const at = workDir(w, dir);
    const tree = at ? trees.get(real(at)) : undefined;
    if (!at || !tree) return;
    let name = tree.branch ?? [...list.values()].find((b) => b.sha === tree.sha)?.name;
    if (!name) {
      name = tree.sha.slice(0, 7);
      list.set(name, { name, detached: true, sha: tree.sha, subject: '', author: '', at: 0, agents: [], apps: [] });
    }
    const b = list.get(name);
    if (!b) return;
    branchOf.set(w.id, name);
    b.agents.push(agentOf(w));
    const dirty = statusPaths(await git(['status', '--porcelain=v1', '-z', '--untracked-files=normal'], at).catch(() => '')).length;
    if (dirty) b.dirty = (b.dirty ?? 0) + dirty;
  });
  // What's running on each: an agent's server on the branch it's on, the table's app address on the default branch.
  for (const app of roomApps(ctx, floor, t.id)) {
    const w = app.workerId ? floor.workers.get(app.workerId) : undefined;
    const on = w ? branchOf.get(w.id) : base;
    const b = on ? list.get(on) : undefined;
    if (!b) continue;
    const a: BranchApp = { key: app.key, label: w ? `${w.name} · port ${app.port}` : 'Its app address', ...(app.port ? { port: app.port } : {}), ...(app.key === 'url' ? { url: app.url } : {}) };
    b.apps.push(a);
  }
  // How far each is from the default branch, newest first, as many as are shown.
  const shown = order([...list.values()], []).slice(0, MAX_BRANCHES);
  if (baseRef) {
    await eachLimit(shown.filter((b) => !b.base && !b.detached), 8, async (b) => {
      const counts = await git(['rev-list', '--left-right', '--count', `${baseRef}...${refName(refs.get(b.name)!, false)}`], dir).catch(() => '');
      const [behind, ahead] = counts.trim().split(/\s+/).map(Number);
      if (Number.isFinite(ahead) && Number.isFinite(behind)) Object.assign(b, { ahead, behind });
    });
    info.commits = commitsOf(await git(['log', '-n', '8', LOG_FORMAT, baseRef], dir).catch(() => ''));
  }
  info.branches = shown;
  if (list.size > shown.length) info.more = list.size - shown.length;
}

/** The default branch, then the ones agents are on, then open pull requests', then the newest. */
function order(branches: TableBranch[], pulls: TablePull[]): TableBranch[] {
  const open = new Set(pulls.filter((p) => p.state === 'OPEN').map((p) => p.headRefName));
  const rank = (b: TableBranch) => (b.base ? 0 : b.agents.length || b.apps.length ? 1 : open.has(b.name) ? 2 : 3);
  return [...branches].sort((a, b) => rank(a) - rank(b) || b.at - a.at);
}

/** `git diff --numstat -z` and `--name-status -z` of the same changes, as changed paths. */
function changed(numstat: string, names: string): ChangedPath[] {
  const counts = new Map<string, { added: number; removed: number }>();
  const n = numstat.split('\0');
  for (let i = 0; i < n.length; i++) {
    const [added, removed, file] = n[i].split('\t');
    if (added === undefined || removed === undefined) continue;
    // A rename's paths come after it, from and to.
    const p = file || n[(i += 2)];
    if (p) counts.set(p, { added: Number(added) || 0, removed: Number(removed) || 0 });
  }
  const out: ChangedPath[] = [];
  const s = names.split('\0');
  for (let i = 0; i < s.length; i++) {
    const code = s[i];
    if (!code) continue;
    const letter = code[0];
    const p = /[RC]/.test(letter) ? s[(i += 2)] : s[++i];
    if (!p) continue;
    const status: ChangedPath['status'] = letter === 'A' || letter === 'C' ? 'A' : letter === 'D' ? 'D' : letter === 'R' ? 'R' : 'M';
    out.push({ path: p, status, ...(counts.get(p) ?? { added: 0, removed: 0 }) });
  }
  return out;
}

/** A branch of the table's repository close up, or why not. */
export async function branchDetail(floor: Floor, room: string, branch: string): Promise<BranchDetail | string> {
  const t = tableOf(floor, room);
  if (!t?.dir || !t.git) return 'This table has no repository checked out';
  const dir = t.dir;
  const refs = await refsOf(dir);
  const base = await baseOf(dir, refs);
  const r = refs.get(branch);
  const detail: BranchDetail = { branch, commits: [], files: [], uncommitted: [] };
  if (r && base && branch !== base) {
    const baseRef = refName(refs.get(base)!, true);
    const ref = refName(r, false);
    const [log, count, numstat, names] = await Promise.all([
      git(['log', '-n', String(MAX_COMMITS), LOG_FORMAT, `${baseRef}..${ref}`], dir).catch(() => ''),
      git(['rev-list', '--count', `${baseRef}..${ref}`], dir).catch(() => '0'),
      git(['diff', '--numstat', '-z', '-M', `${baseRef}...${ref}`], dir).catch(() => ''),
      git(['diff', '--name-status', '-z', '-M', `${baseRef}...${ref}`], dir).catch(() => ''),
    ]);
    detail.commits = commitsOf(log);
    const more = Number(count) - detail.commits.length;
    if (more > 0) detail.moreCommits = more;
    const files = changed(numstat, names);
    detail.files = files.slice(0, MAX_FILES);
    if (files.length > MAX_FILES) detail.moreFiles = files.length - MAX_FILES;
  } else if (!r && !/^[0-9a-f]{7}$/.test(branch)) return 'There is no such branch';
  // What the agents on it haven't committed.
  const trees = await worktreesOf(dir);
  for (const w of t.agents) {
    const at = workDir(w, dir);
    const tree = at ? trees.get(real(at)) : undefined;
    if (!at || !tree) continue;
    // On it: its worktree's on the branch, or not on any but at its tip.
    const on = tree.branch ? tree.branch === branch : r ? tree.sha === tipOf(r, false).sha : tree.sha.slice(0, 7) === branch;
    if (!on) continue;
    const [status, numstat] = await Promise.all([
      git(['status', '--porcelain=v1', '-z', '--untracked-files=normal'], at).catch(() => ''),
      git(['diff', '--numstat', '-z', 'HEAD'], at).catch(() => ''),
    ]);
    const counts = new Map<string, [number, number]>();
    for (const l of numstat.split('\0')) {
      const [added, removed, file] = l.split('\t');
      if (file) counts.set(file, [Number(added) || 0, Number(removed) || 0]);
    }
    for (const p of statusPaths(status)) {
      const c = counts.get(p.path);
      detail.uncommitted.push(c ? { ...p, added: c[0], removed: c[1] } : p);
    }
    if (detail.uncommitted.length >= MAX_FILES) break;
  }
  detail.uncommitted = detail.uncommitted.slice(0, MAX_FILES);
  return detail;
}

/** Whether `branch` is one of the table's repository's (and its default), to hire somebody to run it, and the table's name. */
export async function hasBranch(floor: Floor, room: string, branch: string): Promise<{ base: boolean; table: string } | undefined> {
  const t = tableOf(floor, room);
  if (!t?.dir || !t.git) return undefined;
  const refs = await refsOf(t.dir).catch(() => undefined);
  if (!refs?.has(branch)) return undefined;
  return { base: (await baseOf(t.dir, refs)) === branch, table: t.name };
}
