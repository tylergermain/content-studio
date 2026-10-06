import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FloorPlanStore } from '../src/server/floorplan.js';
import { deskProject } from '../src/server/project-rooms.js';
import { Ledger } from '../src/server/usage.js';
import { WorkerManager, type WorkerEvents } from '../src/server/workers.js';
import { cleanFurniture, type Piece } from '../src/shared/furniture.js';
import { DESKS, deskBuilt, nextFreeSeat } from '../src/shared/layout.js';
import { layoutProblems, validateLayout } from '../src/shared/office-builder.js';
import { projectRoomAt } from '../src/shared/project-rooms.js';
import type { GhPull, WorkerInfo } from '../src/shared/protocol.js';
import { workerPr } from '../src/shared/status.js';
import { FACTORY_ROOM, softwareFactory } from '../src/shared/software-factory.js';
import { TABLE, TABLE_BLOCKS, assignTableSeats, seatingOf, tableSeats } from '../src/shared/table-seats.js';

// The Software Factory (shared/software-factory.ts): project rooms off a hallway, one for each GitHub repository the
// floor works on, whose workers sit round a conference table (shared/table-seats.ts) and work in worktrees of it.

function tmp(t: { after(fn: () => void): void }, name: string): string {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), `agent-office-${name}-`)));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function factory(): Piece[] {
  const f = cleanFurniture(softwareFactory());
  assert.ok(Array.isArray(f), String(f));
  return f as Piece[];
}

test('a conference table seats six round it, facing in, wherever it is turned', () => {
  const seats = tableSeats({ x: 2, z: 3, rotY: 0, seats: 7 });
  assert.deepEqual(seats.map((s) => s.id), ['seat-7', 'seat-8', 'seat-9', 'seat-10', 'seat-11', 'seat-12']);
  for (const s of seats) {
    assert.ok(s.table, s.id);
    // Each laptop is on the table.
    assert.ok(Math.abs(s.x - 2) <= TABLE.width / 2 && Math.abs(s.z - 3) <= TABLE.depth / 2, `${s.id} at ${s.x},${s.z}`);
    // And its worker sits outside it, on the seat's +z side as at a desk: facing the middle.
    const out = { x: s.x + Math.sin(s.rotY), z: s.z + Math.cos(s.rotY) };
    assert.ok(Math.hypot(out.x - 2, out.z - 3) > Math.hypot(s.x - 2, s.z - 3), s.id);
  }
  // Turned a quarter, the chairs go round with it: as far from its middle as they were.
  const turned = tableSeats({ x: 2, z: 3, rotY: Math.PI / 2, seats: 7 });
  seats.forEach((s, i) => assert.ok(Math.abs(Math.hypot(s.x - 2, s.z - 3) - Math.hypot(turned[i].x - 2, turned[i].z - 3)) < 0.01, s.id));
  assert.ok(Math.abs(turned[0].x - seats[0].x) > 0.1);
  // A table without a block of its own seats nobody.
  for (const bad of [undefined, 0, 2, 73, 1.5]) assert.deepEqual(tableSeats({ x: 0, z: 0, rotY: 0, seats: bad }), []);
});

test('each table keeps its block of chairs, and a floor takes twelve at most', () => {
  const table = (id: string, seats?: number): Piece => ({ id, kind: 'conference-table', x: 0, z: 0, rotY: 0, ...(seats ? { seats } : {}) });
  const out = assignTableSeats([table('a', 7), table('b', 7), table('c'), table('d', 4)]);
  assert.ok(Array.isArray(out), String(out));
  const blocks = (out as Piece[]).map((p) => p.seats);
  assert.equal(blocks[0], 7);
  assert.equal(new Set(blocks).size, 4);
  for (const b of blocks) assert.equal((b! - 1) % TABLE.seats, 0);
  assert.match(String(assignTableSeats(Array.from({ length: TABLE_BLOCKS + 1 }, (_, i) => table(`t${i}`)))), /at most 12 conference tables/);
  // The builder keeps a table's block as it saves it.
  const kept = cleanFurniture([{ id: 't', kind: 'conference-table', x: 0, z: 0, rotY: 0, seats: 13 }]);
  assert.equal((kept as Piece[])[0].seats, 13);
});

test('the Software Factory is seven project rooms off a hallway, a table in each, with nothing in the way', () => {
  const f = factory();
  assert.equal(layoutProblems({ desks: {}, furniture: f }, FACTORY_ROOM).size, 0);
  assert.equal(typeof validateLayout({}, f, FACTORY_ROOM), 'object');
  const rooms = f.filter((p) => p.kind === 'project-room');
  const tables = f.filter((p) => p.kind === 'conference-table');
  assert.equal(rooms.length, 7);
  assert.equal(tables.length, 7);
  // Each room has its table, and the table's chairs are in the room.
  const roomOf = (x: number, z: number) => projectRoomAt(f, x, z)?.id;
  assert.deepEqual(new Set(tables.map((t) => roomOf(t.x, t.z))), new Set(rooms.map((r) => r.id)));
  for (const t of tables) for (const s of tableSeats(t)) assert.equal(roomOf(s.x, s.z), roomOf(t.x, t.z), s.id);
  // And the hallway between the rooms is no room's.
  assert.equal(roomOf(0, 1), undefined);
  // Its rooms are named as it's asked.
  const named = softwareFactory(['API', 'Web']).filter((p) => p.kind === 'project-room').map((p) => p.text);
  assert.deepEqual(named.slice(0, 2), ['API', 'Web']);
});

test('a floor seated at tables has no desks or bean bags: its workers take the chairs', () => {
  const f = factory();
  const here = seatingOf({ furniture: f, room: FACTORY_ROOM });
  assert.equal(here.only, true);
  assert.equal(here.tables.size, 42);
  assert.equal(deskBuilt(DESKS[0], 0, here), false);
  assert.equal(nextFreeSeat(() => false, 0, here)?.table, true);
  assert.equal(nextFreeSeat((id) => here.tables.has(id), 0, here), undefined);
  // A floor with tables as well as desks still fills its desks first.
  const both = seatingOf({ furniture: f });
  assert.equal(both.only, false);
  assert.equal(deskBuilt(DESKS[0], 0, both), true);
  assert.equal(nextFreeSeat(() => false, 0, both)?.table, undefined);
  // A chair at a table that isn't on the floor isn't built.
  assert.equal(deskBuilt({ id: 'seat-72', x: 0, z: 0, rotY: 0, label: 'Chair 72', table: true }, 0, here), false);
});

test('a room is named and set up for a repository, cleared again, and its table stays while anyone is at it', (t) => {
  const home = tmp(t, 'factory-plan');
  const repo = path.join(home, 'projects', 'acme', 'api');
  mkdirSync(repo, { recursive: true });
  const data = path.join(home, 'floor', '.agent-office');
  mkdirSync(data, { recursive: true });
  const plan = new FloorPlanStore(data, home);
  const f = factory();
  // Nobody's left at a desk when the floor is seated at its tables.
  assert.match(String(plan.layout({ desks: {}, furniture: f, room: FACTORY_ROOM }, 0, (id) => id === 'desk-1')), /desks and bean bags home/);
  assert.equal(plan.layout({ desks: {}, furniture: f, room: FACTORY_ROOM }, 0, () => false), undefined);
  assert.equal(plan.seating().only, true);

  const room = f.find((p) => p.kind === 'project-room')!;
  const table = f.find((p) => p.kind === 'conference-table' && projectRoomAt(f, p.x, p.z)?.id === room.id)!;
  const chair = tableSeats(table)[0].id;
  const set = plan.setRoom(room.id, { name: '  API  ', project: { dir: repo, repo: 'acme/api', git: true } });
  assert.equal(typeof set, 'object', String(set));
  assert.equal((set as Piece).text, 'API');
  // Its doorway's sign is renamed with it, and no other room's.
  const signs = JSON.parse(readFileSync(path.join(data, 'floorplan.json'), 'utf8')).furniture.filter((p: Piece) => p.kind === 'doorway').map((p: Piece) => p.text);
  assert.deepEqual(signs.filter((s: string) => s === 'API').length, 1);
  assert.ok(signs.includes('Room 2'), signs.join());
  assert.deepEqual(plan.deskProject(chair), { room: room.id, name: 'API', dir: repo, repo: 'acme/api' });
  // It's kept, and the builder's next save has to start from it.
  assert.equal(new FloorPlanStore(data, home).deskProject(chair)?.repo, 'acme/api');
  assert.match(String(plan.layout({ desks: {}, furniture: f, room: FACTORY_ROOM }, 1, () => false)), /layout changed/);

  // Its table doesn't go while someone's at it.
  const without = f.filter((p) => p.id !== table.id);
  assert.match(String(plan.layout({ desks: {}, furniture: without, room: FACTORY_ROOM }, 2, (id) => id === chair)), /conference table away/);

  assert.equal(typeof plan.setRoom(room.id, { project: null }), 'object');
  assert.equal(plan.deskProject(chair)?.dir, undefined);
  assert.equal(plan.deskProject(chair)?.name, 'API');
  assert.match(String(plan.setRoom('nope', { name: 'X' })), /no such room/);
  // A folder outside the home folder isn't a room's.
  assert.match(String(plan.setRoom(room.id, { project: { dir: '/etc', repo: 'acme/etc' } })), /home folder|inside/);
});

/** Records where it was started and what it was asked, then waits. */
const fakeAgent = `#!/usr/bin/env node
require('node:fs').appendFileSync(process.env.FAKE_AGENT_LOG, JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2) }) + '\\n');
setInterval(() => {}, 1000);
`;
const events: WorkerEvents = { update() {}, remove() {}, data() {}, screen() {}, toast() {} };

test("a worker hired at a room's table works in a worktree of the room's repository, kept out of its git", async (t) => {
  const root = tmp(t, 'factory-hire');
  const floor = path.join(root, 'floor');
  const data = path.join(floor, '.agent-office');
  mkdirSync(data, { recursive: true });
  const repo = path.join(root, 'api');
  mkdirSync(repo);
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q', '-b', 'main');
  writeFileSync(path.join(repo, 'README.md'), 'api\n');
  git('add', '.');
  git('commit', '-q', '-m', 'first');

  const agent = path.join(root, 'codex');
  writeFileSync(agent, fakeAgent, { mode: 0o755 });
  const log = path.join(root, 'starts.jsonl');
  writeFileSync(log, '');
  const saved = process.env.FAKE_AGENT_LOG;
  process.env.FAKE_AGENT_LOG = log;
  t.after(() => (saved === undefined ? delete process.env.FAKE_AGENT_LOG : (process.env.FAKE_AGENT_LOG = saved)));

  const f = factory();
  const room = f.find((p) => p.kind === 'project-room')!;
  room.text = 'API';
  room.project = { dir: repo, repo: 'acme/api', git: true };
  const table = f.find((p) => p.kind === 'conference-table' && projectRoomAt(f, p.x, p.z)?.id === room.id)!;
  const chair = tableSeats(table)[0].id;
  const layout = { desks: {}, furniture: f };
  const m = new WorkerManager(floor, data, agent, [], { url: 'http://127.0.0.1:1', token: '' }, events, new Ledger(data, { pauseHiring: false }, () => {}, () => {}));
  t.after(() => m.shutdown());
  m.projectAt = (deskId) => deskProject(layout, deskId);
  m.seating = () => seatingOf({ furniture: f, room: FACTORY_ROOM });

  // No desks on this floor.
  assert.match(String(m.spawn('desk-1', 'Cody', 'Go')), /conference tables/);
  const w = m.spawn(chair, 'Cody', 'Add a health check', true);
  assert.equal(typeof w, 'object', String(w));
  if (typeof w === 'string') return;
  assert.equal(w.project?.repo, 'acme/api');
  assert.equal(w.worktree?.root, repo);
  const folder = path.join(repo, w.worktree!.path);
  assert.ok(existsSync(path.join(folder, 'README.md')), folder);
  assert.ok(git('worktree', 'list').includes(w.worktree!.branch));
  // The worktrees folder is out of the repository's git.
  assert.match(readFileSync(path.join(repo, '.git', 'info', 'exclude'), 'utf8'), /\.agent-office/);
  assert.equal(git('status', '--porcelain'), '');

  const end = Date.now() + 5000;
  let starts: { cwd: string; args: string[] }[] = [];
  while (!starts.length && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 25));
    starts = readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  }
  assert.equal(realpathSync(starts[0].cwd), realpathSync(folder));
  const asked = starts[0].args.join(' ');
  assert.ok(asked.includes(w.worktree!.branch) && asked.includes('pull request'), asked);
});

test("a room worker's pull request isn't mistaken for the floor's of the same number", () => {
  const w = { id: 'w1', worktree: { path: '.agent-office/worktrees/pixel', branch: 'office/pixel', root: '/Users/a/acme/api' }, pr: { number: 5, url: 'https://github.com/acme/api/pull/5' } } as unknown as WorkerInfo;
  const floorPulls = [{ number: 5, state: 'MERGED', headRefName: 'someone-else' }] as unknown as GhPull[];
  assert.deepEqual(workerPr(w, floorPulls, []), { state: 'open', number: 5 });
  // On the floor's own repository it's the floor's list that says.
  const own = { ...w, worktree: { ...w.worktree!, root: undefined } } as WorkerInfo;
  assert.deepEqual(workerPr(own, floorPulls, []), { state: 'merged', number: 5 });
});
