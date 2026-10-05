// How a VR session borrows the office's frames: the frame loop handed over to the headset and back
// (core/frame-loop.ts), and the frame drawn by a takeover instead of the office's way (View.draw in
// core/registry.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { frameLoop } from '../src/client/core/frame-loop.js';
import { type Frame, Ticks, View } from '../src/client/core/registry.js';

const frame: Frame = { delta: 0.016, dt: 0.016, t: 1, now: 0 };

test('a takeover that draws the frame draws it instead: no office drawing, no filters', () => {
  const view = new View();
  const log: string[] = [];
  view.add({ filter: { begin: () => (log.push('begin'), true), end: () => void log.push('end') } });
  let on = false;
  const off = view.add({ takeover: () => on && (log.push('takeover'), true) });
  view.draw(frame, () => log.push('draw'));
  assert.deepEqual(log, ['begin', 'draw', 'end'], 'not drawing: the office draws as ever');
  log.length = 0;
  on = true;
  view.draw(frame, () => log.push('draw'));
  assert.deepEqual(log, ['takeover']);
  log.length = 0;
  off();
  view.draw(frame, () => log.push('draw'));
  assert.deepEqual(log, ['begin', 'draw', 'end'], 'taken out, the office draws again');
});

test('the first takeover that draws has the frame; one that passes leaves it to the next', () => {
  const view = new View();
  const log: string[] = [];
  view.add({ takeover: () => (log.push('a'), false) });
  view.add({ takeover: () => (log.push('b'), true) });
  view.add({ takeover: () => (log.push('c'), true) });
  view.draw(frame, () => log.push('draw'));
  assert.deepEqual(log, ['a', 'b']);
});

/** The office's loop with the browser's frames stood in for: `pending` is the frame it asked for, if any. */
function loop() {
  const ticks = new Ticks();
  const ran: Frame[] = [];
  ticks.add('pre', (f) => void ran.push(f));
  let drew = 0;
  const asked: ((ts: number) => void)[] = [];
  const raf = (fn: (ts: number) => void) => asked.push(fn);
  const fl = frameLoop({ ticks }, { drew: () => void drew++ }, raf);
  /** The browser's next frame, at `ts`: whatever the loop asked for. */
  const browser = (ts: number) => {
    const next = asked.splice(0);
    for (const fn of next) fn(ts);
    return next.length;
  };
  return { fl, ran, drew: () => drew, asked, browser };
}

test("the office's loop runs every phase each browser frame and asks for the next", () => {
  const l = loop();
  l.fl(1000);
  assert.equal(l.ran.length, 1);
  assert.equal(l.drew(), 1);
  assert.equal(l.asked.length, 1);
  assert.equal(l.browser(1016), 1);
  assert.equal(l.ran.length, 2);
  assert.ok(Math.abs(l.ran[1].delta - 0.016) < 1e-9, `delta ${l.ran[1].delta}`);
  assert.equal(l.asked.length, 1, 'one frame asked for at a time');
});

test('taken, the browser frames stop and the headset frames run the loop; given back, the browser frames resume, once', () => {
  const l = loop();
  l.fl(1000);
  l.fl.xr.take();
  // The frame already asked for comes, runs nothing and asks for no more.
  assert.equal(l.browser(1016), 1);
  assert.equal(l.ran.length, 1);
  assert.equal(l.asked.length, 0, 'parked');
  // The headset's frames run it now, on the same clock.
  l.fl.xr.step(1030);
  l.fl.xr.step(1044);
  assert.equal(l.ran.length, 3);
  assert.ok(Math.abs(l.ran[2].delta - 0.014) < 1e-9);
  assert.ok(l.ran[2].t > l.ran[1].t);
  assert.equal(l.asked.length, 0, "the headset's frames don't ask the browser for any");
  l.fl.xr.give();
  assert.equal(l.asked.length, 1, 'given back: one browser frame asked for');
  l.fl.xr.give();
  assert.equal(l.asked.length, 1, 'and only one');
  // A headset frame after it's given back runs nothing.
  l.fl.xr.step(1050);
  assert.equal(l.ran.length, 3);
  l.browser(1060);
  assert.equal(l.ran.length, 4);
  assert.equal(l.asked.length, 1);
});

test('given back before the browser frame asked for came, the loop carries on with that one: never two at once', () => {
  const l = loop();
  l.fl(1000);
  l.fl.xr.take();
  l.fl.xr.step(1010);
  l.fl.xr.give();
  assert.equal(l.asked.length, 1, 'the one already asked for');
  l.browser(1016);
  assert.equal(l.asked.length, 1);
  assert.equal(l.ran.length, 3);
});

test('a long wait between frames is felt as at most a tenth of a second', () => {
  const l = loop();
  l.fl(1000);
  l.fl.xr.take();
  l.fl.xr.step(3000);
  const last = l.ran.at(-1)!;
  assert.ok(Math.abs(last.delta - 2) < 1e-9);
  assert.equal(last.dt, 0.1);
});

test('never started, a loop given back stays stopped', () => {
  const l = loop();
  l.fl.xr.take();
  l.fl.xr.give();
  assert.equal(l.asked.length, 0);
  assert.equal(l.ran.length, 0);
});
