import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FloorPlanStore } from '../src/server/floorplan.js';
import { officeBuilderHandlers } from '../src/server/ws/handlers/office-builder.js';

function withDir(fn: (dir: string) => void) {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-look-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const free = () => false;

test("the paint a layout's saved with is the floor's look, across a restart, until it's saved with its own again", () => {
  withDir((dir) => {
    const plan = new FloorPlanStore(dir);
    assert.equal(plan.look, undefined);
    assert.equal(plan.layout({ desks: {}, furniture: [], look: 11 }, 0, free), undefined);
    assert.equal(plan.look, 11);
    assert.equal(new FloorPlanStore(dir).look, 11);
    // Not one of the palettes: the floor's own paint.
    assert.equal(plan.layout({ desks: {}, furniture: [], look: 99 }, 1, free), undefined);
    assert.equal(plan.look, undefined);
  });
});

test('a saved layout sends everyone the floors again, since its paint is its storey on the outside; a refused one sends nothing', () => {
  withDir((dir) => {
    const plan = new FloorPlanStore(dir);
    const floor = { plan, workers: { deskOccupied: free }, decor: { refit: () => false } };
    let floorsSent = 0;
    const warned: string[] = [];
    const ctx = {
      meOf: () => ({ admin: true }),
      floorOf: () => floor,
      warn: (_c: unknown, text: string) => warned.push(text),
      clients: new Map(),
      toFloor: () => {},
      toastFloor: () => {},
      broadcast: () => {},
      floorsChanged: () => floorsSent++,
    };
    const c = { accountId: 'ada', peer: { name: 'Ada', floor: 'f' } };
    const save = (revision: number) => officeBuilderHandlers['floor.layout'](ctx as never, c as never, { t: 'floor.layout', desks: {}, furniture: [], look: 10, revision });
    save(0);
    assert.deepEqual(warned, []);
    assert.equal(plan.look, 10);
    assert.equal(floorsSent, 1);
    // Arranged from a layout that's since been saved over: refused, and nothing goes out.
    save(0);
    assert.equal(warned.length, 1);
    assert.equal(floorsSent, 1);
  });
});
