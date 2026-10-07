import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { tableInfoRoute } from '../src/server/http/routes/table-info.js';
import { roomApps } from '../src/server/room-screens.js';
import { branchAt } from '../src/server/git-read.js';
import { branchDetail, hasBranch, tableInfo } from '../src/server/table-info.js';
import type { Piece } from '../src/shared/furniture.js';
import { BRANCH_NAME, runBranchTask, type TableInfo } from '../src/shared/table-info.js';

// A project table's panel (server/table-info.ts): every branch of the table's repository, the default first, with the
// agents at the table on the branches their worktrees are on, what each runs, and how far each is from the default
// branch; a branch close up; and hiring somebody to run one (http/routes/table-info.ts).

/** Commits at a time of our choosing, by a name of our choosing, whatever this machine's git is set up as. */
function git(cwd: string, args: string[], at?: number) {
  const env = { ...process.env, GIT_AUTHOR_NAME: 'Tess', GIT_AUTHOR_EMAIL: 'tess@example.com', GIT_COMMITTER_NAME: 'Tess', GIT_COMMITTER_EMAIL: 'tess@example.com', ...(at ? { GIT_AUTHOR_DATE: `@${at} +0000`, GIT_COMMITTER_DATE: `@${at} +0000` } : {}) };
  return execFileSync('git', ['-c', 'init.defaultBranch=main', '-c', 'commit.gpgsign=false', ...args], { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function commit(cwd: string, file: string, text: string, message: string, at: number) {
  appendFileSync(path.join(cwd, file), text);
  git(cwd, ['add', file]);
  git(cwd, ['commit', '-q', '-m', message], at);
}

/**
 * A repository on "GitHub" (a bare one), the table's checkout of it, and Ada at the table in a worktree of her own:
 * main moved on at GitHub after she started, feature/x is only on GitHub, local-only only in the checkout.
 */
function repository(t: { after(fn: () => void): void }) {
  const tmp = mkdtempSync(path.join(tmpdir(), 'agent-office-table-info-'));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const origin = path.join(tmp, 'origin.git');
  const seed = path.join(tmp, 'seed');
  const dir = path.join(tmp, 'spiel');
  git(tmp, ['init', '-q', '--bare', origin]);
  mkdirSync(seed);
  git(seed, ['init', '-q']);
  commit(seed, 'README.md', 'hello\n', 'First', 1_000_000);
  commit(seed, 'README.md', 'world\n', 'Second', 1_000_100);
  git(seed, ['remote', 'add', 'origin', origin]);
  git(seed, ['push', '-q', 'origin', 'main']);
  git(seed, ['checkout', '-q', '-b', 'feature/x']);
  commit(seed, 'feat.txt', 'a\nb\nc\n', 'Add the feature', 1_000_200);
  commit(seed, 'README.md', 'more\n', 'Say more', 1_000_300);
  git(seed, ['push', '-q', 'origin', 'feature/x']);
  git(tmp, ['clone', '-q', origin, dir]);
  // Ada's worktree, from main as it was when she was hired, with a commit and a file she hasn't committed.
  const wt = path.join(dir, '.agent-office', 'worktrees', 'ada-1234');
  git(dir, ['worktree', 'add', '-q', '-b', 'office/ada-1234', wt, 'origin/main']);
  commit(wt, 'e.txt', 'e\n', 'Ada’s change', 1_000_400);
  writeFileSync(path.join(wt, 'new.txt'), 'not yet\n');
  // main moves on at GitHub, and the checkout hears of it.
  git(seed, ['checkout', '-q', 'main']);
  commit(seed, 'README.md', 'fixed\n', 'Fix on main', 1_000_500);
  git(seed, ['push', '-q', 'origin', 'main']);
  git(dir, ['fetch', '-q', 'origin']);
  git(dir, ['checkout', '-q', '-b', 'local-only']);
  commit(dir, 'l.txt', 'l\n', 'Only here', 1_000_600);
  git(dir, ['checkout', '-q', 'main']);
  return { tmp, dir, wt };
}

function office(t: { after(fn: () => void): void }, opts: { url?: string; member?: string[] } = {}) {
  const r = repository(t);
  const furniture: Piece[] = [{ id: 'spiel', kind: 'project-room', x: 0, z: 0, rotY: 0, w: 6, d: 6, text: 'Spiel', project: { dir: r.dir, git: true, ...(opts.url ? { url: opts.url } : {}) } }];
  const ada = { id: 'w1', name: 'Ada', kind: 'agent', status: 'working', deskId: 'seat-1', project: { room: 'spiel', name: 'Spiel', dir: r.dir }, worktree: { root: r.dir, path: path.join('.agent-office', 'worktrees', 'ada-1234'), branch: 'office/ada-1234', base: '' }, task: { name: 'Fix the header', summary: '' } };
  const tables = new Map([['seat-1', { id: 'seat-1', x: -1, z: 0, rotY: 0, label: '' }], ['seat-2', { id: 'seat-2', x: 1, z: 0, rotY: 0, label: '' }]]);
  const hires: { seat: string; task: string; worktree: boolean }[] = [];
  const floor = {
    id: 'f1',
    def: { name: 'Software Factory' },
    dir: r.tmp,
    plan: { state: () => ({ furniture }), seating: () => ({ only: true, tables }) },
    workers: {
      list: () => [ada],
      get: (id: string) => (id === 'w1' ? ada : undefined),
      hiringPolicy: () => undefined,
      fetchRoom: async () => {},
      spawn: (seat: string, _by: string, task: string, worktree: boolean) => {
        hires.push({ seat, task, worktree });
        return { id: `h${hires.length}`, name: `Agent ${hires.length}` };
      },
    },
  };
  const ctx = {
    cfg: { trustProxy: false, dataDir: r.tmp },
    floors: new Map([['f1', floor]]),
    services: { list: () => [{ port: 5174, workerId: 'w1', since: 2, host: '127.0.0.1', pid: 1, command: 'vite' }] },
    toastFloor: () => {},
    meOf: () => (opts.member ? { admin: false, floors: opts.member } : { admin: true }),
  };
  return { ...r, floor, ctx, hires };
}

test('a table shows its default branch first, then the ones its agents are on, then the newest, each against the default', async (t) => {
  const o = office(t, { url: 'http://localhost:3999/' });
  const info = (await tableInfo(o.ctx as never, o.floor as never, 'spiel')) as TableInfo;
  assert.equal(info.base, 'main');
  assert.deepEqual(info.branches.map((b) => b.name), ['main', 'office/ada-1234', 'local-only', 'feature/x']);
  const [main, ada, local, feature] = info.branches;
  // The default branch as GitHub has it, and the table's own app address on it.
  assert.equal(main.subject, 'Fix on main');
  assert.equal(main.base, true);
  assert.deepEqual(main.apps, [{ key: 'url', label: 'Its app address, on this computer', kind: 'local', url: 'http://localhost:3999/' }]);
  // Ada's: her, her server, what she hasn't committed, a commit ahead and one behind.
  assert.deepEqual(ada.agents, [{ id: 'w1', name: 'Ada', status: 'working', task: 'Fix the header' }]);
  assert.deepEqual(ada.apps, [{ key: 'p5174', label: 'Ada’s, on this computer · port 5174', kind: 'local', port: 5174 }]);
  assert.equal(ada.dirty, 1);
  assert.deepEqual([ada.ahead, ada.behind], [1, 1]);
  assert.deepEqual([feature.ahead, feature.behind, feature.remote, feature.local], [2, 1, true, undefined]);
  assert.deepEqual([local.local, local.remote], [true, undefined]);
  assert.deepEqual(info.commits.map((c) => c.subject), ['Fix on main', 'Second', 'First']);
  assert.deepEqual(info.problems, []);
});

test("an agent told to run a branch without taking it over shows on that branch, and so does its server", async (t) => {
  const o = office(t);
  assert.equal(await branchAt(o.wt), 'office/ada-1234');
  git(o.wt, ['switch', '-q', '--detach', 'origin/feature/x']);
  assert.equal(await branchAt(o.wt), 'feature/x');
  const info = (await tableInfo(o.ctx as never, o.floor as never, 'spiel')) as TableInfo;
  const feature = info.branches.find((b) => b.name === 'feature/x')!;
  assert.deepEqual(feature.agents.map((a) => a.name), ['Ada']);
  assert.deepEqual(feature.apps.map((a) => a.key), ['p5174']);
  assert.deepEqual(info.branches.find((b) => b.name === 'office/ada-1234')!.agents, []);
  git(o.wt, ['switch', '-q', '--detach', 'HEAD~1']);
  assert.match(String(await branchAt(o.wt)), /^[0-9a-f]{7,}$/);
});

test('a branch close up: its commits, the files they change, and what an agent on it has not committed', async (t) => {
  const o = office(t);
  const feature = await branchDetail(o.floor as never, 'spiel', 'feature/x');
  assert.ok(typeof feature === 'object');
  if (typeof feature !== 'object') return;
  assert.deepEqual(feature.commits.map((c) => c.subject), ['Say more', 'Add the feature']);
  assert.deepEqual(feature.files.map((f) => [f.path, f.status, f.added, f.removed]).sort(), [['README.md', 'M', 1, 0], ['feat.txt', 'A', 3, 0]]);
  const ada = await branchDetail(o.floor as never, 'spiel', 'office/ada-1234');
  assert.ok(typeof ada === 'object');
  if (typeof ada !== 'object') return;
  assert.deepEqual(ada.commits.map((c) => c.subject), ['Ada’s change']);
  assert.deepEqual(ada.uncommitted, [{ path: 'new.txt', status: '?', added: 0, removed: 0 }]);
  assert.equal(await branchDetail(o.floor as never, 'spiel', 'nope'), 'There is no such branch');
  assert.deepEqual(await hasBranch(o.floor as never, 'spiel', 'main'), { base: true, table: 'Spiel' });
  assert.equal(await hasBranch(o.floor as never, 'spiel', 'nope'), undefined);
});

test("what's running in a room: its agents' servers, newest first, then its app address unless one of them is it", () => {
  const furniture: Piece[] = [{ id: 'spiel', kind: 'project-room', x: 0, z: 0, rotY: 0, w: 6, d: 6, project: { url: 'http://127.0.0.1:3000/' } }];
  const floor = { workers: { get: (id: string) => ({ project: { room: id === 'w3' ? 'dojo' : 'spiel' } }) }, plan: { state: () => ({ furniture }) } };
  const ctx = (ports: number[]) => ({ services: { list: () => ports.map((port, i) => ({ port, workerId: port === 9000 ? 'w3' : `w${i}`, since: i })) } });
  assert.deepEqual(roomApps(ctx([5173, 5174, 9000]) as never, floor as never, 'spiel').map((a) => a.key), ['p5174', 'p5173', 'url']);
  assert.deepEqual(roomApps(ctx([3000]) as never, floor as never, 'spiel').map((a) => a.key), ['p3000']);
});

async function call(server: http.Server, p: string, body?: unknown) {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as { port: number };
  try {
    const res = await fetch(`http://127.0.0.1:${port}${p}`, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${port}` }, body: JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  } finally {
    server.close();
  }
}

const serve = (ctx: unknown) => http.createServer((req, res) => {
  const url = new URL(req.url!, 'http://office');
  void tableInfoRoute.handle(ctx as never, { req, res, url, path: url.pathname, session: { account: { id: 'acct', name: 'Tyler' } } } as never);
});

test('running a branch hires a new agent at a free chair to check it out and run it; the default branch is the app started', async (t) => {
  const o = office(t);
  const ran = await call(serve(o.ctx), '/api/table-info/run?floor=f1&room=spiel', { branch: 'feature/x', requestId: 'run-1' });
  assert.equal(ran.status, 200, JSON.stringify(ran.body));
  assert.equal(o.hires[0].seat, 'seat-2');
  assert.equal(o.hires[0].worktree, true);
  assert.equal(o.hires[0].task, runBranchTask('Spiel', 'feature/x'));
  assert.match(o.hires[0].task, /git switch --detach origin\/feature\/x/);
  const main = await call(serve(o.ctx), '/api/table-info/run?floor=f1&room=spiel', { branch: 'main', requestId: 'run-2' });
  assert.equal(main.status, 200);
  assert.match(o.hires[1].task, /Get Spiel's app running/);
  assert.equal((await call(serve(o.ctx), '/api/table-info/run?floor=f1&room=spiel', { branch: 'nope', requestId: 'run-3' })).status, 404);
  assert.equal((await call(serve(o.ctx), '/api/table-info/run?floor=f1&room=spiel', { branch: '--upload-pack=x', requestId: 'run-4' })).status, 400);
  const read = await call(serve(o.ctx), '/api/table-info/branch?floor=f1&room=spiel&branch=feature%2Fx');
  assert.equal((read.body.commits as unknown[]).length, 2);
  assert.equal((await call(serve(o.ctx), '/api/table-info?floor=f1&room=nope')).status, 404);
});

test("someone who only looks round a floor can read a table's panel but not hire anyone to run a branch", async (t) => {
  const o = office(t, { member: ['elsewhere'] });
  const looked = await call(serve(o.ctx), '/api/table-info?floor=f1&room=spiel');
  assert.equal(looked.status, 200);
  const ran = await call(serve(o.ctx), '/api/table-info/run?floor=f1&room=spiel', { branch: 'feature/x', requestId: 'run-1' });
  assert.equal(ran.status, 403);
  assert.match(String(ran.body.error), /look round Software Factory/);
  assert.equal(o.hires.length, 0);
});

test('branch names are looked up only as git allows them', () => {
  for (const ok of ['main', 'feature/x', 'office/ada-1234', 'fix_1.2']) assert.ok(BRANCH_NAME.test(ok), ok);
  for (const bad of ['-x', '--upload-pack=x', 'a..b', 'a b', 'a~1', 'a^', 'a:b', '', 'x'.repeat(201)]) assert.ok(!BRANCH_NAME.test(bad), bad);
});
