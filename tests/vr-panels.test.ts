import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FOLLOW,
  HINT,
  KEYBOARD,
  SHEET,
  WINDOW,
  angleDiff,
  backAction,
  clientToUv,
  easePose,
  forward,
  hintPose,
  isSheet,
  keyboardPose,
  lazyAim,
  metresPerPx,
  offGaze,
  placeAhead,
  pushPull,
  shouldRecenter,
  stack,
  textureScale,
  uvToClient,
  type HeadPose,
} from '../src/client/features/vr/panels/layout.js';
import { boardFor, keyAt, keyRows, placeKeys, repeats } from '../src/client/features/vr/panels/keyboard-layout.js';
import { DirtyRects, PACE, due } from '../src/client/features/vr/panels/dirty.js';
import { fit, parseLinear, radiiOf, splitTop } from '../src/client/features/vr/panels/paint-parts.js';

// VR's panels (features/vr/panels): where a window, the hint strip and the keyboard go and when a
// window comes back in front of you, how a point on a panel maps to the page, the keyboard's keys,
// which panel B / Y closes, what a paint repaints and when, and the painter's pure pieces.

const DEG = Math.PI / 180;
const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);
const head = (yaw = 0, pitch = 0, x = 0, z = 0): HeadPose => ({ position: { x, y: 1.6, z }, yaw, pitch });

test('you look along (-sin yaw, -cos yaw), and up with pitch', () => {
  const f = forward(0);
  near(f.x, 0);
  near(f.z, -1);
  const r = forward(Math.PI / 2);
  near(r.x, -1);
  near(r.z, 0);
  const up = forward(0, 30 * DEG);
  near(up.y, 0.5);
});

test('a window goes a meter ahead, a little under the eyes, facing you', () => {
  const p = placeAhead(head(Math.PI / 2, 0.4, 2, 3), WINDOW.dist, WINDOW.drop);
  near(p.position.x, 2 - 1);
  near(p.position.z, 3);
  near(p.position.y, 1.6 - WINDOW.drop);
  // Upright (the gaze's pitch doesn't tip it), and turned to you: a plane's front (+z) rotated by yaw.
  assert.equal(p.pitch, 0);
  near(p.yaw, Math.PI / 2);
  const front = { x: Math.sin(p.yaw), z: Math.cos(p.yaw) };
  near(front.x, 1);
  near(front.z, 0);
});

test('a window covering more than 80% of the screen is a sheet, 1.8 m wide whatever the screen', () => {
  assert.equal(isSheet(1280, 720, 1280, 720), true);
  assert.equal(isSheet(1200, 640, 1280, 720), true);
  assert.equal(isSheet(560, 640, 1280, 720), false);
  assert.equal(isSheet(100, 100, 0, 0), false);
  near(metresPerPx('sheet', 1280) * 1280, SHEET.width);
  near(metresPerPx('sheet', 1920) * 1920, SHEET.width);
  near(metresPerPx('window', 1280), 0.0011);
  // The hint, further off, is as big to the eye as a window.
  near(metresPerPx('hint', 1280) / HINT.dist, metresPerPx('window', 1280) / WINDOW.dist);
});

test('a panel texture is 1.5 px a CSS px, less when it would pass 2048 on a side', () => {
  assert.equal(textureScale(560, 600, 1.5), 1.5);
  near(textureScale(1920, 1080, 1.5), 2048 / 1920);
  assert.ok(textureScale(100_000, 10, 1.5) >= 0.25);
});

test('uv on a panel is a client point on the page, and back', () => {
  const r = { x: 360, y: 60, w: 560, h: 600 };
  assert.deepEqual(uvToClient(0, 1, r), { x: 360, y: 60 });
  assert.deepEqual(uvToClient(1, 0, r), { x: 920, y: 660 });
  assert.deepEqual(uvToClient(0.5, 0.5, r), { x: 640, y: 360 });
  const p = { x: 500, y: 100 };
  const uv = clientToUv(p.x, p.y, r);
  const back = uvToClient(uv.u, uv.v, r);
  near(back.x, p.x);
  near(back.y, p.y);
  // Off the panel: outside 0..1, for a drag that's captured.
  assert.ok(clientToUv(1000, 10, r).u > 1);
});

test('angles: the short way round', () => {
  near(angleDiff(0.1, -0.1), 0.2);
  near(angleDiff(Math.PI - 0.1, -Math.PI + 0.1), -0.2);
  near(offGaze(head(), { x: 0, y: 1.6, z: -1 }), 0);
  near(offGaze(head(), { x: -1, y: 1.6, z: 0 }), 90);
});

test('a window stays put until you look 55° away for 0.6 s', () => {
  const st = { away: 0 };
  const at = { x: 0, y: 1.52, z: -1 };
  // Looking at it: nothing.
  for (let i = 0; i < 100; i++) assert.equal(shouldRecenter(st, head(), at, 1 / 72), false);
  // Turned 90° away: only after 0.6 s.
  const away = head(Math.PI / 2);
  let t = 0;
  while (!shouldRecenter(st, away, at, 1 / 72)) {
    t += 1 / 72;
    assert.ok(t < 1, 'it came back');
  }
  near(t, FOLLOW.after, 2 / 72);
  // A glance (40°) never brings it.
  for (let i = 0; i < 200; i++) assert.equal(shouldRecenter(st, head(40 * DEG), at, 1 / 72), false);
});

test('a window more than 2.2 m off (the elevator, a seat) comes back at once, pinned or not', () => {
  const st = { away: 0 };
  assert.equal(shouldRecenter(st, head(0, 0, 0, 3), { x: 0, y: 1.5, z: 0 }, 1 / 72, true), true);
  // One you put somewhere yourself stays where you looked away from it.
  for (let i = 0; i < 200; i++) assert.equal(shouldRecenter(st, head(Math.PI), { x: 0, y: 1.5, z: -1 }, 1 / 72, true), false);
});

test('a window a seat has moved you onto (under 0.45 m) comes back at once, unless you pulled it there', () => {
  const st = { away: 0 };
  // Sitting at the boss's desk: its window was opened a meter ahead of where you stood, 0.25 m from where you sit.
  assert.equal(shouldRecenter(st, head(0, 0, 0, -0.75), { x: 0, y: 1.52, z: -1 }, 1 / 72), true);
  // A meter off, and leaning in to read it from 0.5 m, it stays.
  for (let i = 0; i < 100; i++) assert.equal(shouldRecenter(st, head(), { x: 0, y: 1.52, z: -1 }, 1 / 72), false);
  for (let i = 0; i < 100; i++) assert.equal(shouldRecenter(st, head(0, 0, 0, -0.5), { x: 0, y: 1.52, z: -1 }, 1 / 72), false);
  // Pulled up close with the grip and the stick: yours to keep there.
  for (let i = 0; i < 100; i++) assert.equal(shouldRecenter(st, head(0, 0, 0, -0.65), { x: 0, y: 1.52, z: -1 }, 1 / 72, true), false);
});

test('easing a panel back goes the short way round and lands', () => {
  const a = { position: { x: 0, y: 1, z: 0 }, yaw: Math.PI - 0.1, pitch: 0 };
  const b = { position: { x: 1, y: 1, z: 1 }, yaw: -Math.PI + 0.1, pitch: 0 };
  const mid = easePose(a, b, 0.5);
  near(Math.abs(angleDiff(mid.yaw, Math.PI)), 0, 1e-9);
  near(mid.position.x, 0.5);
  assert.deepEqual(easePose(a, b, 1).position, b.position);
  assert.deepEqual(easePose(a, b, 0).position, a.position);
});

test('the hint strip hangs 24° under your gaze, 1.4 m off, and follows it lazily', () => {
  let aim = { yaw: 0, pitch: -HINT.below * DEG };
  // Still inside the dead zone: it doesn't move.
  assert.equal(lazyAim(aim, head(3 * DEG), 1 / 72), aim);
  // Turned 60°: it eases after you, not all at once.
  const turned = head(60 * DEG);
  const once = lazyAim(aim, turned, 1 / 72);
  assert.ok(once.yaw > 0 && once.yaw < 10 * DEG);
  for (let i = 0; i < 300; i++) aim = lazyAim(aim, turned, 1 / 72);
  assert.ok(Math.abs(aim.yaw - 60 * DEG) < (HINT.dead + 0.5) * DEG);
  const p = hintPose(head(), { yaw: 0, pitch: -HINT.below * DEG });
  const d = Math.hypot(p.position.x, p.position.y - 1.6, p.position.z);
  near(d, HINT.dist);
  assert.ok(p.position.y < 1.6 - 0.5);
});

test('the keyboard lies tilted back under a window, nearer you; on its own, ahead and low', () => {
  const win = { pose: placeAhead(head(), WINDOW.dist, WINDOW.drop), height: 0.6 };
  const k = keyboardPose(head(), win, 0.25);
  near(k.pitch, -KEYBOARD.tilt * DEG);
  assert.ok(k.position.y < win.pose.position.y - win.height / 2, 'under the window');
  assert.ok(k.position.z > win.pose.position.z, 'nearer you');
  near(k.yaw, win.pose.yaw);
  const alone = keyboardPose(head(Math.PI), null, 0.25);
  near(alone.position.z, KEYBOARD.dist);
  near(alone.position.y, 1.6 - KEYBOARD.drop);
});

test('a grabbed panel is pushed and pulled by the stick, within reach', () => {
  near(pushPull(1, 1, 0.5), 1.75);
  near(pushPull(1, -1, 10), 0.35);
  near(pushPull(1, 1, 10), 4);
});

test('the hint stacks the newest toasts over the hint bar, centered', () => {
  const s = stack([{ w: 200, h: 40 }, { w: 400, h: 44 }]);
  assert.equal(s.w, 400);
  assert.equal(s.h, 40 + 8 + 44);
  assert.deepEqual(s.at, [{ x: 100, y: 0 }, { x: 0, y: 48 }]);
  assert.deepEqual(stack([]), { at: [], w: 0, h: 0 });
});

test('B / Y: the option list, then the window (Escape decides), the keyboard, the HUD, else Escape', () => {
  const none = { options: false, window: false, keyboard: false, sheet: false };
  assert.equal(backAction(none), 'escape');
  assert.equal(backAction({ ...none, options: true, window: true }), 'options');
  assert.equal(backAction({ ...none, window: true, keyboard: true, sheet: true }), 'escape');
  assert.equal(backAction({ ...none, keyboard: true, sheet: true }), 'keyboard');
  assert.equal(backAction({ ...none, sheet: true }), 'sheet');
});

test('the keyboard: every row fits, and a point on a key is that key', () => {
  for (const layer of ['letters', 'symbols'] as const) {
    for (const shift of [false, true]) {
      for (const terminal of [false, true]) {
        const rows = keyRows(layer, shift, terminal);
        assert.equal(rows.length, terminal ? 5 : 4);
        for (const row of rows) assert.ok(row.reduce((n, k) => n + k.w, 0) <= 10 + 1e-9, `a ${layer} row is too wide`);
        const board = placeKeys(rows);
        // Each key's own centre finds it, and no two keys overlap.
        for (const k of board.keys) assert.equal(keyAt(board, k.x + k.w / 2, 1 - (k.y + k.h / 2))?.key.id, k.key.id);
      }
    }
  }
  const board = boardFor('letters', false, false);
  const q = board.keys.find((k) => k.key.text === 'q')!;
  assert.equal(keyAt(board, q.x + 0.001, 1 - (q.y + 0.001))?.key.text, 'q');
  // Off the board, and in the margin: nothing.
  assert.equal(keyAt(board, 0.001, 0.999), null);
  assert.equal(keyAt(board, 1.5, 0.5), null);
  // Shift is upper case; the terminal row comes on top with Esc, Tab, Ctrl and the arrows.
  assert.ok(boardFor('letters', true, false).keys.some((k) => k.key.text === 'Q'));
  const term = keyRows('letters', false, true)[0].map((k) => k.label);
  assert.deepEqual(term, ['Esc', 'Tab', 'Ctrl', '←', '↑', '↓', '→']);
  const last = keyRows('letters', false, false).at(-1)!.map((k) => k.act);
  for (const act of ['layer', 'mic', 'space', 'enter', 'hide'] as const) assert.ok(last.includes(act));
  assert.ok(boardFor('symbols', false, false).keys.some((k) => k.key.text === '1'));
  // ⌫ and the arrows repeat; letters don't.
  assert.equal(repeats(board.keys.find((k) => k.key.act === 'back')!.key), true);
  assert.equal(repeats(q.key), false);
  // A terminal row makes the board taller.
  assert.ok(boardFor('letters', false, true).aspect > board.aspect);
});

test('dirty rects: a change repaints round it, many changes or most of the panel repaint it all', () => {
  const bounds = { x: 0, y: 0, w: 1000, h: 800 };
  const d = new DirtyRects();
  // A new panel is all dirty.
  assert.deepEqual(d.take(bounds), bounds);
  assert.equal(d.take(bounds), null);
  d.add({ x: 100, y: 100, w: 50, h: 20 });
  d.add({ x: 300, y: 120, w: 50, h: 20 });
  const r = d.take(bounds)!;
  assert.deepEqual(r, { x: 98, y: 98, w: 254, h: 44 });
  d.add({ x: 0, y: 0, w: 900, h: 700 });
  assert.deepEqual(d.take(bounds), bounds);
  // Outside the panel: nothing to do; empty rects are ignored.
  d.add({ x: 2000, y: 2000, w: 10, h: 10 });
  d.add({ x: 0, y: 0, w: 0, h: 10 });
  assert.equal(d.take(bounds), null);
  // More than a dozen changes merge into the box round them.
  for (let i = 0; i < 20; i++) d.add({ x: i * 10, y: 0, w: 5, h: 5 });
  const merged = d.take(bounds)!;
  assert.equal(merged.x, 0);
  assert.ok(merged.w > 190);
});

test('a panel is painted when it changed and its pace allows, and now and then while looked at', () => {
  const p = PACE.window;
  assert.equal(due(1000, 900, 2, p, true, false), false, 'sooner than 250 ms after the last');
  assert.equal(due(1200, 900, 2, p, true, false), true);
  assert.equal(due(1200, 900, 100, p, true, false), false, 'four times what the last cost');
  assert.equal(due(1400, 900, 100, p, true, false), true);
  assert.equal(due(5000, 900, 2, p, false, false), false, 'nothing changed, not looked at');
  assert.equal(due(5000, 900, 2, p, false, true), true, 'the safety repaint');
  assert.equal(due(1500, 900, 2, p, false, true), false);
  assert.ok(PACE.hint.min < PACE.window.min && PACE.window.min < PACE.sheet.min);
});

test('the painter: gradients by their angle and stops, top-level commas, pictures fitted, corners clamped', () => {
  assert.deepEqual(splitTop('rgba(0, 0, 0, 0.5) 10%, rgb(1, 2, 3)'), ['rgba(0, 0, 0, 0.5) 10%', 'rgb(1, 2, 3)']);
  const g = parseLinear('linear-gradient(rgba(0, 113, 227, 0.13), rgba(0, 113, 227, 0.13))')!;
  assert.equal(g.angle, 180);
  assert.deepEqual(g.stops.map((s) => s.color), ['rgba(0, 113, 227, 0.13)', 'rgba(0, 113, 227, 0.13)']);
  const h = parseLinear('linear-gradient(90deg, rgb(255, 0, 0) 0%, rgb(0, 0, 255) 100%)')!;
  assert.equal(h.angle, 90);
  assert.deepEqual(h.stops.map((s) => s.at), [0, 1]);
  assert.equal(parseLinear('linear-gradient(to right, red, blue)')!.angle, 90);
  assert.equal(parseLinear('radial-gradient(red, blue)'), null);

  const box = { x: 0, y: 0, w: 100, h: 100 };
  const cover = fit(200, 100, box, 'cover');
  assert.deepEqual([cover.sx, cover.sw, cover.sh, cover.dw, cover.dh], [50, 100, 100, 100, 100]);
  const contain = fit(200, 100, box, 'contain');
  assert.deepEqual([contain.dw, contain.dh, contain.dy], [100, 50, 25]);
  assert.deepEqual(fit(200, 100, box, 'fill'), { sx: 0, sy: 0, sw: 200, sh: 100, dx: 0, dy: 0, dw: 100, dh: 100 });

  const cs = { borderTopLeftRadius: '8px', borderTopRightRadius: '50%', borderBottomRightRadius: '999px', borderBottomLeftRadius: '0px' } as CSSStyleDeclaration;
  assert.deepEqual(radiiOf(cs, { x: 0, y: 0, w: 40, h: 20 }), [8, 10, 10, 0]);
});
