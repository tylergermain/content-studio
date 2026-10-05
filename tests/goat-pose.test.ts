import test from 'node:test';
import assert from 'node:assert/strict';
import { GOAT_BUTT, GOAT_DASH } from '../src/shared/protocol.js';
import { DASH_FROM, DROP, POSES, REAR, buck, buttAt, buttsBy, ease, gait, grazing, lunge, restPose } from '../src/client/features/goat/pose.js';

// How Marc holds himself (client/features/goat/pose.ts): the numbers his parts are turned by.

test('every act has a pose, and how far the top of him sinks in it', () => {
  for (const act of ['stand', 'look', 'graze', 'nibble', 'lie', 'zoom', 'butt', 'pet'] as const) {
    assert.ok(POSES[act], act);
    assert.ok(DROP[act] >= 0 && DROP[act] < 0.5, act);
  }
  assert.ok(POSES.lie.y < -0.2, 'lying, he is down on the floor');
  assert.ok(POSES.graze.neck > 0 && POSES.nibble.neck > POSES.graze.neck, 'his head goes down to graze, and further to the floor');
  assert.ok(POSES.pet.neck < 0 && POSES.look.neck < 0, 'and up to look at someone');
});

test('grazing: his neck goes down to a low pot, stays level at a tall one, and no further than it bends', () => {
  const necks = [0.3, 0.45, 0.55, 0.7, 0.93, 1.2].map(grazing).map((p) => p.neck);
  for (let i = 1; i < necks.length; i++) assert.ok(necks[i] <= necks[i - 1], `a higher rim, a higher head (${necks})`);
  assert.ok(necks[0] <= 0.6 && necks[necks.length - 1] >= -0.4);
  assert.ok(grazing(0.45).neck > 0.2 && grazing(0.75).neck < 0);
  assert.equal(grazing(0.45).head, POSES.graze.head, 'his nose is tipped down either way');
});

test('walking, his legs go in diagonal pairs and each foot lifts as it comes forward; a dash is a bound, off the floor', () => {
  for (let phase = 0; phase < Math.PI * 2; phase += 0.3) {
    const w = gait('walk', phase);
    assert.ok(Math.abs(w.legs[0] + w.legs[1]) < 1e-9, 'the front legs are opposite each other');
    assert.ok(Math.abs(w.legs[0] - w.legs[3]) < 0.15, 'front left goes with back right');
    assert.ok(w.shins.every((s) => s >= 0) && w.y >= 0 && w.y < 0.02);
    // The knee bends only while the leg swings forward (its turn getting smaller).
    const next = gait('walk', phase + 0.01);
    if (w.shins[0] > 0.01) assert.ok(next.legs[0] < w.legs[0], 'a lifted foot is on its way forward');
    const d = gait('dash', phase);
    assert.equal(d.legs[0], d.legs[1]);
    assert.equal(d.legs[2], d.legs[3]);
    assert.ok(d.y >= 0 && d.y <= 0.17 + 1e-9);
  }
  assert.ok(Math.max(...Array.from({ length: 40 }, (_, i) => gait('dash', i * 0.16).y)) > 0.15, 'he gets off the floor');
  assert.ok(DASH_FROM < GOAT_DASH && DASH_FROM > 2.6, 'the zoomies bound; catching someone up is a walk');
});

test('the hop after a dash is over in half a second', () => {
  assert.deepEqual(buck(-0.1), { y: 0, pitch: 0, kick: 0 });
  assert.deepEqual(buck(0.6), { y: 0, pitch: 0, kick: 0 });
  assert.ok(buck(0.25).y > 0.19 && buck(0.25).kick > 0.8);
});

test('butting the bag: each butt lands on its beat, wound up to on his hind legs and driven in', () => {
  assert.equal(buttAt(0), GOAT_BUTT.first);
  assert.equal(buttAt(1), GOAT_BUTT.first + GOAT_BUTT.every);
  assert.equal(buttsBy(0), 0);
  assert.equal(buttsBy(GOAT_BUTT.first - 0.01), 0);
  assert.equal(buttsBy(GOAT_BUTT.first + 0.01), 1);
  assert.equal(buttsBy(buttAt(1) + 0.01), 2);
  assert.equal(buttsBy(60), GOAT_BUTT.times, 'and no more than he has in him');
  for (let i = 0; i < GOAT_BUTT.times; i++) {
    const land = buttAt(i);
    assert.ok(lunge(land - 0.3).z < 0 && lunge(land - 0.3).rear > 0.5, 'winding up: back, and up');
    assert.ok(Math.abs(lunge(land - 0.001).z - 0.2) < 0.01 && lunge(land - 0.001).rear === 1, 'landing: forward, reared');
    assert.deepEqual(lunge(land + 0.5), { z: 0, rear: 0 });
  }
  assert.deepEqual(lunge(0.1), { z: 0, rear: 0 });
  assert.ok(REAR > 0.3 && REAR < 0.7);
});

test('easing moves a pose of its own toward another, a part at a time, and leaves the other alone', () => {
  const p = restPose();
  const was = JSON.stringify(POSES.lie);
  ease(p, POSES.lie, 0.5);
  assert.equal(p.y, POSES.lie.y / 2);
  assert.equal(p.legs[0], POSES.lie.legs[0] / 2);
  ease(p, POSES.lie, 1);
  assert.deepEqual(p, POSES.lie);
  assert.equal(JSON.stringify(POSES.lie), was);
  assert.notEqual(restPose().legs, restPose().legs, 'each rest pose has legs of its own');
});
