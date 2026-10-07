import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Accounts } from '../src/server/accounts.js';
import { people, meKey } from '../src/server/office/people.js';
import { employeeViewError, employeeWorkerError, floorAccessError, workerRulesError } from '../src/server/org-chart/access.js';
import { changesHandlers } from '../src/server/ws/handlers/changes.js';
import { decorHandlers } from '../src/server/ws/handlers/decor.js';
import { workerHandlers } from '../src/server/ws/handlers/workers.js';
import { cleanFloors, mayWork, readOnlyText } from '../src/shared/floor-access.js';
import { saveChart } from '../src/server/org-chart/policy.js';
import type { OrgChart } from '../src/shared/org-chart.js';

// Which floors someone may work on (shared/floor-access.ts): an admin every floor, a member the ones they were given
// (every floor without a list). On the rest they look round and read, and the office refuses the rest.

function tmp(t: { after(fn: () => void): void }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-floor-access-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('an admin works on every floor, a member on the floors given, or on every floor with no list', () => {
  assert.equal(mayWork({ admin: true, floors: ['a'] }, 'b'), true);
  assert.equal(mayWork({ admin: false }, 'b'), true);
  assert.equal(mayWork({ admin: false, floors: ['a'] }, 'a'), true);
  assert.equal(mayWork({ admin: false, floors: ['a'] }, 'b'), false);
  assert.equal(mayWork({ admin: false, floors: [] }, 'a'), false);
  assert.deepEqual(cleanFloors(['content-os', 'content-os', 'Bad Id', 7, 'friday-studio']), ['content-os', 'friday-studio']);
  assert.equal(cleanFloors('all'), undefined);
  assert.equal(cleanFloors(undefined), undefined);
  assert.match(readOnlyText('Content Factory'), /look round Content Factory, but not work there/);
  assert.ok(!readOnlyText('X').includes('—'));
});

test("a member's invite carries their floors to the account; an admin's doesn't; an admin changes them later", async (t) => {
  const dir = tmp(t);
  const accounts = new Accounts(dir);
  const member = accounts.invite('Tyler', 'member', 'Ada', ['content-os']);
  const admin = accounts.invite('Tyler', 'admin', 'Grace', ['content-os']);
  assert.ok(typeof member === 'object' && typeof admin === 'object');
  if (typeof member === 'string' || typeof admin === 'string') return;
  assert.deepEqual(member.floors, ['content-os']);
  assert.equal(admin.floors, undefined);
  const ada = await accounts.join(member.token, 'Ada', 'correct horse battery');
  assert.ok(typeof ada === 'object');
  if (typeof ada === 'string') return;
  assert.deepEqual(ada.floors, ['content-os']);
  // Kept on disk, shown to admins with the account, and changed or opened up to every floor.
  assert.deepEqual(new Accounts(dir).get(ada.id)?.floors, ['content-os']);
  assert.deepEqual(accounts.state(new Set()).accounts.find((a) => a.id === ada.id)?.floors, ['content-os']);
  accounts.setFloors(ada.id, ['content-os', 'friday-studio']);
  assert.deepEqual(new Accounts(dir).get(ada.id)?.floors, ['content-os', 'friday-studio']);
  accounts.setFloors(ada.id, undefined);
  assert.equal(new Accounts(dir).get(ada.id)?.floors, undefined);
});

test("who you are says your floors, and changing them is news to you", async (t) => {
  const dir = tmp(t);
  const accounts = new Accounts(dir);
  const inv = accounts.invite('Tyler', 'member', 'Ada', ['content-os']);
  const ada = typeof inv === 'object' ? await accounts.join(inv.token, 'Ada', 'correct horse battery') : inv;
  assert.ok(typeof ada === 'object');
  if (typeof ada === 'string') return;
  const p = people({ accounts, clients: new Map() } as never);
  const me = p.meOf(ada.id);
  assert.deepEqual(me, { account: { name: 'Ada', role: 'member' }, admin: false, floors: ['content-os'] });
  assert.deepEqual(p.meOf(undefined), { admin: true });
  const before = meKey(me);
  accounts.setFloors(ada.id, undefined);
  assert.notEqual(meKey(p.meOf(ada.id)), before);
});

/**
 * A floor someone's read-only on, with a specialist the member owns that the org chart lets them direct (so only the
 * floor stands in their way), and the context to act on it.
 */
function setting(t: { after(fn: () => void): void }) {
  const warned: string[] = [];
  const done: string[] = [];
  const dir = tmp(t);
  const ada = { id: 'ada', name: 'Ada', role: 'member' as const, hash: '', salt: '', createdAt: 0, createdBy: 'test' };
  const chart: OrgChart = { version: 1, nodes: [{ id: 'owner', name: 'Owner' }, { id: 'producer', name: 'Producer', parent: 'owner' }, { id: 'editor', name: 'Video Editor', specialist: 'video-editor', parent: 'producer' }], assignments: { ada: 'producer' } };
  saveChart(dir, chart, [ada]);
  const info = { id: 'w1', name: 'Pixel', kind: 'agent', specialist: 'video-editor' };
  const floor = {
    id: 'content-os',
    def: { name: 'Content Factory' },
    dir,
    workers: { get: () => info, ownerOf: () => 'ada', hiringPolicy: () => undefined },
    changes: { commit: async () => (done.push('commit'), undefined), discard: async () => (done.push('discard'), undefined) },
    decor: { add: () => done.push('decor') },
  };
  let floors: string[] | undefined = ['friday-studio'];
  const ctx = {
    accounts: { get: (id: string | undefined) => (id === 'ada' ? ada : undefined), sharedPassword: true },
    meOf: (id: string | undefined) => (id === 'boss' ? { admin: true } : { admin: false, account: { name: 'Ada', role: 'member' }, ...(floors ? { floors } : {}) }),
    floorOf: () => floor,
    workerFloor: () => floor,
    warn: (_c: unknown, why: string | undefined) => why && warned.push(why),
    signins: { apply: () => ({}) },
  };
  const client = (accountId: string) => ({ id: 'c1', accountId, peer: { name: accountId, floor: floor.id }, attached: new Set(['w1']) });
  return { ctx, floor, client, warned, done, open: () => (floors = undefined) };
}

test('on a floor someone is read-only on, the office refuses directing its workers, but not reading about them', (t) => {
  const s = setting(t);
  const why = floorAccessError(s.ctx as never, s.floor as never, 'ada');
  assert.match(String(why), /look round Content Factory/);
  assert.equal(employeeWorkerError(s.ctx as never, s.floor as never, 'ada', 'w1'), why);
  // Reading its review, and its files, is the org chart's to say: their own worker's are theirs to read.
  assert.equal(workerRulesError(s.ctx as never, s.floor as never, 'ada', 'w1'), undefined);
  assert.equal(employeeViewError(s.ctx as never, s.floor as never, 'ada', 'w1'), undefined);
  assert.equal(floorAccessError(s.ctx as never, s.floor as never, 'boss'), undefined);
  s.open();
  assert.equal(floorAccessError(s.ctx as never, s.floor as never, 'ada'), undefined);
});

test("someone read-only can't commit or discard a worker's changes, hire, or change the floor; once given it, they can", async (t) => {
  const s = setting(t);
  const c = s.client('ada');
  await changesHandlers['changes.commit'](s.ctx as never, c as never, { t: 'changes.commit', workerId: 'w1', message: 'x' } as never);
  await changesHandlers['changes.discard'](s.ctx as never, c as never, { t: 'changes.discard', workerId: 'w1' } as never);
  workerHandlers['worker.spawn'](s.ctx as never, c as never, { t: 'worker.spawn', deskId: 'desk-1', prompt: 'go' } as never);
  decorHandlers['decor.add'](s.ctx as never, c as never, { t: 'decor.add', item: {} } as never);
  assert.deepEqual(s.done, []);
  assert.equal(s.warned.length, 4);
  for (const w of s.warned) assert.match(w, /look round Content Factory/);
  s.open();
  s.warned.length = 0;
  await changesHandlers['changes.commit'](s.ctx as never, c as never, { t: 'changes.commit', workerId: 'w1', message: 'x' } as never);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(s.done, ['commit']);
});
