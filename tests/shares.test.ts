import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, statSync, realpathSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { addShare, readShares, removeShare, shareProblem, suggestShare, type ShareGuard } from '../src/server/worker-chat/shares.js';
import { sharesRoute } from '../src/server/http/routes/shares.js';

/** A floor, the office's data folder (as `<project>/.agent-office`) and a place outside both. */
function office(t: { after(fn: () => void): void }) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'shares-'));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const floorDir = path.join(tmp, 'building', 'floor'), dataDir = path.join(tmp, 'project', '.agent-office'), outside = path.join(tmp, 'outside');
  for (const dir of [path.join(floorDir, '.agent-office'), dataDir, outside]) mkdirSync(dir, { recursive: true });
  const guard: ShareGuard = { dataDir, floorDirs: [floorDir] };
  const folder = (...parts: string[]) => { const dir = path.join(outside, ...parts); mkdirSync(dir, { recursive: true }); return dir; };
  return { tmp, floorDir, dataDir, outside, guard, folder };
}

test('a share has to be an ordinary project folder outside the floor, the office data and the home folder', t => {
  const o = office(t);
  writeFileSync(path.join(o.outside, 'file.mp4'), '');
  mkdirSync(path.join(o.dataDir, 'inner'));
  const refused: Record<string, RegExp> = {
    '/': /home folder/,
    [os.homedir()]: /home folder/,
    [path.dirname(os.homedir())]: /home folder/,
    '~': /home folder/,
    [o.dataDir]: /data folder/,
    [path.join(o.dataDir, 'inner')]: /data folder/,
    [path.join(o.tmp, 'building')]: /office floor/,
    [o.folder('.hidden')]: /Hidden/,
    [o.folder('project', 'node_modules')]: /Hidden/,
    [o.folder('credentials')]: /Hidden/,
    [path.join(o.outside, 'file.mp4')]: /not a file/,
    [path.join(o.outside, 'missing')]: /does not exist/,
    [path.join(o.floorDir, '.agent-office')]: /office floor/,
    'outside/relative': /full path/,
    '': /Enter a folder/,
  };
  mkdirSync(path.join(o.floorDir, 'outputs'));
  refused[path.join(o.floorDir, 'outputs')] = /already/;
  for (const [dir, why] of Object.entries(refused)) assert.match(shareProblem(dir, o.floorDir, o.guard) ?? '', why, dir);
  assert.equal(shareProblem(o.folder('Content OS', 'outputs'), o.floorDir, o.guard), undefined);
  assert.match((addShare(o.floorDir, '/', 'admin', o.guard) as { error: string }).error, /home folder/);
});

test('shares are stored as realpaths in a private file, at most eight, and checked again on every read', t => {
  const o = office(t);
  const real = o.folder('real', 'outputs'); symlinkSync(path.join(o.outside, 'real'), path.join(o.outside, 'link'));
  const first = addShare(o.floorDir, path.join(o.outside, 'link', 'outputs'), 'admin', o.guard);
  assert.ok(!('error' in first)); assert.equal(first.dir, realpathSync(real)); assert.equal(first.by, 'admin');
  assert.deepEqual(addShare(o.floorDir, real, 'someone', o.guard), first);
  const file = path.join(o.floorDir, '.agent-office', 'shares.json');
  assert.equal(statSync(file).mode & 0o777, 0o600);
  for (let i = 1; i < 8; i++) assert.ok(!('error' in addShare(o.floorDir, o.folder(`project${i}`), 'admin', o.guard)));
  assert.match((addShare(o.floorDir, o.folder('ninth'), 'admin', o.guard) as { error: string }).error, /up to 8/);
  assert.equal(readShares(o.floorDir, o.guard).length, 8);
  // A deleted folder, and one edited in by hand that breaks a rule, are dropped when read.
  rmSync(path.join(o.outside, 'project7'), { recursive: true });
  assert.equal(readShares(o.floorDir, o.guard).length, 7);
  const id = (dir: string) => `s${createHash('sha256').update(dir).digest('hex').slice(0, 10)}`;
  writeFileSync(file, JSON.stringify({ version: 1, shares: [{ id: id('/'), dir: '/', by: 'agent', at: 1 }, { id: id(os.homedir()), dir: os.homedir(), by: 'agent', at: 1 }, { ...first }] }));
  assert.deepEqual(readShares(o.floorDir, o.guard), [first]);
  assert.equal(removeShare(o.floorDir, first.id), true); assert.equal(removeShare(o.floorDir, first.id), false);
  assert.deepEqual(readShares(o.floorDir, o.guard), []);
});

test('a symlinked shares file is refused', t => {
  const o = office(t);
  const share = addShare(o.floorDir, o.folder('outputs'), 'admin', o.guard);
  assert.ok(!('error' in share));
  const file = path.join(o.floorDir, '.agent-office', 'shares.json'), elsewhere = path.join(o.outside, 'shares.json');
  writeFileSync(elsewhere, JSON.stringify({ version: 1, shares: [share] })); unlinkSync(file); symlinkSync(elsewhere, file);
  assert.deepEqual(readShares(o.floorDir, o.guard), []);
  assert.match((addShare(o.floorDir, o.folder('more'), 'admin', o.guard) as { error: string }).error, /invalid/);
  assert.equal(removeShare(o.floorDir, share.id), false);
});

test('the suggested share is the repository outputs folder, else the repository, else the file\'s folder', t => {
  const o = office(t);
  const repo = o.folder('Content OS'); mkdirSync(path.join(repo, '.git'));
  const render = path.join(o.folder('Content OS', 'outputs', 'youtube', 'jev', 'edit', 'jev-v01', 'renders'), 'jev-v01.mp4');
  const draft = path.join(o.folder('Content OS', 'drafts'), 'cover.png'), loose = path.join(o.folder('loose'), 'still.png');
  for (const f of [render, draft, loose]) writeFileSync(f, '');
  assert.equal(suggestShare(render, o.floorDir, o.guard), path.join(realpathSync(repo), 'outputs'));
  assert.equal(suggestShare(draft, o.floorDir, o.guard), realpathSync(repo));
  assert.equal(suggestShare(loose, o.floorDir, o.guard), realpathSync(path.join(o.outside, 'loose')));
  assert.equal(suggestShare(path.join(o.outside, 'missing.png'), o.floorDir, o.guard), undefined);
});

test('HTTP sharing is admin-only and same-origin', async t => {
  const o = office(t);
  let caller: string | undefined = 'member';
  const floor = { dir: o.floorDir };
  const ctx = { cfg: { dataDir: o.dataDir, trustProxy: false }, floors: new Map([['floor1', floor]]), meOf: (id: string | undefined) => ({ admin: !id || id === 'admin' }) };
  const server = http.createServer((req, res) => { const url = new URL(req.url!, 'http://localhost'); void (sharesRoute.handle as Function)(ctx, { req, res, url, path: url.pathname, session: { account: caller ? { id: caller } : undefined } }).catch(() => { res.statusCode = 500; res.end(); }); });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const post = (suffix: string, body: unknown, origin = base) => fetch(`${base}/api/shares${suffix}?floor=floor1`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const dir = o.folder('Content OS', 'outputs');
  assert.equal((await post('', { dir })).status, 403);
  caller = 'admin';
  assert.equal((await post('', { dir }, 'https://attacker.test')).status, 403);
  assert.equal((await fetch(`${base}/api/shares?floor=floor1`)).status, 405);
  assert.equal((await post('', { dir: '/' })).status, 400);
  const added = await post('', { dir });
  assert.equal(added.status, 200);
  const { share } = await added.json();
  assert.match(share.id, /^s[0-9a-f]{10}$/); assert.equal(share.label, realpathSync(dir));
  assert.deepEqual((await (await post('', { dir: `${dir}/` })).json()).share, share);
  assert.deepEqual(readShares(o.floorDir, o.guard).map(s => s.by), ['admin']);
  caller = undefined;
  assert.equal((await post('/remove', { id: share.id })).status, 200);
  assert.equal((await post('/remove', { id: share.id })).status, 404);
});
