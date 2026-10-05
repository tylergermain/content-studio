import test from 'node:test';
import assert from 'node:assert/strict';
import { APPS, appOn, cleanApps } from '../src/shared/apps.js';
import { cleanSetup } from '../src/shared/studio.js';
import { WORKSPACES, WORKSPACE_TABS } from '../src/shared/workspace.js';

// A floor's apps (shared/apps.ts): every tab of a worker's window is one, turned on and off with a
// checkmark per floor, and Files never goes off.

test('every tab is an app, once, and Files is the one that is always on', () => {
  assert.deepEqual(APPS.map((a) => a.tab).sort(), [...WORKSPACE_TABS].sort());
  assert.deepEqual(APPS.filter((a) => a.always).map((a) => a.tab), ['files']);
  for (const a of APPS) assert.ok(a.name && a.icon && a.about && !/—/.test(a.about), a.tab);
  for (const kind of Object.values(WORKSPACES)) for (const t of kind.tabs) assert.ok(WORKSPACE_TABS.includes(t));
});

test('a floor keeps the apps it turned off, never Files, and all are on by default', () => {
  assert.equal(cleanApps(undefined), undefined);
  assert.equal(cleanApps({ off: [] }), undefined);
  assert.deepEqual(cleanApps({ off: ['watch', 'files', 'nope', 'watch', 'canvas'] }), { off: ['canvas', 'watch'] });
  const setup = cleanSetup({ apps: { off: ['read'] } });
  assert.deepEqual(setup.apps, { off: ['read'] });
  assert.ok(!appOn(setup, 'read'));
  assert.ok(appOn(setup, 'canvas'));
  assert.ok(appOn(cleanSetup({ apps: { off: ['files'] } }), 'files'));
  assert.ok(appOn(undefined, 'watch'));
  assert.equal(cleanSetup({}).apps, undefined);
});
