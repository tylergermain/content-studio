import test from 'node:test';
import assert from 'node:assert/strict';
import { BALCONY_RAIL, PARACHUTE } from '../src/shared/layout.js';
import { JUMP_HEIGHT } from '../src/client/player/motion.js';
import { MANTLE, STEP } from '../src/client/player/collide.js';
import { AIRBORNE, CRUMPLE, OPEN, POP, SINK, airborne, crumpleAt, popScale, shouldOpen } from '../src/client/features/parachute/logic.js';

// Parachuting off the balcony (features/parachute): over the railing, a chute that opens by itself,
// and everyone else's worked out from where they are.

test('the balcony railing keeps you in when you walk, and lets you over when you jump', () => {
  // Higher than a stair you'd walk up, lower than a jump (with the 5 cm slack blockerAt gives a top).
  assert.ok(BALCONY_RAIL > STEP * 2, `rail ${BALCONY_RAIL}`);
  // A jump gets your feet within reach of its top however slow the frames (they're capped at 50 ms, which
  // costs a jump up to about v0 * dt / 2 of its height), and you pull yourself up from there.
  const worst = JUMP_HEIGHT - (6.4 * 0.05) / 2;
  assert.ok(BALCONY_RAIL - worst < MANTLE, `rail ${BALCONY_RAIL}, slowest jump ${worst.toFixed(2)}`);
  assert.ok(BALCONY_RAIL > MANTLE + STEP, 'too high to climb without jumping');
  // The workers stand up on the same rail to jump.
  assert.ok(Math.abs(PARACHUTE.railTop - BALCONY_RAIL) < 0.05);
});

test('the chute opens on a real drop, never on a jump or a stair in the office', () => {
  assert.ok(shouldOpen(5, -5));
  assert.ok(!shouldOpen(5, -2), 'not before you are falling');
  assert.ok(!shouldOpen(2.5, -6), 'not with too little left to fall');
  // A plain jump never falls fast enough over a floor to open it: you'd need to fall OPEN.speed m/s,
  // which takes falling this far first, and a jump comes down from no higher than JUMP_HEIGHT.
  const fallToOpen = (OPEN.speed * OPEN.speed) / (2 * 18);
  assert.ok(JUMP_HEIGHT < OPEN.height + fallToOpen);
  assert.ok(SINK < OPEN.speed && SINK > 1);
});

test('it pops open, overshoots a touch, settles, and crumples away on the ground', () => {
  assert.ok(popScale(0) <= 0.06);
  assert.ok(popScale(POP * 0.5) < popScale(POP * 0.9));
  assert.ok(popScale(POP * 0.95) > 1 && popScale(POP * 0.95) <= 1.08);
  assert.equal(popScale(POP + 1), 1);
  assert.equal(crumpleAt(0), 0);
  assert.equal(crumpleAt(CRUMPLE), 1);
  assert.equal(crumpleAt(CRUMPLE * 3), 1);
});

test("someone else's chute shows while they hang up off the ground, and doesn't flicker as they land", () => {
  assert.ok(!airborne(1.2, false), 'a jump');
  assert.ok(airborne(AIRBORNE.up + 0.1, false));
  assert.ok(airborne(1, true), 'still under it near the ground');
  assert.ok(!airborne(AIRBORNE.down - 0.1, true));
});
