// VR's controls as plain numbers (features/vr/input-map.ts) and its keys by name (keys-table.ts): the
// sticks' dead zone, a button's press and edges, snap turning's flick, where a trigger pull goes, what
// the trigger won't do in VR yet, and the keys the trigger, the keyboard panel and the hint's chips press.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEADZONE, HOLD_MS, IDLE, PRESS, RELEASE, VR_BLOCKED, aPress, deadzone, deadzone2, readButton, snapStep, stickKeys, triggerRoute } from '../src/client/features/vr/input-map.js';
import { codeOfChar, codeOfChip, keyInfo, vrLabel } from '../src/client/features/vr/keys-table.js';
import type { Btn } from '../src/client/features/vr/types.js';

const near = (a: number, b: number, msg?: string) => assert.ok(Math.abs(a - b) < 1e-9, msg ?? `${a} is not ${b}`);

test('a stick inside the dead zone is still, and past it leans 0 to 1 with its sign', () => {
  assert.equal(deadzone(0), 0);
  assert.equal(deadzone(DEADZONE * 0.9), 0);
  assert.equal(deadzone(-DEADZONE), 0);
  near(deadzone(1), 1);
  near(deadzone(-1), -1);
  near(deadzone((1 + DEADZONE) / 2), 0.5);
  near(deadzone(-(1 + DEADZONE) / 2), -0.5);
  // Past full scale (some sticks overshoot), never more than 1.
  near(deadzone(1.2), 1);
  // IWER gives the touchpad's axes as null; a NaN is no lean either.
  assert.equal(deadzone(null), 0);
  assert.equal(deadzone(undefined), 0);
  assert.equal(deadzone(Number.NaN), 0);
});

test("a stick's round dead zone keeps its direction, and a diagonal is no faster than straight ahead", () => {
  assert.deepEqual(deadzone2(0.1, 0.1), { x: 0, y: 0 });
  const d = deadzone2(Math.SQRT1_2, -Math.SQRT1_2);
  near(Math.hypot(d.x, d.y), 1);
  near(d.x, -d.y);
  const s = deadzone2(0, -1);
  near(s.x, 0);
  near(s.y, -1);
  // Pushed into a corner past the rim, still length 1.
  const c = deadzone2(1, 1);
  near(Math.hypot(c.x, c.y), 1);
  // Written into what it's given, so reading a pad each frame makes nothing new.
  const out = { x: 9, y: 9 };
  assert.equal(deadzone2(null, undefined, DEADZONE, out), out);
  assert.deepEqual(out, { x: 0, y: 0 });
});

test('a button goes down past PRESS, stays down until under RELEASE, and has each edge for one frame', () => {
  const frames: Btn[] = [];
  let b: Btn = IDLE;
  for (const value of [0, 0.3, PRESS, 0.9, 0.5, RELEASE + 0.01, RELEASE, 0.1, 0]) {
    b = readButton(b, { pressed: value > 0.1, value });
    frames.push(b);
  }
  assert.deepEqual(
    frames.map((f) => f.pressed),
    [false, false, true, true, true, true, false, false, false],
  );
  assert.deepEqual(
    frames.map((f) => f.down),
    [false, false, true, false, false, false, false, false, false],
  );
  assert.deepEqual(
    frames.map((f) => f.up),
    [false, false, false, false, false, false, true, false, false],
  );
  near(frames[3].value, 0.9);
});

test('a digital button pressed with no value is all the way down; a controller that goes away lets everything go', () => {
  const down = readButton(IDLE, { pressed: true, value: 0 });
  assert.equal(down.pressed, true);
  assert.equal(down.down, true);
  assert.equal(down.value, 1);
  const gone = readButton(down, null);
  assert.equal(gone.pressed, false);
  assert.equal(gone.up, true);
  assert.equal(readButton(gone, undefined), IDLE);
  // A light touch on the trigger (the browser may call it pressed) is no pull.
  assert.equal(readButton(IDLE, { pressed: true, value: 0.2 }).pressed, false);
});

test('snap turning turns once per flick and re-arms only once the stick comes back', () => {
  let armed = true;
  const turns: number[] = [];
  for (const x of [0, 0.5, 0.8, 0.95, 0.8, 0.5, 0.35, 0.2, 0.9, 0, -0.75, -0.9, 0]) {
    const r = snapStep(armed, x);
    armed = r.armed;
    turns.push(r.turn);
  }
  assert.deepEqual(turns, [0, 0, 1, 0, 0, 0, 0, 0, 1, 0, -1, 0, 0]);
});

test('a stick holds W A S D past half way, for the ladder, a pole and a car', () => {
  assert.deepEqual(stickKeys(0, 0), []);
  assert.deepEqual(stickKeys(0, -0.8), ['KeyW']);
  assert.deepEqual(stickKeys(0, 0.8), ['KeyS']);
  assert.deepEqual(stickKeys(-0.8, -0.8), ['KeyW', 'KeyA']);
  assert.deepEqual(stickKeys(0.6, 0.3), ['KeyD']);
  assert.deepEqual(stickKeys(0.4, 0, 0.3), ['KeyD']);
});

test('a trigger pull goes to the panel it is on, else under a window into the world, else it is E unless that is blocked', () => {
  assert.equal(triggerRoute({ onPanel: true, windowUp: true, blocked: true }), 'panel');
  assert.equal(triggerRoute({ onPanel: false, windowUp: true, blocked: false }), 'world');
  assert.equal(triggerRoute({ onPanel: false, windowUp: false, blocked: true }), 'blocked');
  assert.equal(triggerRoute({ onPanel: false, windowUp: false, blocked: false }), 'key');
});

test('the things that fly the camera about are the ones the trigger leaves alone in VR', () => {
  assert.deepEqual([...VR_BLOCKED].sort(), ['axe', 'darts', 'golf', 'telescope']);
  for (const kind of ['desk', 'elevator', 'coffee', 'seat', 'ladder']) assert.equal(VR_BLOCKED.has(kind), false, kind);
});

test('A is the keyboard at once without a 🎤, and with one it waits to see whether it is held to talk', () => {
  assert.equal(aPress(0, false), 'keyboard');
  assert.equal(aPress(HOLD_MS * 3, false), 'keyboard');
  assert.equal(aPress(0, true), 'wait');
  assert.equal(aPress(HOLD_MS - 1, true), 'wait');
  assert.equal(aPress(HOLD_MS, true), 'talk');
});

test('each code has the key a US keyboard gives it, shifted or not, and the old keyCode', () => {
  assert.deepEqual(keyInfo('KeyE'), { key: 'e', keyCode: 69 });
  assert.deepEqual(keyInfo('KeyE', true), { key: 'E', keyCode: 69 });
  assert.deepEqual(keyInfo('KeyC'), { key: 'c', keyCode: 67 });
  assert.deepEqual(keyInfo('Digit1'), { key: '1', keyCode: 49 });
  assert.deepEqual(keyInfo('Digit1', true), { key: '!', keyCode: 49 });
  assert.deepEqual(keyInfo('Digit0', true), { key: ')', keyCode: 48 });
  assert.deepEqual(keyInfo('Space'), { key: ' ', keyCode: 32 });
  assert.deepEqual(keyInfo('Escape'), { key: 'Escape', keyCode: 27 });
  assert.deepEqual(keyInfo('Enter'), { key: 'Enter', keyCode: 13 });
  assert.deepEqual(keyInfo('Backspace'), { key: 'Backspace', keyCode: 8 });
  assert.deepEqual(keyInfo('Tab'), { key: 'Tab', keyCode: 9 });
  assert.deepEqual(keyInfo('ArrowUp'), { key: 'ArrowUp', keyCode: 38 });
  assert.deepEqual(keyInfo('Slash', true), { key: '?', keyCode: 191 });
  assert.deepEqual(keyInfo('F5'), { key: 'F5', keyCode: 116 });
  assert.deepEqual(keyInfo('Numpad7'), { key: '7', keyCode: 103 });
  assert.deepEqual(keyInfo('NoSuchKey'), { key: 'Unidentified', keyCode: 0 });
});

test('every character a keyboard types has a code, and round-trips through keyInfo', () => {
  const chars = 'abcxyzABCXYZ0123456789!@#$%^&*()-_=+[]{}\\|;:\'",.<>/?`~ ';
  for (const ch of chars) {
    const c = codeOfChar(ch);
    assert.ok(c, `no code for ${JSON.stringify(ch)}`);
    assert.equal(keyInfo(c.code, c.shift).key, ch, `${JSON.stringify(ch)} -> ${c.code}${c.shift ? '+shift' : ''}`);
  }
  assert.deepEqual(codeOfChar('\n'), { code: 'Enter', shift: false });
  assert.deepEqual(codeOfChar('\t'), { code: 'Tab', shift: false });
  assert.equal(codeOfChar('é'), null);
  assert.equal(codeOfChar(''), null);
});

test("a hint's key chips press their keys when tapped, and the ones that aren't a key press nothing", () => {
  assert.equal(codeOfChip('E'), 'KeyE');
  assert.equal(codeOfChip('P'), 'KeyP');
  assert.equal(codeOfChip('q'), 'KeyQ');
  assert.equal(codeOfChip('3'), 'Digit3');
  assert.equal(codeOfChip('Space'), 'Space');
  assert.equal(codeOfChip('Esc'), 'Escape');
  assert.equal(codeOfChip('↵'), 'Enter');
  assert.equal(codeOfChip(' E / Click '), 'KeyE');
  for (const chip of ['W A S D', 'Mouse', 'Scroll', 'Click', '↑↓', '⇧↵', 'A D', 'W S', '']) assert.equal(codeOfChip(chip), null, chip);
});

test('in the headset the chips name the controls: E is the trigger, Space the grip, Esc is B', () => {
  assert.equal(vrLabel('E'), 'Trigger');
  assert.equal(vrLabel('E / Click'), 'Trigger');
  assert.equal(vrLabel('Click'), 'Trigger');
  assert.equal(vrLabel('Space'), 'Grip');
  assert.equal(vrLabel('Esc'), 'B');
  assert.equal(vrLabel('W A S D'), 'Stick');
  assert.equal(vrLabel('Mouse'), 'Aim');
  // A desk's letters stay letters (tapping them presses them).
  for (const chip of ['P', 'R', 'X', 'C', 'O', 'L', 'Q', 'H', 'B']) assert.equal(vrLabel(chip), null, chip);
});
