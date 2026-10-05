import test from 'node:test';
import assert from 'node:assert/strict';
import { pullPower } from '../src/client/features/minigolf/arcade.js';
test('mouse pull-back can build, reduce and clamp shot power without depending on cursor position', () => {
  assert.equal(pullPower(0, 110), 0.5);
  assert.equal(pullPower(0.5, -55), 0.25);
  assert.equal(pullPower(0.9, 220), 1);
  assert.equal(pullPower(0.1, -220), 0);
});
