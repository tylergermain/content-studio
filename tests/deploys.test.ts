import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Deploys, newestByBranch } from '../src/server/deploys.js';
import { screenOrder } from '../src/server/room-screens.js';
import { deployedOn } from '../src/server/table-info.js';
import type { TableBranch, TableInfo } from '../src/shared/table-info.js';
import { isLocal, previewKey, type Deploy } from '../src/shared/table-info.js';

// Where a table's project is deployed (server/deploys.ts): Vercel's live site and previews when the office is signed
// in to it, GitHub's deployments when it isn't; and what a table's screen goes round (room-screens.ts, screenOrder).

function dir(t: { after(fn: () => void): void }) {
  const d = mkdtempSync(path.join(tmpdir(), 'agent-office-deploys-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  return d;
}

/** Vercel as far as these go: a person with one team, projects in each, and deployments of one of them. */
function vercel(calls: string[], ok = true) {
  return async (url: string, init: { headers: Record<string, string> }) => {
    calls.push(url.replace('https://api.vercel.com', ''));
    const auth = init.headers.authorization === 'Bearer good-token-123';
    const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
    if (!ok || !auth) return json({ error: 'nope' }, 403);
    if (url.endsWith('/v2/user')) return json({ user: { username: 'tyler' } });
    if (url.endsWith('/v2/teams')) return json({ teams: [{ id: 'team_1' }] });
    if (url.includes('/v9/projects') && !url.includes('teamId')) return json({ projects: [{ id: 'prj_mine', name: 'scratch' }] });
    if (url.includes('/v9/projects')) {
      return json({
        projects: [
          { id: 'prj_dojo', name: 'usedojo', link: { type: 'github', org: 'tylergermain', repo: 'dojo-ai' }, targets: { production: { alias: ['usedojo.ai'] } }, protectionBypass: { s3cret: { scope: 'automation-bypass' } } },
          { id: 'prj_spiel', name: 'spiel' },
        ],
      });
    }
    if (url.includes('/v6/deployments') && url.includes('prj_dojo')) {
      return json({
        deployments: [
          { uid: 'd3', url: 'usedojo-git-fix-nav-tyler.vercel.app', state: 'BUILDING', created: 3000, meta: { githubCommitRef: 'fix-nav', githubCommitSha: 'c3' } },
          { uid: 'd2', url: 'usedojo-git-fix-nav-old.vercel.app', state: 'READY', created: 2000, meta: { githubCommitRef: 'fix-nav', githubCommitSha: 'c2' }, inspectorUrl: 'https://vercel.com/i/d2' },
          { uid: 'd1', url: 'usedojo-prod.vercel.app', state: 'READY', target: 'production', created: 1000, meta: { githubCommitRef: 'main' } },
        ],
      });
    }
    return json({ deployments: [] });
  };
}

test('signing the office in to Vercel checks the token with Vercel, keeps it to itself, and signing out forgets it', async (t) => {
  const d = dir(t);
  const calls: string[] = [];
  const deploys = new Deploys(d, vercel(calls));
  assert.deepEqual(deploys.status(), { connected: false });
  assert.match(String(await deploys.connect('no spaces please')), /doesn’t look like/);
  assert.match(String(await deploys.connect('wrong-token-123')), /turned that token down/);
  assert.deepEqual(await deploys.connect('good-token-123'), { user: 'tyler' });
  assert.deepEqual(deploys.status(), { connected: true, user: 'tyler' });
  const file = path.join(d, 'vercel.json');
  assert.equal(statSync(file).mode & 0o777, 0o600, 'only the office can read it');
  assert.ok(readFileSync(file, 'utf8').includes('good-token-123'));
  assert.equal(await deploys.connect(''), undefined);
  assert.deepEqual(deploys.status(), { connected: false });
});

test("Vercel: a table's project is the one linked to its repository (or named for it, or picked), its live site its domain, each branch its previews", async (t) => {
  const calls: string[] = [];
  const deploys = new Deploys(dir(t), vercel(calls), async () => {
    throw new Error('GitHub is not asked when Vercel answers');
  });
  await deploys.connect('good-token-123');
  const got = await deploys.of('tylergermain/dojo-ai', undefined, '/tmp');
  assert.equal(got.project, 'usedojo', 'by the repository it’s linked to');
  assert.equal(got.live, 'https://usedojo.ai');
  assert.deepEqual(got.list.map((x) => [x.env, x.branch, x.state, x.url]), [
    ['preview', 'fix-nav', 'building', 'https://usedojo-git-fix-nav-tyler.vercel.app'],
    ['preview', 'fix-nav', 'ready', 'https://usedojo-git-fix-nav-old.vercel.app'],
    ['production', 'main', 'ready', 'https://usedojo-prod.vercel.app'],
  ]);
  assert.ok(calls.some((c) => c.includes('teamId=team_1')), 'its team’s projects too');
  // The screens' browser gets past Vercel's login on its previews, with the project's bypass; nothing else does.
  assert.deepEqual(deploys.headersFor('https://usedojo-git-fix-nav-old.vercel.app/pricing'), { 'x-vercel-protection-bypass': 's3cret', 'x-vercel-set-bypass-cookie': 'true' });
  assert.deepEqual(deploys.headersFor('https://example.com/'), {});
  // By name, and picked by hand.
  assert.equal((await deploys.of('tylergermain/spiel', undefined, '/tmp')).project, 'spiel');
  assert.equal((await deploys.of('tylergermain/kenna-platform', 'usedojo', '/tmp')).project, 'usedojo');
  assert.match(String((await deploys.of('tylergermain/kenna-platform', undefined, '/tmp')).error), /No Vercel project for this repository/);
  assert.deepEqual(await deploys.names(), ['scratch', 'spiel', 'usedojo']);
  // Asked again only once a minute.
  const before = calls.length;
  await deploys.of('tylergermain/dojo-ai', undefined, '/tmp');
  assert.equal(calls.length, before);
});

test('without Vercel, GitHub’s deployments: the newest of each environment and branch, where its status says it is', async (t) => {
  const asked: string[] = [];
  const gh = async (args: string[]) => {
    asked.push(args[1]);
    if (args[1].endsWith('/deployments?per_page=40')) {
      return JSON.stringify([
        { id: 30, environment: 'Preview', ref: 'office/ada-1', sha: 'a3', created_at: '2026-10-06T10:00:00Z' },
        { id: 20, environment: 'Production', ref: 'main', sha: 'm2', created_at: '2026-10-06T09:00:00Z' },
        { id: 10, environment: 'Preview', ref: 'office/ada-1', sha: 'a1', created_at: '2026-10-05T09:00:00Z' },
      ]);
    }
    const id = Number(/deployments\/(\d+)\/statuses/.exec(args[1])?.[1]);
    return JSON.stringify([{ state: id === 30 ? 'success' : 'success', environment_url: id === 30 ? 'https://spiel-git-office-ada-1.vercel.app' : 'https://spiel.app', created_at: '2026-10-06T10:01:00Z' }]);
  };
  const deploys = new Deploys(dir(t), vercel([]), gh);
  const got = await deploys.of('tylergermain/spiel', undefined, '/tmp');
  assert.equal(got.live, 'https://spiel.app');
  assert.deepEqual(got.list.map((x) => [x.env, x.branch, x.url, x.from]), [
    ['preview', 'office/ada-1', 'https://spiel-git-office-ada-1.vercel.app', 'github'],
    ['production', 'main', 'https://spiel.app', 'github'],
  ]);
  assert.ok(!asked.some((a) => a.includes('deployments/10/')), 'not the older one of a branch');
});

test("a table's screen goes round the live site and the branches' previews; what runs here only on a branch with none, the room's local address only with nothing else", () => {
  const d = (branch: string, at: number, state: Deploy['state'] = 'ready'): Deploy => ({ env: 'preview', branch, url: `https://${branch}-${at}.vercel.app`, state, at, from: 'vercel' });
  const previews = [d('fix-nav', 3, 'building'), d('fix-nav', 2), d('pricing', 1)];
  const here = [
    { key: 'p3011', url: 'http://127.0.0.1:3011/', kind: 'local' as const, branch: 'pricing', who: 'Ada' },
    { key: 'p3012', url: 'http://127.0.0.1:3012/', kind: 'local' as const, branch: 'office/bob-2', who: 'Bob' },
  ];
  const all = screenOrder({ live: 'https://usedojo.ai', previews, here, url: 'http://127.0.0.1:3300/' });
  assert.deepEqual(all.apps.map((a) => a.key), ['live', previewKey('fix-nav'), previewKey('pricing'), 'p3012']);
  assert.equal(all.deployed, 3);
  assert.equal(all.apps[1].url, 'https://fix-nav-2.vercel.app', 'the newest that’s ready, not the one still building');
  const none = screenOrder({ previews: [], here, url: 'http://127.0.0.1:3300/' });
  assert.deepEqual([none.apps.map((a) => a.key), none.deployed], [['p3011', 'p3012'], 0]);
  assert.deepEqual(screenOrder({ previews: [], here: [], url: 'http://127.0.0.1:3300/' }).apps.map((a) => a.key), ['url']);
  // Which addresses are this computer's.
  assert.ok(isLocal('http://127.0.0.1:3000/') && isLocal('http://localhost:5173') && !isLocal('https://usedojo.ai/'));
  assert.equal(newestByBranch(previews).get('fix-nav')?.at, 3);
  assert.equal(previewKey('office/ada-1'), 'b-office_ada-1');
});

test("a table's branches show where they're deployed: the live site on the default branch, a preview ahead of what runs here, and other branches' previews on their own", () => {
  const branch = (name: string, extra: Partial<TableBranch> = {}): TableBranch => ({ name, sha: 's', subject: '', author: '', at: 0, agents: [], apps: [], deploys: [], ...extra });
  const info = {
    room: { id: 'r', name: 'Dojo', seats: 6 },
    branches: [branch('main', { base: true, apps: [{ key: 'url', label: 'Its app address, on this computer', kind: 'local', url: 'http://127.0.0.1:3300/' }] }), branch('fix-nav', { apps: [{ key: 'p3011', label: 'Ada’s', kind: 'local', port: 3011 }] }), branch('office/bob-2')],
    pulls: [],
    issues: [],
    commits: [],
    previews: [],
    vercel: { connected: false },
    problems: [],
  } as TableInfo;
  const list: Deploy[] = [
    { env: 'production', branch: 'main', url: 'https://usedojo-prod.vercel.app', state: 'ready', at: 1, from: 'vercel' },
    { env: 'preview', branch: 'fix-nav', url: 'https://fix-nav-b.vercel.app', state: 'building', at: 3, from: 'vercel' },
    { env: 'preview', branch: 'fix-nav', url: 'https://fix-nav-a.vercel.app', state: 'ready', at: 2, from: 'vercel' },
    { env: 'preview', branch: 'someone-elses', url: 'https://other.vercel.app', state: 'ready', at: 4, from: 'vercel' },
  ];
  deployedOn(info, { url: 'http://127.0.0.1:3300/' }, { list, live: 'https://usedojo.ai', project: 'usedojo' }, { connected: true, user: 'tyler' });
  const [main, nav, bob] = info.branches;
  assert.equal(info.live, 'https://usedojo.ai');
  assert.deepEqual(main.apps.map((a) => [a.kind, a.url]), [['live', 'https://usedojo.ai']], 'the live site, not the one on this computer');
  assert.deepEqual(nav.apps.map((a) => a.kind), ['preview', 'local'], 'its preview first, then Ada’s');
  assert.equal(nav.apps[0].url, 'https://fix-nav-a.vercel.app');
  assert.deepEqual(nav.deploys.map((x) => x.state), ['building', 'ready'], 'the one building, and the one up');
  assert.deepEqual([bob.apps, bob.deploys], [[], []]);
  assert.deepEqual(info.previews.map((x) => x.branch), ['someone-elses']);
  assert.deepEqual(info.vercel, { connected: true, user: 'tyler', project: 'usedojo' });
  // With nothing deployed, a table's own address counts as live only when it's not on this computer.
  const bare = { ...info, branches: [branch('main', { base: true })], previews: [] } as TableInfo;
  deployedOn(bare, { url: 'https://spiel.app/' }, { list: [] }, { connected: false });
  assert.equal(bare.live, 'https://spiel.app/');
  const local = { ...info, live: undefined, branches: [branch('main', { base: true })], previews: [] } as TableInfo;
  deployedOn(local, { url: 'http://127.0.0.1:3000/' }, { list: [] }, { connected: false });
  assert.equal(local.live, undefined);
});
