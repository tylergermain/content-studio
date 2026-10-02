import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WING } from '../src/shared/layout.js';
import { ADMINS_BUILD, elevatorWords, expandSign } from '../src/client/ui/building-admin.js';

// Managing the building is the admins': what the elevator and the back office's sign tell everyone else.

const ADDING = /\badd\b|repositor|clone/i;

test('the elevator tells an admin how to add a project, and everyone else only where to ride', () => {
  for (const floors of [0, 1, 3]) {
    const admin = elevatorWords({ admin: true, setup: true, floors });
    const member = elevatorWords({ admin: false, setup: true, floors });
    assert.equal(member.title, admin.title);
    assert.equal(member.footer, admin.footer);
    assert.match(admin.intro!, ADDING);
    if (floors) assert.doesNotMatch(member.intro!, ADDING);
  }
  assert.equal(elevatorWords({ admin: false, setup: true, floors: 2 }).intro, 'Every project is a floor of this building. Pick a floor to ride to.');
  assert.equal(elevatorWords({ admin: true, setup: true, floors: 2 }).intro, 'Every project is a floor of this building. Pick a floor to ride to, or add another project.');
  // On a floor already: just the elevator, the same for both.
  for (const admin of [true, false]) assert.deepEqual(elevatorWords({ admin, setup: false, floors: 2 }), { title: '🛗 Elevator', intro: null, footer: 'Pick a floor · Esc to stay here' });
});

test('on an office with no floors, the welcome tells a member an admin has to add the first one', () => {
  const member = elevatorWords({ admin: false, setup: true, floors: 0 });
  assert.match(member.title, /Welcome/);
  assert.match(member.intro!, /An admin has to add the first floor/);
  assert.doesNotMatch(member.intro!, /Pick one of your repositories/);
  assert.match(elevatorWords({ admin: true, setup: true, floors: 0 }).intro!, /Pick one of your repositories/);
});

test('the back office sign offers E to admins only, at every row', () => {
  const keys = new Set<string>();
  for (let level = 0; level <= WING.rows; level++) {
    const admin = expandSign(level, true);
    const member = expandSign(level, false);
    assert.ok(admin.action, `an admin has something to do with ${level} rows built`);
    assert.equal(member.action, null);
    assert.equal(member.title, admin.title);
    // Built all the way out, there's nothing left for an admin to build either.
    if (level < WING.rows) assert.match(member.aside, /an admin builds it out$/);
    else assert.equal(member.aside, admin.aside);
    keys.add(admin.k).add(member.k);
  }
  // The hint bar redraws when the level changes, and when you're made an admin or stop being one.
  assert.equal(keys.size, (WING.rows + 1) * 2);
  assert.deepEqual(expandSign(0, true), { k: '0', title: '🚧 Room to grow through the wall', aside: 'the office can get bigger here', action: 'Knock through: 2 more desks' });
  assert.deepEqual(expandSign(WING.rows, true), { k: 'full', title: '🏢 Back office', aside: 'built all the way out', action: 'Wall a row up' });
});

test('the page and the office refuse the back office in the same words', () => {
  const server = readFileSync(new URL('../src/server/ws/handlers/plan.ts', import.meta.url), 'utf8');
  assert.ok(server.includes(`'${ADMINS_BUILD}'`), 'plan.ts warns with ADMINS_BUILD');
});

test('nothing in the elevator for adding or changing a floor is built for anyone but an admin', () => {
  const src = readFileSync(new URL('../src/client/ui/elevator.ts', import.meta.url), 'utf8');
  const between = (from: string, to: string) => {
    const a = src.indexOf(from);
    const b = src.indexOf(to, a);
    assert.ok(a >= 0 && b > a, `elevator.ts still has ${from} … ${to}`);
    return src.slice(a, b);
  };
  // The floor's row: the stop, rename, move and remove buttons come after the admin check.
  const row = between('const floorRow =', 'const confirmRemove =');
  const gate = row.indexOf('if (!store.me.admin) return btn;');
  assert.ok(gate >= 0, 'floorRow hands anyone else the bare button');
  for (const tool of ['floor.cancel', 'floorTools(', 'confirmRemove(']) assert.ok(row.indexOf(tool) > gate, `${tool} is an admin's`);
  // Under the floors: "Add a project", the repository list and the folder controls.
  const add = between('const renderAdd =', 'const addingFloor =');
  const out = add.indexOf('if (!store.me.admin) {');
  assert.ok(out >= 0 && add.slice(out, add.indexOf('}', out)).includes('addEl.replaceChildren();'), 'renderAdd leaves the add section empty for anyone else');
  for (const part of ['➕ Add a project', 'repo-search', 'Change folder', 'folderFloor(']) assert.ok(add.indexOf(part) > out, `${part} is an admin's`);
  // And the list of repositories is never asked for.
  const need = between('const needRepos =', "net.send({ t: 'floor.repos' })");
  assert.ok(need.includes('if (!store.me.admin) return;'), 'needRepos asks only for an admin');
});
