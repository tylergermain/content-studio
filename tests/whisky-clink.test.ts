import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CLINK } from '../src/shared/whisky.js';
import { CLINK_AT, IN_VIEW, TOAST_AT, TOAST_SECONDS, toastPoses, toastStep, type Raised, type Toaster } from '../src/client/features/whisky/clink.js';
import { DecanterWhisky, INSIDE, REST_LEVEL } from '../src/client/features/whisky/decanter.js';
import { Partners } from '../src/client/features/whisky/partners.js';

// The whisky cabinet's pour and toast as you see them (features/whisky): where the glasses go when people
// clink (clink.ts) and how a toast goes second by second, who's near enough to clink with rather than
// only raise a glass to, and the whisky in the decanter lying level however it's tipped (decanter.ts).

const R = 0.0574;
const person = (id: string, x: number, z: number, y = 0, r = R): Toaster => ({ id, x, y, z, r });
const by = (poses: Raised[], id: string) => poses.find((p) => p.id === id)!;
const apart = (a: Raised, b: Raised) => Math.hypot(a.x - b.x, a.z - b.z);
/** Which side of the way they face (toward `to`) a point is: + their left, - their right (forward +z, a person's right on -x). */
const sideOf = (p: Toaster, to: { x: number; z: number }, q: { x: number; z: number }) => {
  const fx = to.x - p.x;
  const fz = to.z - p.z;
  return fz * (q.x - p.x) - fx * (q.z - p.z);
};

test('a metre apart, the glasses meet between them, rims touching, at the same height, each to its holder\'s right', () => {
  const a = person('a', 0, 0);
  const b = person('b', 1, 0);
  const poses = toastPoses([a, b]);
  const [ga, gb] = [by(poses, 'a'), by(poses, 'b')];
  assert.ok(ga.touch && gb.touch, 'near enough to meet');
  assert.equal(ga.y, gb.y, 'at the same height');
  assert.ok(ga.y > 1 && ga.y <= TOAST_AT.high + 1e-9, `about chest high on a chibi (${ga.y})`);
  assert.ok(Math.abs(apart(ga, gb) - 2 * R) < 1e-9, `their sides touch (${apart(ga, gb).toFixed(4)} apart)`);
  // Between them: each glass is out in front of its holder, short of the middle.
  assert.ok(ga.x > 0.4 && ga.x < 0.5 && gb.x > 0.5 && gb.x < 0.6, `between them (${ga.x.toFixed(3)}, ${gb.x.toFixed(3)})`);
  assert.ok(sideOf(a, b, ga) < 0 && sideOf(b, a, gb) < 0, 'each in its holder\'s right hand\'s side of the way between them');
  // Each leans toward the other, and its holder turns to where they meet.
  assert.ok(Math.abs(ga.tx * (gb.x - ga.x) + ga.tz * (gb.z - ga.z) - apart(ga, gb)) < 1e-9, 'leaning straight at the other');
  assert.ok(Math.abs(ga.faceX - 0.5) < 1e-9 && Math.abs(ga.faceZ) < 1e-9);
});

test('nearer, they meet higher; up to arms\' length they still meet; further, each is raised toward the other from where they stand', () => {
  const close = by(toastPoses([person('a', 0, 0), person('b', 0.7, 0)]), 'a');
  const far = by(toastPoses([person('a', 0, 0), person('b', CLINK.touch, 0)]), 'a');
  assert.ok(close.touch && far.touch, `still meeting at ${CLINK.touch} m`);
  assert.ok(close.y > far.y, `higher when nearer (${close.y} > ${far.y})`);
  const poses = toastPoses([person('a', 0, 0), person('b', 1.7, 0)]);
  for (const [g, p, other] of [
    [by(poses, 'a'), person('a', 0, 0), person('b', 1.7, 0)],
    [by(poses, 'b'), person('b', 1.7, 0), person('a', 0, 0)],
  ] as const) {
    assert.equal(g.touch, false, 'too far for arms to reach: raised to each other');
    assert.equal(g.y, TOAST_AT.raised, 'up in front of them');
    const out = Math.hypot(g.x - p.x, g.z - p.z);
    // Out in front of their face (a chibi's head is about 0.34 round), toward the other, in their right hand.
    assert.ok(out > 0.4 && out < 0.5, `clear of their head (${out.toFixed(3)} out)`);
    assert.ok((g.x - p.x) * (other.x - p.x) > 0, 'toward the other');
    assert.ok(sideOf(p, other, g) < 0, 'in their right hand');
    assert.ok(Math.abs(g.tx * Math.sign(other.x - p.x) - 1) < 1e-9, 'leaning toward them');
  }
});

test('a few at once meet in a ring round the middle of them, a glass each', () => {
  const people = [person('a', 0, 0), person('b', 1, 0), person('c', 0.5, 0.8)];
  const poses = toastPoses(people);
  assert.equal(poses.length, 3);
  assert.ok(poses.every((p) => p.touch));
  const mx = people.reduce((s, p) => s + p.x, 0) / 3;
  const mz = people.reduce((s, p) => s + p.z, 0) / 3;
  for (const p of poses) assert.ok(Math.abs(Math.hypot(p.x - mx, p.z - mz) - R / Math.sin(Math.PI / 3)) < 1e-9, 'round the middle, far enough out for three glasses');
  assert.deepEqual(toastPoses([person('a', 0, 0)]), [], 'nobody to toast with');
});

test('seen through your own eyes, the glasses meet up in view and off to your left, yours on the left of theirs', () => {
  const me = person('me', 0, 0, 0, 0.045);
  const them = person('them', 1, 0);
  const seen = toastPoses([me, them], { id: 'me', height: 1.4 });
  const [mine, theirs] = [by(seen, 'me'), by(seen, 'them')];
  const plain = by(toastPoses([me, them]), 'me');
  assert.ok(mine.y > plain.y && mine.y <= IN_VIEW.up, `higher, up toward where you look (${mine.y.toFixed(3)} over ${plain.y.toFixed(3)})`);
  assert.ok(1.4 - mine.y <= 0.5 * IN_VIEW.below + 1e-9, 'where they meet, half a metre ahead, no further under where you look than the bottom of the view allows');
  assert.equal(mine.y, theirs.y);
  assert.ok(Math.abs(apart(mine, theirs) - (0.045 + R)) < 1e-9, 'still touching');
  // Your left, facing +x, is -z: off to it, and yours to the left of theirs, so your hand round yours doesn't hide theirs.
  assert.ok((mine.z + theirs.z) / 2 < -0.05, 'off to your left, clear of their face');
  assert.ok(mine.z < theirs.z, 'yours on the left');
  // A glass raised from across the room is up in front of you, a little to your left.
  const raised = by(toastPoses([me, person('them', 1.7, 0)], { id: 'me', height: 1.4 }), 'me');
  assert.equal(raised.touch, false);
  assert.ok(raised.z < 0 && raised.x > 0.4, 'in front of you, to your left');
});

test('a toast goes out, meets with a tap, holds a moment and comes back down', () => {
  assert.equal(toastStep(0, true).k, 0);
  assert.equal(toastStep(CLINK_AT, true).k, 1, 'all the way out when they meet');
  assert.equal(toastStep(CLINK_AT, true).gap, 0, 'and touching');
  assert.ok(toastStep(0.25, true).gap > 0.01, 'short of it on the way');
  assert.ok(toastStep(0.6, true).gap > 0, 'and a hair back from it after');
  assert.ok(toastStep(CLINK_AT, true).tilt > 0.1, 'leaning in to it as they meet');
  assert.equal(toastStep(TOAST_SECONDS, true).k, 0, 'and down again');
  const raised = toastStep(0.5, false);
  assert.ok(raised.k === 1 && raised.gap === 0 && raised.lift > 0, 'from a distance, up and lifted a little, never meeting');
});

test('whoever\'s near enough to clink with, or only to raise a glass to, says so', () => {
  const p = new Partners();
  const me = { id: 'me', name: 'Me', x: 0, y: 0, z: 0 };
  const ann = { id: 'a', name: 'Ann', x: 1, y: 0, z: 0 };
  p.find(me, ['a'], () => ann);
  assert.equal(p.touch, true);
  const near = p.key;
  ann.x = 1.7;
  p.find(me, ['a'], () => ann);
  assert.deepEqual(p.names, ['Ann'], 'still there to raise a glass to');
  assert.equal(p.touch, false, 'but too far to clink');
  assert.notEqual(p.key, near, 'and whatever shows it knows to say so');
  ann.x = CLINK.reach + 0.1;
  p.find(me, ['a'], () => ann);
  assert.deepEqual(p.names, [], 'and out of reach of either, nobody');
});

/** Every corner the whisky's drawn with, and which are its surface's. */
function drawn(w: DecanterWhisky) {
  const g = w.mesh.geometry;
  const pos = g.getAttribute('position');
  const [side, top] = g.groups;
  const at = (i: number) => new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
  return { sides: Array.from({ length: side.count }, (_, i) => at(i)), surface: Array.from({ length: top.count }, (_, i) => at(top.start + i)) };
}
const tipped = (deg: number) => new THREE.Vector3(Math.sin((deg * Math.PI) / 180), Math.cos((deg * Math.PI) / 180), 0);

test('the whisky in the decanter lies level however it is tipped, and runs to the lip once its neck is past level', () => {
  const w = new DecanterWhisky();
  const full = w.fillAt(REST_LEVEL);
  assert.ok(full > 0.4 && full < 0.55, `about half full on the tray (${full.toFixed(3)})`);
  const lip = (up: THREE.Vector3) => up.dot(new THREE.Vector3(0.021, 0.226, 0));
  for (const deg of [0, 45, 80, 105]) {
    const up = tipped(deg);
    const level = w.level(up, full);
    w.lay(up, full);
    const { sides, surface } = drawn(w);
    assert.ok(sides.length > 0 && surface.length > 0, `whisky and its surface at ${deg}°`);
    for (const p of surface) assert.ok(Math.abs(up.dot(p) - level) < 1e-6, `its surface lies level at ${deg}°`);
    for (const p of sides) assert.ok(up.dot(p) <= level + 1e-6, `none of it over its surface at ${deg}°`);
    // Inside the glass: no further out than the inside of it.
    for (const p of sides) assert.ok(Math.hypot(p.x, p.z) <= Math.max(...INSIDE.map(([r]) => r)) + 1e-6 && p.y >= INSIDE[0][1] - 1e-6);
  }
  assert.ok(w.level(tipped(0), full) - REST_LEVEL < 1e-4 && REST_LEVEL - w.level(tipped(0), full) < 1e-4, 'standing, as high as the model has it');
  assert.ok(w.level(tipped(80), full) < lip(tipped(80)), 'tipped short of level, it stays in');
  assert.ok(w.level(tipped(105), full) > lip(tipped(105)), 'past level, it reaches the lip and pours');
  assert.ok(w.level(tipped(105), full - 0.11) < w.level(tipped(105), full), 'a dram out of it, it\'s lower');
});
