import test from 'node:test';
import assert from 'node:assert/strict';
import { FURNITURE, FURNITURE_KINDS, kindDef } from '../src/shared/furniture.js';
import {
  BAG,
  BOUNCE,
  COMBO_IDLE,
  DANCE,
  FOOSBALL,
  RALLY,
  STRIKER,
  WHEEL,
  comboAt,
  contactDip,
  danceTile,
  foosBallAt,
  foosGoal,
  foosPoint,
  hitCombo,
  launchPuck,
  matDip,
  meterBar,
  pegsPassed,
  punchSwing,
  rallyBall,
  rallyHit,
  rallyMissed,
  rallyTrip,
  rebound,
  restSwing,
  rodTurn,
  spinSpeed,
  stepPuck,
  stepSpin,
  stepSpring,
  stepSwing,
  strikeName,
  sweep,
  tileNote,
  wedgeAt,
} from '../src/client/features/playthings/logic.js';

// The numbers behind the things to play with (features/playthings/logic.ts): the bag's swing, the
// trampoline's bounce, the wheel, the striker, a rally and a foosball point.

const TAU = Math.PI * 2;
const FRAME = 1 / 60;

test('every kind that is for playing with has somewhere to walk up to, and the trampoline bounces', () => {
  const plays = FURNITURE_KINDS.filter((k) => kindDef(k).play);
  assert.deepEqual(plays.sort(), ['foosball', 'high-striker', 'ping-pong', 'prize-wheel', 'punching-bag', 'vending-machine']);
  for (const kind of plays) {
    const k = kindDef(kind);
    assert.ok(k.use, `${kind} has a place to use it from`);
    // Out past its front, far enough that you aren't standing in it (you're 0.32 round).
    const front = k.r ?? (k.d ?? 0) / 2;
    assert.ok(k.use.z >= front + 0.32, `${kind} is used from ${k.use.z}, and its front is at ${front}`);
    assert.equal(k.group, 'Play');
  }
  assert.ok(FURNITURE.trampoline.bounce > 0);
  // Low enough to step up onto (STEP in client/player/collide.ts is 0.3).
  assert.ok(FURNITURE.trampoline.top <= 0.3 && FURNITURE['dance-mat'].top <= 0.3);
});

test('a punched bag swings away, comes back through the middle about when a pendulum would, and settles', () => {
  const s = restSwing();
  assert.equal(stepSwing(s, FRAME), false, 'a bag nobody hit hangs still');
  // Pushed toward -z (you're standing at its front).
  punchSwing(s, 0, -1);
  assert.ok(s.vz < 0 && s.vx === 0);
  let t = 0;
  let furthest = 0;
  let back = 0;
  let peaks: number[] = [];
  let was = 0;
  let rising = false;
  while (stepSwing(s, FRAME) && t < 60) {
    t += FRAME;
    furthest = Math.min(furthest, s.z);
    if (!back && was < 0 && s.z >= 0) back = t;
    // Each time it turns round at the far side of a swing.
    const speeding = Math.abs(s.z) > Math.abs(was);
    if (rising && !speeding) peaks.push(Math.abs(was));
    rising = speeding;
    was = s.z;
  }
  assert.ok(furthest < -0.3 && furthest > -BAG.max, `it swung out to ${furthest.toFixed(3)}`);
  // Half a swing: pi * sqrt(length / g), a little longer for the damping and the size of the swing.
  const half = Math.PI * Math.sqrt(BAG.length / 9.81);
  assert.ok(back > half * 0.95 && back < half * 1.2, `back through the middle after ${back.toFixed(2)}s (a pendulum's ${half.toFixed(2)}s)`);
  assert.ok(peaks.length >= 4, `it swung ${peaks.length} times`);
  for (let i = 1; i < peaks.length; i++) assert.ok(peaks[i] < peaks[i - 1], 'every swing is smaller than the last');
  assert.ok(t > 3 && t < 12, `it took ${t.toFixed(1)}s to settle`);
  assert.deepEqual(s, restSwing(), 'and then it hangs exactly still');
});

test('a bag hit from the side swings sideways, and however hard it is hit it only leans so far', () => {
  const s = restSwing();
  punchSwing(s, 3, 0);
  stepSwing(s, 0.1);
  assert.ok(s.x > 0.1 && s.z === 0);
  for (let i = 0; i < 30; i++) punchSwing(s, 1, 1);
  let most = 0;
  for (let i = 0; i < 600; i++) {
    stepSwing(s, FRAME);
    most = Math.max(most, Math.abs(s.x), Math.abs(s.z));
  }
  assert.ok(most <= BAG.max + 1e-9, `it leaned ${most.toFixed(3)}`);
  // A slow frame doesn't throw it about.
  const a = restSwing();
  const b = restSwing();
  punchSwing(a, 0, 1);
  punchSwing(b, 0, 1);
  for (let i = 0; i < 60; i++) stepSwing(a, FRAME);
  for (let i = 0; i < 10; i++) stepSwing(b, 0.1);
  assert.ok(Math.abs(a.z - b.z) < 0.02, `${a.z.toFixed(3)} at 60 fps, ${b.z.toFixed(3)} at 10`);
});

test('punches in a row count up, and start again once the bag has been left alone', () => {
  const c = { n: 0, at: -Infinity };
  assert.equal(comboAt(c, 0), 0);
  assert.equal(hitCombo(c, 10), 1);
  assert.equal(hitCombo(c, 10.5), 2);
  assert.equal(hitCombo(c, 10.4 + COMBO_IDLE), 3, 'just inside the time a combo keeps');
  assert.equal(comboAt(c, 10.3 + COMBO_IDLE * 2), 3);
  assert.equal(comboAt(c, 10.5 + COMBO_IDLE * 2), 0);
  assert.equal(hitCombo(c, 30), 1);
});

test('a trampoline throws you up at its own bounce, harder each time you hold Space, and back down to it when you let go', () => {
  const bounce = FURNITURE.trampoline.bounce;
  assert.equal(rebound(bounce, 0, false), bounce, 'standing on it is enough');
  assert.equal(rebound(bounce, 6.4, false), bounce, 'landing a jump on it');
  // Holding Space: higher every bounce, up to the most it gives.
  let v = 0;
  const held: number[] = [];
  for (let i = 0; i < 8; i++) held.push((v = rebound(bounce, v, true)));
  for (let i = 1; i < held.length; i++) assert.ok(held[i] >= held[i - 1]);
  assert.ok(held[0] > bounce && Math.abs(held[7] - bounce * BOUNCE.most) < 1e-9, `${held.map((x) => x.toFixed(1))}`);
  // The highest bounce clears the ceiling (6.8) with your head (1.7 over your feet): v² / 2g up from the mat, at the office's gravity (18).
  const apex = FURNITURE.trampoline.top + (bounce * 1.5) ** 2 / (2 * 18);
  assert.ok(apex + 1.7 < 6.8, `the highest bounce puts your head at ${(apex + 1.7).toFixed(2)}`);
  // Let go, and it comes back down to its own.
  for (let i = 0; i < 8; i++) {
    const next = rebound(bounce, v, false);
    assert.ok(next <= v && next >= bounce);
    v = next;
  }
  assert.equal(v, bounce);
  // Off the loft onto it: you keep most of the fall, but no more than it ever gives.
  assert.ok(rebound(bounce, 30, false) <= bounce * BOUNCE.most);
});

test('your feet sink into the mat and come back to its top before it throws you, and the mat rings and settles', () => {
  assert.equal(contactDip(0, 0.2), 0);
  assert.ok(Math.abs(contactDip(BOUNCE.contact / 2, 0.2) - 0.2) < 1e-9);
  assert.ok(contactDip(BOUNCE.contact, 0.2) < 1e-9 && contactDip(1, 0.2) < 1e-9);
  assert.ok(matDip(0) > 0 && matDip(12) > matDip(3) && matDip(100) <= BOUNCE.dip);
  const s = { x: -0.15, v: 2 };
  let t = 0;
  let over = 0;
  while (stepSpring(s, FRAME) && t < 20) {
    t += FRAME;
    over = Math.max(over, s.x);
  }
  assert.ok(over > 0 && over < 0.15, `it sprang ${over.toFixed(3)} over its rest`);
  assert.ok(t > 0.2 && t < 3, `and settled in ${t.toFixed(2)}s`);
  assert.deepEqual(s, { x: 0, v: 0 });
});

test('a dance mat\'s tiles are three rows of three, each with its own note going up the scale', () => {
  assert.equal(danceTile(-DANCE.pitch, -DANCE.pitch), 0, 'the back left');
  assert.equal(danceTile(0, 0), 4);
  assert.equal(danceTile(DANCE.pitch, DANCE.pitch), 8, 'the front right');
  assert.equal(danceTile(DANCE.pitch, -DANCE.pitch), 2);
  assert.equal(danceTile(0.27, 0), 4);
  assert.equal(danceTile(0.29, 0), 5);
  assert.equal(danceTile(DANCE.half + 0.01, 0), -1);
  assert.equal(danceTile(0, -DANCE.half - 0.01), -1);
  const notes = Array.from({ length: 9 }, (_, i) => tileNote(i));
  for (let i = 1; i < 9; i++) assert.ok(notes[i] > notes[i - 1]);
  assert.ok(Math.abs(notes[0] - 261.63) < 0.01 && Math.abs(notes[5] - 523.26) < 0.01, 'from middle C, an octave up at the sixth tile');
});

test('the prize wheel runs down and stops on a wedge, its pegs clicking past on the way', () => {
  for (const u of [0, 0.5, 1]) {
    const s = { angle: 0, speed: spinSpeed(u) };
    let t = 0;
    let pegs = 0;
    while (t < 60) {
      const from = s.angle;
      const going = stepSpin(s, FRAME);
      pegs += pegsPassed(from, s.angle, 8);
      t += FRAME;
      if (!going) break;
    }
    assert.equal(s.speed, 0);
    assert.ok(t > 2 && t < 9, `a spin at ${spinSpeed(u)} takes ${t.toFixed(1)}s`);
    assert.ok(s.angle > TAU * 1.5, `and goes round ${(s.angle / TAU).toFixed(1)} times`);
    assert.equal(pegs, Math.floor(s.angle / (TAU / 8)), 'every peg it passed clicked once');
    assert.equal(stepSpin(s, FRAME), false);
  }
  assert.ok(spinSpeed(0) === WHEEL.slowest && spinSpeed(1) === WHEEL.fastest && spinSpeed(7) === WHEEL.fastest);
  // The wheel turns clockwise, so its wedges (counted counter-clockwise from the top) come under the flapper in order.
  assert.equal(wedgeAt(0.01, 8), 0);
  assert.equal(wedgeAt(TAU / 8 + 0.01, 8), 1);
  assert.equal(wedgeAt(TAU - 0.01, 8), 7);
  assert.equal(wedgeAt(TAU * 3 + TAU / 2 + 0.01, 8), 4);
  assert.equal(wedgeAt(-0.01, 8), 7);
});

test('the high striker\'s meter runs up and down, and the puck goes as far as the swing was good', () => {
  assert.equal(sweep(0, 2), 0);
  assert.equal(sweep(0.5, 2), 0.5);
  assert.equal(sweep(1, 2), 1);
  assert.equal(sweep(1.5, 2), 0.5);
  assert.equal(sweep(4.5, 2), 0.5);
  assert.equal(meterBar(0), '▱▱▱▱▱▱▱▱▱▱');
  assert.equal(meterBar(0.5), '▰▰▰▰▰▱▱▱▱▱');
  assert.equal(meterBar(1), '▰▰▰▰▰▰▰▰▰▰');

  /** How high a hit of `power` sends the puck, whether it rang the bell, and how long until it's back down. */
  const fly = (power: number) => {
    const p = { y: 0, v: 0 };
    launchPuck(p, power);
    let peak = 0;
    let rang = 0;
    let t = 0;
    for (; t < 20; t += FRAME) {
      const what = stepPuck(p, FRAME);
      peak = Math.max(peak, p.y);
      if (what === 'bell') rang++;
      if (p.y <= 0 && p.v <= 0) break;
    }
    return { peak, rang, t };
  };
  const half = fly(0.5);
  assert.ok(half.rang === 0 && half.peak > 0.45 && half.peak < 0.6, `half a swing gets ${half.peak.toFixed(2)} of the way`);
  const close = fly(STRIKER.bell - 0.01);
  assert.ok(close.rang === 0 && close.peak > 0.9 && close.peak < 1, `just short of enough gets ${close.peak.toFixed(3)} of the way, and no bell`);
  const full = fly(STRIKER.bell);
  assert.ok(full.rang === 1 && full.peak > 0.99 && full.peak <= 1, 'enough rings the bell, once');
  assert.ok(fly(0.1).peak < fly(0.3).peak && fly(0.3).peak < fly(0.6).peak);
  assert.ok(full.t > 0.8 && full.t < 3, `and it's back down in ${full.t.toFixed(2)}s`);
  assert.equal(stepPuck({ y: 0, v: 0 }, FRAME), null, 'a puck at rest stays there');
  assert.match(strikeName(1), /DING/);
  assert.notEqual(strikeName(0.1), strikeName(0.6));
});

test('a rally\'s ball crosses the net both ways, bounces once on each half, and comes back quicker every time', () => {
  assert.deepEqual(rallyBall(0), { z: 1, y: RALLY.hit });
  assert.ok(Math.abs(rallyBall(0.5).z + 1) < 1e-9 && Math.abs(rallyBall(0.5).y - RALLY.hit) < 1e-9, 'hit back from the far end at the same height');
  assert.ok(Math.abs(rallyBall(1 - 1e-9).z - 1) < 1e-6 && Math.abs(rallyBall(1 - 1e-9).y - RALLY.hit) < 1e-6);
  // Over the net (0.1525 high, at z 0) on the way out and on the way back.
  for (const p of [0.25, 0.75]) assert.ok(Math.abs(rallyBall(p).z) < 1e-9 && rallyBall(p).y > 0.1525 + 0.05, `it clears the net by ${(rallyBall(p).y - 0.1525).toFixed(3)}`);
  // Down on the table halfway into the far half, then halfway into yours.
  assert.ok(rallyBall(0.375).y < 0.005 && Math.abs(rallyBall(0.375).z + 0.5) < 1e-9);
  assert.ok(rallyBall(0.875).y < 0.005 && Math.abs(rallyBall(0.875).z - 0.5) < 1e-9);
  for (let p = 0; p <= 1.5; p += 0.01) assert.ok(rallyBall(p).y >= 0 && rallyBall(p).y < 0.4, `at ${p.toFixed(2)} it's ${rallyBall(p).y.toFixed(3)} up`);
  assert.ok(rallyBall(1.2).z > 1, 'missed, it carries on past you');

  assert.equal(rallyTrip(0), RALLY.first);
  for (let n = 1; n < 40; n++) assert.ok(rallyTrip(n) <= rallyTrip(n - 1) && rallyTrip(n) >= RALLY.fastest);
  assert.equal(rallyTrip(100), RALLY.fastest);

  const trip = 1.5;
  assert.equal(rallyHit(0.5, trip), false, 'too early: it is still at the far end');
  assert.equal(rallyHit(1 - (RALLY.window - 0.01) / trip, trip), true);
  assert.equal(rallyHit(1 + (RALLY.window - 0.01) / trip, trip), true, 'a touch late still gets it');
  assert.equal(rallyHit(1 + (RALLY.window + 0.01) / trip, trip), false);
  assert.equal(rallyMissed(1, trip), false);
  assert.equal(rallyMissed(1 + (RALLY.window + 0.01) / trip, trip), true);
  // There's always time to swing again after a swing at nothing, before the ball has gone.
  assert.ok(RALLY.recover < RALLY.window * 2);
});

test('a foosball point plays out the same from the same seed and ends in a goal, and five goals is a game', () => {
  let yours = 0;
  for (let seed = 1; seed <= 400; seed++) {
    const point = foosPoint(seed);
    assert.deepEqual(foosPoint(seed), point);
    if (point.yours) yours++;
    const { path } = point;
    assert.deepEqual(path[0], { t: 0, x: 0, z: 0 }, 'from the middle');
    for (let i = 1; i < path.length; i++) assert.ok(path[i].t > path[i - 1].t);
    const end = path[path.length - 1];
    assert.equal(end.t, FOOSBALL.point);
    assert.equal(end.x, (point.yours ? 1 : -1) * FOOSBALL.halfLength, 'into the goal you (or they) shoot at');
    assert.ok(Math.abs(end.z) < 0.1, 'between the posts');
    for (const k of path) assert.ok(Math.abs(k.x) <= FOOSBALL.halfLength && Math.abs(k.z) <= FOOSBALL.halfWidth, 'on the field');
    assert.deepEqual(foosBallAt(point, 0), { x: 0, z: 0 });
    assert.deepEqual(foosBallAt(point, FOOSBALL.point + 1), { x: end.x, z: end.z });
    const mid = foosBallAt(point, (path[1].t + path[2].t) / 2);
    assert.ok(Math.abs(mid.x - (path[1].x + path[2].x) / 2) < 1e-9, 'straight from one knock to the next');
  }
  assert.ok(yours > 180 && yours < 260, `you scored ${yours} of 400: a little better than even`);

  let score = { you: 0, them: 0 };
  for (let i = 0; i < FOOSBALL.game - 1; i++) {
    const r = foosGoal(score, true);
    assert.equal(r.won, null);
    score = r.score;
  }
  assert.deepEqual(foosGoal(score, false), { score: { you: 4, them: 1 }, won: null });
  assert.deepEqual(foosGoal(score, true), { score: { you: 5, them: 0 }, won: 'you' });
  assert.equal(foosGoal({ you: 2, them: 4 }, false).won, 'them');

  // The rods rock, and now and then one spins right round; every angle is finite.
  for (let i = 0; i < 8; i++) for (let t = 0; t < FOOSBALL.point; t += 0.05) assert.ok(Number.isFinite(rodTurn(i, t, 12345)) && Math.abs(rodTurn(i, t, 12345)) < TAU + 1);
});
