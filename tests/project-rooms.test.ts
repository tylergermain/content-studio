import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FloorPlanStore } from '../src/server/floorplan.js';
import { checkProjects, deskProject } from '../src/server/project-rooms.js';
import { Ledger } from '../src/server/usage.js';
import { WorkerManager, type WorkerEvents } from '../src/server/workers.js';
import { cleanFurniture, pieceBox, type Piece } from '../src/shared/furniture.js';
import { DESKS } from '../src/shared/layout.js';
import { cleanProject, cleanWorkerProject, projectBrief, projectRoomAt } from '../src/shared/project-rooms.js';

// Project rooms (shared/project-rooms.ts): a stretch of floor marked out for one project, whose desks'
// workers start in the project's folder.

const desk1 = DESKS.find((d) => d.id === 'desk-1')!;

function room(id: string, x: number, z: number, w: number, d: number, project?: Piece['project'], text = 'Kenna'): Piece {
  return { id, kind: 'project-room', x, z, rotY: 0, color: '#7ab8ff', text, w, d, ...(project ? { project } : {}) };
}

function tmp(t: { after(fn: () => void): void }, name: string): string {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), `agent-office-${name}-`)));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('a project room keeps its size, name and project as they are fit to keep', () => {
  const kept = cleanFurniture([{ id: 'r1', kind: 'project-room', x: 0, z: 0, rotY: 0, text: '  Kenna  Platform ', w: 99, d: 3.1, project: { dir: '/Users/a/kenna/', url: 'localhost:3000', keep: true, git: true } }]);
  assert.ok(Array.isArray(kept), String(kept));
  const [p] = kept as Piece[];
  assert.equal(p.text, 'Kenna Platform');
  assert.equal(p.w, 30);
  assert.equal(p.d, 3);
  assert.deepEqual(p.project, { dir: '/Users/a/kenna', url: 'http://localhost:3000/', keep: true, git: true });
  // Its size goes into what it covers.
  assert.deepEqual(pieceBox(p), { minX: -15, maxX: 15, minZ: -1.5, maxZ: 1.5 });
  // Nothing that isn't fit to keep: a relative folder, one with .. in it, an address that isn't http.
  assert.equal(cleanProject({ dir: 'kenna', url: 'ftp://x' }), undefined);
  assert.equal(cleanProject({ dir: '/Users/a/../b' }), undefined);
  assert.deepEqual(cleanProject({ git: true, url: 'https://kenna.app' }), { url: 'https://kenna.app/' });
  // Any other kind has no size of its own and no project.
  const [rug] = cleanFurniture([{ id: 'r2', kind: 'rug', x: 0, z: 0, rotY: 0, w: 20, d: 20, project: { dir: '/Users/a/kenna' } }]) as Piece[];
  assert.equal(rug.w, undefined);
  assert.equal(rug.project, undefined);
  // A project room stays downstairs, with the desks.
  const [up] = cleanFurniture([{ id: 'r3', kind: 'project-room', x: 0, z: 0, rotY: 0, level: 1 }]) as Piece[];
  assert.equal(up.level, undefined);
});

test('a point is in the smallest project room it is in, turned rooms included, and in none upstairs', () => {
  const big = room('big', 0, 0, 20, 20);
  const small = room('small', 2, 2, 4, 4);
  assert.equal(projectRoomAt([big, small], 3, 3)?.id, 'small');
  assert.equal(projectRoomAt([small, big], 3, 3)?.id, 'small');
  assert.equal(projectRoomAt([big, small], -8, 0)?.id, 'big');
  assert.equal(projectRoomAt([big, small], 11, 0), undefined);
  // A quarter turn swaps its length and width.
  const turned = { ...room('turned', 0, 0, 10, 2), rotY: Math.PI / 2 };
  assert.equal(projectRoomAt([turned], 0, 4)?.id, 'turned');
  assert.equal(projectRoomAt([turned], 4, 0), undefined);
  assert.equal(projectRoomAt([{ ...small, level: 1 }], 3, 3), undefined);
});

test("a room's folder has to be a folder inside the home folder, not the home folder or the floor's own data", (t) => {
  const home = tmp(t, 'home');
  const floor = path.join(home, 'floor');
  const kenna = path.join(home, 'kenna');
  mkdirSync(path.join(floor, '.agent-office'), { recursive: true });
  mkdirSync(path.join(kenna, '.git'), { recursive: true });
  writeFileSync(path.join(home, 'notes.txt'), 'hi');
  const check = (dir: string) => checkProjects([room('r', 0, 0, 6, 6, { dir })], floor, home);
  assert.match(check(path.join(home, 'nowhere'))!, /^Kenna: there's no folder at /);
  assert.match(check(path.join(home, 'notes.txt'))!, /no folder/);
  assert.match(check(home)!, /inside .*not the home folder/);
  assert.match(check(tmpdir())!, /inside/);
  assert.match(check(path.join(floor, '.agent-office'))!, /\.agent-office/);
  // A folder that's fine, and whether it's a git checkout is the office's to say.
  const pieces = [room('r', 0, 0, 6, 6, { dir: kenna }), room('s', 9, 0, 6, 6, { dir: floor, git: true })];
  assert.equal(checkProjects(pieces, floor, home), undefined);
  assert.equal(pieces[0].project?.git, true);
  assert.equal(pieces[1].project?.git, undefined);
});

test('a floor keeps its project rooms, and says which room a desk is in', (t) => {
  const home = tmp(t, 'floorplan');
  const kenna = path.join(home, 'kenna');
  mkdirSync(kenna);
  const data = path.join(home, 'floor', '.agent-office');
  mkdirSync(data, { recursive: true });
  const plan = new FloorPlanStore(data, home);
  const furniture = [room('kenna-room', desk1.x, desk1.z, 4, 4, { dir: kenna, url: 'http://localhost:3000' })];
  assert.equal(plan.layout({ desks: {}, furniture }, 0, () => false), undefined);
  assert.deepEqual(plan.deskProject('desk-1'), { room: 'kenna-room', name: 'Kenna', dir: kenna, url: 'http://localhost:3000/' });
  assert.equal(new FloorPlanStore(data, home).deskProject('desk-1')?.dir, kenna);
  assert.equal(plan.deskProject('desk-9'), undefined);
  // A room whose folder isn't there isn't saved.
  assert.match(plan.layout({ desks: {}, furniture: [room('gone', 0, 0, 4, 4, { dir: path.join(home, 'gone') })] }, 1, () => false)!, /no folder/);
});

test('a project brief says where the project is, and not to switch branches in it', () => {
  const p = { room: 'kenna-room', name: 'Kenna', dir: '/Users/a/kenna', url: 'http://localhost:3000/' };
  const brief = projectBrief(p, true);
  for (const line of ['Kenna room', 'Your working folder is the project itself: /Users/a/kenna', 'http://localhost:3000/', 'do not switch branches']) assert.ok(brief.includes(line), line);
  assert.ok(projectBrief(p, false).includes('Its project is in /Users/a/kenna'));
  assert.ok(projectBrief({ room: 'r', name: 'Empty' }, true).includes('no project folder set yet'));
  assert.deepEqual(cleanWorkerProject({ room: 'kenna-room', name: 'Kenna', dir: 'relative', url: 'javascript:alert(1)' }), { room: 'kenna-room', name: 'Kenna' });
  assert.equal(cleanWorkerProject({ room: '../x', name: 'Kenna' }), undefined);
});

/** Records where it was started and what it was asked, then waits. */
const fakeAgent = `#!/usr/bin/env node
require('node:fs').appendFileSync(process.env.FAKE_AGENT_LOG, JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2) }) + '\\n');
setInterval(() => {}, 1000);
`;

const events: WorkerEvents = { update() {}, remove() {}, data() {}, screen() {}, toast() {} };

async function waitFor<T>(read: () => T, ok: (v: T) => boolean, timeout = 5000): Promise<T> {
  const end = Date.now() + timeout;
  let v = read();
  while (!ok(v) && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 25));
    v = read();
  }
  assert.ok(ok(v), 'timed out');
  return v;
}

test("a worker hired at a desk in a project room starts in the project's folder, and keeps the room across a restart", async (t) => {
  const root = tmp(t, 'rooms');
  const floor = path.join(root, 'floor');
  const kenna = path.join(root, 'kenna');
  const data = path.join(floor, '.agent-office');
  mkdirSync(data, { recursive: true });
  mkdirSync(kenna);
  // Named codex, so the office runs it as Codex, which is given its first request on the command line.
  const agent = path.join(root, 'codex');
  writeFileSync(agent, fakeAgent, { mode: 0o755 });
  const log = path.join(root, 'starts.jsonl');
  writeFileSync(log, '');
  const saved = process.env.FAKE_AGENT_LOG;
  process.env.FAKE_AGENT_LOG = log;
  t.after(() => (saved === undefined ? delete process.env.FAKE_AGENT_LOG : (process.env.FAKE_AGENT_LOG = saved)));
  const starts = () => readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { cwd: string; args: string[] });
  const layout = { desks: {}, furniture: [room('kenna-room', desk1.x, desk1.z, 3, 3, { dir: kenna })] };
  const make = () => {
    const m = new WorkerManager(floor, data, agent, [], { url: 'http://127.0.0.1:1', token: '' }, events, new Ledger(data, { pauseHiring: false }, () => {}, () => {}));
    m.projectAt = (deskId) => deskProject(layout, deskId);
    t.after(() => m.shutdown());
    return m;
  };
  const workers = make();

  const w = workers.spawn('desk-1', 'Cody', 'Fix the loader');
  assert.equal(typeof w, 'object', String(w));
  if (typeof w === 'string') return;
  assert.deepEqual(w.project, { room: 'kenna-room', name: 'Kenna', dir: kenna });
  const [start] = await waitFor(starts, (s) => s.length === 1);
  assert.equal(realpathSync(start.cwd), kenna);
  const asked = start.args.join(' ');
  assert.ok(asked.includes('Kenna room') && asked.includes('Fix the loader'), asked);

  // A desk outside the room is the floor's, as ever.
  const far = DESKS.find((d) => Math.abs(d.x - desk1.x) > 2 || Math.abs(d.z - desk1.z) > 2)!;
  const out = workers.spawn(far.id, 'Cody', 'Tidy up');
  assert.ok(typeof out === 'object' && !out.project, String(out));
  await waitFor(starts, (s) => s.length === 2);
  assert.equal(realpathSync(starts()[1].cwd), realpathSync(floor));

  // It comes back in its room after a restart.
  workers.shutdown();
  const again = make();
  assert.deepEqual(again.get(w.id)?.project, w.project);
});

test('hiring into a project room with a worktree of the floor is refused', (t) => {
  const root = tmp(t, 'rooms-wt');
  const data = path.join(root, '.agent-office');
  mkdirSync(data, { recursive: true });
  const m = new WorkerManager(root, data, path.join(root, 'nothing'), [], { url: 'http://127.0.0.1:1', token: '' }, events, new Ledger(data, { pauseHiring: false }, () => {}, () => {}));
  t.after(() => m.shutdown());
  m.projectAt = (deskId) => (deskId === 'desk-1' ? { room: 'kenna-room', name: 'Kenna', dir: root } : undefined);
  assert.match(String(m.spawn('desk-1', 'Cody', 'Go', true)), /Kenna room work in its project folder/);
});
