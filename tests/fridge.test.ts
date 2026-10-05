// The kitchen's fridge (client/sound/ambience.ts): it hums and clunks on a floor with a kitchen, and
// on one without (RoomOptions.kitchen, see OfficeSound.setKitchen) there's no fridge to hear.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Fridge } from '../src/client/sound/ambience.js';
import type { AudioCore } from '../src/client/sound/core.js';

/** Enough of the audio for the fridge to start: every node connects to anything, and the hum's gain says what it was set to. */
function fakeAudio() {
  const levels: number[] = [];
  const clunks: number[] = [];
  const param = () => ({ value: 0, setTargetAtTime: (v: number) => levels.push(v) });
  const node = () => ({ type: '', frequency: param(), Q: param(), gain: param(), connect: <T>(to: T) => to, start() {} });
  const core = {
    ctx: { currentTime: 0, createOscillator: node, createGain: node, createBiquadFilter: node },
    indoors: node(),
    buf: { steps: [{}] },
    panner: node,
    play: (_buffer: unknown, opts: { gain: number }) => clunks.push(opts.gain),
    count() {},
  };
  return { core: core as unknown as AudioCore, levels, clunks };
}

test('the fridge kicks on and clunks off while the floor has a kitchen', () => {
  const { core, levels, clunks } = fakeAudio();
  const fridge = new Fridge(core);
  fridge.startFridge();
  // It starts off, and comes on within its first twelve seconds.
  fridge.tickFridge(1);
  assert.deepEqual(levels, []);
  fridge.tickFridge(13);
  assert.deepEqual(levels, [0.06]);
  assert.equal(clunks.length, 1);
  // And off again within fifty.
  fridge.tickFridge(64);
  assert.deepEqual(levels, [0.06, 0]);
  assert.equal(clunks.length, 2);
});

test('on a floor with no kitchen the fridge stops without a clunk, and stays off', () => {
  const { core, levels, clunks } = fakeAudio();
  const fridge = new Fridge(core);
  fridge.startFridge();
  fridge.tickFridge(13);
  assert.deepEqual(levels, [0.06]);
  fridge.quiet = true;
  fridge.tickFridge(14);
  assert.deepEqual(levels, [0.06, 0], 'the hum is turned down at once');
  assert.equal(clunks.length, 1, 'with no clunk of its own');
  for (let now = 15; now < 400; now += 0.5) fridge.tickFridge(now);
  assert.deepEqual(levels, [0.06, 0]);
  assert.equal(clunks.length, 1);
});

test('back on a floor with a kitchen, the fridge starts up again a little later', () => {
  const { core, levels, clunks } = fakeAudio();
  const fridge = new Fridge(core);
  fridge.startFridge();
  fridge.quiet = true;
  for (let now = 0; now < 100; now += 0.5) fridge.tickFridge(now);
  assert.deepEqual(levels, []);
  fridge.quiet = false;
  // Not the moment you arrive: at least three seconds on, and within twelve.
  fridge.tickFridge(100);
  fridge.tickFridge(102.4);
  assert.deepEqual(levels, []);
  fridge.tickFridge(112.5);
  assert.deepEqual(levels, [0.06]);
  assert.equal(clunks.length, 1);
});
