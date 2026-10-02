import test from 'node:test';
import assert from 'node:assert/strict';
import { canDunk, dunkShot } from '../src/shared/dunk.js';
import { HOOP, launch, simulate, throwOk, backboard, type BallHit } from '../src/shared/hoop.js';

test('dunk eligibility requires a jump within reach of the actual rim', () => {
  const near = { x: HOOP.rim.x + 1, y: 0.9, z: HOOP.rim.z };
  assert.ok(canDunk(near, false));
  assert.equal(canDunk(near, true), false);
  assert.equal(canDunk({ ...near, y: 0.1 }, false), false);
  assert.equal(canDunk({ ...near, x: HOOP.rim.x + 2 }, false), false);
  assert.equal(canDunk({ ...near, y: 8 }, false), false);
  assert.equal(canDunk({ ...near, x: NaN }, false), false);
});

test('a dunk is an accepted synchronized throw and scores once through the net', () => {
  const shot = dunkShot();
  assert.ok(throwOk(shot));
  const sim = launch(shot), hits: BallHit[] = [];
  simulate(sim, 0.5, [backboard()], hits);
  assert.ok(sim.scored);
  assert.equal(hits.filter(h => h.kind === 'score').length, 1);
  assert.equal(sim.touched.board, false);
  assert.equal(sim.touched.rim, false);
  simulate(sim, 0.5, [backboard()], hits);
  assert.equal(hits.filter(h => h.kind === 'score').length, 1);
});
