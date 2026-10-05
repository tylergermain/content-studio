// Friday One on the page (src/client/features/heli): following the office's word of where it is,
// flying it at the controls (a fixed step, what the office hears and when, a landing the office
// refused), the chase and cockpit views, where the pilot's page won't set it down for what's on its
// floor, the downwash on you, getting out, and what the chip says. The flight itself is shared/heli.ts's
// (tests/heli.test.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FLIGHT, HELI, heliToStreet, homePose, type FlyWorld } from '../src/shared/heli.js';
import type { Solid } from '../src/shared/mainstreet.js';
import type { HeliPose } from '../src/shared/protocol.js';
import { STREET_Y } from '../src/shared/layout.js';
import { AHEAD, PoseFollower, SNAP } from '../src/client/features/heli/follow.js';
import { BUMP, Pilot, REFUSED, SEND_EVERY } from '../src/client/features/heli/controller.js';
import { CHASE, COCKPIT, HeliCamera, firstHit } from '../src/client/features/heli/camera.js';
import { PIVOT, heliPoint } from '../src/client/features/heli/model.js';
import { LandingCheck, underneath, washOver } from '../src/client/features/heli/land.js';
import { Ride } from '../src/client/features/heli/ride.js';
import { compass, heliStatus } from '../src/client/features/heli/ui.js';
import type { Collider } from '../src/client/world/types.js';
import type { PlayerController } from '../src/client/player/index.js';

const pose = (p: Partial<HeliPose> = {}): HeliPose => ({ ...homePose(), ...p });
const open: FlyWorld = { solids: [], terrain: () => 0, whyNotLand: () => null };
const keys = (o: Partial<{ forward: number; turn: number; lift: number }> = {}) => ({ forward: 0, turn: 0, lift: 0, engine: false, ...o });

// ---- Following the office's word --------------------------------------------------------------------

test('the first word is drawn where it says; after that it closes on each word smoothly', () => {
  const f = new PoseFollower();
  f.hear(pose({ x: 100, h: 20, z: 0 }), 1000, false);
  f.step(1000, 1 / 60);
  assert.deepEqual([f.pose.x, f.pose.h, f.pose.z], [100, 20, 0]);
  f.hear(pose({ x: 101, h: 20, z: 0 }), 1500, true);
  f.step(1500, 1 / 60);
  const k = 1 - Math.exp(-10 / 60);
  assert.ok(Math.abs(f.pose.x - (100 + k)) < 1e-9, `a sixtieth of a second closes ${k.toFixed(3)} of the way (${f.pose.x})`);
});

test('a late word carries it on the way it was going, for AHEAD seconds at most', () => {
  const f = new PoseFollower();
  f.hear(pose({ x: 0, h: 30 }), 1000, false);
  f.step(1000, 1 / 60);
  f.hear(pose({ x: 2, h: 30 }), 1100, false);
  // Long after: many frames, all with no newer word.
  for (let i = 0; i < 300; i++) f.step(1100 + 2000, 1 / 60);
  assert.ok(Math.abs(f.pose.x - (2 + 20 * AHEAD)) < 1e-6, `20 m/s for ${AHEAD} s past the word, no further (${f.pose.x.toFixed(3)})`);
  assert.ok(Math.abs(f.speed - 20) < 1e-9);
});

test('down, a word carries it nowhere; more than SNAP meters off, it goes straight there', () => {
  const f = new PoseFollower();
  f.hear(pose({ x: 0 }), 1000, false);
  f.step(1000, 1 / 60);
  f.hear(pose({ x: 1 }), 1100, true);
  for (let i = 0; i < 200; i++) f.step(5000, 1 / 60);
  assert.ok(Math.abs(f.pose.x - 1) < 1e-6, 'it stays where it set down');
  f.hear(pose({ x: 1 + SNAP + 5 }), 1200, true);
  f.step(1200, 1 / 60);
  assert.equal(f.pose.x, 1 + SNAP + 5, 'a jump too far to glide');
});

test('its rotor spins up and down at the spool times, not in jumps', () => {
  const f = new PoseFollower();
  f.spinTo(1, 1);
  assert.ok(Math.abs(f.spin - 1 / FLIGHT.spoolUp) < 1e-9);
  for (let i = 0; i < 10; i++) f.spinTo(1, 1);
  assert.equal(f.spin, 1);
  f.spinTo(0, 1);
  assert.ok(Math.abs(f.spin - (1 - 1 / FLIGHT.spoolDown)) < 1e-9, 'it runs down slower than it spins up');
  assert.equal(f.pose.spin, f.spin, 'and that is how it is drawn');
});

// ---- At the controls -------------------------------------------------------------------------------

function pilot() {
  const sent: { pose: HeliPose; landed: boolean; at: number }[] = [];
  const bumps: number[] = [];
  let now = 0;
  const p = new Pilot({ send: (pose, landed) => sent.push({ pose, landed, at: now }), bump: (s) => bumps.push(s) });
  p.start(pose({ x: 0, z: 0, h: 0, yaw: 0 }), true);
  const frames = (n: number, input = keys(), world: FlyWorld = open, dt = 1 / 60) => {
    for (let i = 0; i < n; i++) {
      now += dt * 1000;
      p.update(dt, { ...input, engine: false }, world, now);
    }
  };
  return { p, sent, bumps, frames, now: () => now };
}

test('Space spins it up on the ground, and it lifts off only past FLIGHT.lift, telling the office at once', () => {
  const s = pilot();
  s.frames(Math.floor(FLIGHT.spoolUp * FLIGHT.lift * 60) - 3, keys({ lift: 1 }));
  assert.ok(s.p.flight.landed, 'still down while it spools up');
  assert.ok(s.p.engine, 'the engine is on');
  assert.ok(s.sent.length > 10 && s.sent.every((m) => m.landed), 'the office hears the rotor spin up, still down');
  for (let i = 1; i < s.sent.length; i++) assert.ok(s.sent[i].pose.spin > s.sent[i - 1].pose.spin && s.sent[i].at - s.sent[i - 1].at >= SEND_EVERY - 1e-6);
  // Frame by frame: the office hears it lift off in the very frame it does.
  let frame = 0;
  while (s.p.flight.landed && frame++ < 20) s.frames(1, keys({ lift: 1 }));
  assert.ok(!s.p.flight.landed, 'up');
  const off = s.sent[s.sent.length - 1];
  assert.ok(!off.landed && off.at === s.now(), 'the office hears it lift off at once');
  assert.ok(off.pose.spin >= FLIGHT.lift);
});

test('flying, the office hears where it is every SEND_EVERY ms at most, and nothing while it holds still', () => {
  const s = pilot();
  s.frames(240, keys({ lift: 1 }));
  const from = s.sent.length;
  s.frames(120, keys({ forward: 1 }));
  const sends = s.sent.slice(from);
  assert.ok(sends.length >= 10 && sends.length <= Math.ceil(2000 / SEND_EVERY) + 1, `${sends.length} sends in 2 s`);
  for (let i = 1; i < sends.length; i++) assert.ok(sends[i].at - sends[i - 1].at >= SEND_EVERY - 1e-6, 'never closer together than SEND_EVERY');
  // Hovering, with nothing new to say: no more sends once it has stopped moving.
  s.frames(600);
  const quiet = s.sent.length;
  s.frames(60);
  assert.equal(s.sent.length, quiet, 'nothing new, nothing sent');
});

test('it steps at FLIGHT.step whatever the frame rate, and is drawn between its last two steps', () => {
  const a = pilot();
  const b = pilot();
  a.frames(240, keys({ lift: 1 }), open, 1 / 60);
  b.frames(480, keys({ lift: 1 }), open, 1 / 120);
  assert.ok(Math.abs(a.p.flight.pose.h - b.p.flight.pose.h) < 1e-9, 'the same flight at 60 and at 120 frames a second');
  const c = pilot();
  c.frames(300, keys({ lift: 1 }));
  c.p.update(FLIGHT.step / 2, keys({ lift: 1 }), open, c.now() + 8);
  const d = c.p.drawn.h - c.p.flight.pose.h;
  assert.ok(d < 0 && d > -FLIGHT.climb * FLIGHT.step, `half a step on, it's drawn between the last two (${d.toFixed(4)} m back)`);
});

test('coming down slowly it touches down and the office hears it at once', () => {
  const s = pilot();
  s.frames(260, keys({ lift: 1 }));
  s.frames(600, keys({ lift: -1 }));
  assert.ok(s.p.flight.landed, 'down');
  const last = s.sent[s.sent.length - 1];
  assert.equal(last.landed, true, 'the last word is that it landed');
});

test('a landing the office refuses holds a hover, and it is not tried there again for a while', () => {
  const s = pilot();
  s.frames(260, keys({ lift: 1 }));
  s.frames(600, keys({ lift: -1 }));
  const held = pose({ x: 0, z: 0, h: 3, spin: 1 });
  const refused = s.p.snap(held, false, "Someone's underneath", s.now());
  assert.ok(refused, 'it was a landing refused');
  assert.ok(!s.p.flight.landed && s.p.flight.pose.h === 3, 'back up at the hover it was held at');
  assert.equal(s.p.refusedHere(2, 2, s.now() + 100), "Someone's underneath");
  assert.equal(s.p.refusedHere(REFUSED.within + 1, 0, s.now() + 100), null, 'further off it may try');
  assert.equal(s.p.refusedHere(0, 0, s.now() + REFUSED.for + 1), null, 'and later it may try again');
  // Flying, a snap isn't a landing refused.
  s.frames(30, keys({ lift: 1 }));
  assert.equal(s.p.snap(pose({ h: 10, spin: 1 }), false, 'Mind the building!', s.now()), false);
});

test('flying hard into a wall bumps it back and says how hard', () => {
  const wall: Solid = { minX: -20, maxX: 20, minZ: 30, maxZ: 32, bottom: -1, top: 100 };
  const s = pilot();
  const world: FlyWorld = { ...open, solids: [wall] };
  s.frames(400, keys({ lift: 1 }), world);
  s.frames(400, keys({ forward: 1 }), world);
  assert.ok(s.bumps.length > 0 && s.bumps.every((b) => b > BUMP), `bumped (${s.bumps.map((b) => b.toFixed(1)).join(', ')})`);
  assert.ok(s.p.flight.pose.z < wall.minZ - HELI.rotor + 0.5, 'and never went through it');
});

// ---- Where things are on it -------------------------------------------------------------------------

test('a point on it leans with it: level, as heliToStreet has it; nose down, a seat ahead of the pivot drops', () => {
  const level = pose({ x: 5, h: 2, z: 7, yaw: 1 });
  const s = HELI.seats[0];
  const a = heliPoint(level, s.x, s.y, s.z, { x: 0, h: 0, z: 0 });
  const b = heliToStreet(level, s);
  assert.ok(Math.abs(a.x - b.x) + Math.abs(a.h - b.h) + Math.abs(a.z - b.z) < 1e-9);
  const down = heliPoint(pose({ pitch: 0.2 }), 0, PIVOT, 2, { x: 0, h: 0, z: 0 });
  assert.ok(down.h < pose().h + PIVOT, 'ahead of the pivot goes down as the nose does');
});

// ---- The views --------------------------------------------------------------------------------------

const camWorld = (solids: Solid[] = [], terrain = () => 0) => ({ solids, terrain });

test('the chase view sits behind it and up, then pulls in off what is in the way and stays over the ground', () => {
  const cam = new HeliCamera();
  const camera = new THREE.PerspectiveCamera();
  const eye = new THREE.Vector3();
  cam.start('chase');
  const p = pose({ x: 0, z: 0, h: 50, yaw: 0 });
  cam.place(camera, p, 0, eye, 1 / 60, camWorld(), 0);
  assert.ok(Math.abs(camera.position.z + CHASE.back) < 1e-6, `${CHASE.back} m behind it (${camera.position.z.toFixed(2)})`);
  assert.ok(Math.abs(camera.position.y - (50 + 1.8 + CHASE.up)) < 1e-6, `and ${CHASE.up} m up (${camera.position.y.toFixed(2)})`);
  // A wall between it and the view: the view comes in to this side of it.
  const wall: Solid = { minX: -10, maxX: 10, minZ: -6, maxZ: -5, bottom: 0, top: 100 };
  const pulled = new HeliCamera();
  pulled.start('chase');
  pulled.place(camera, p, 0, eye, 1 / 60, camWorld([wall]), 0);
  assert.ok(camera.position.z > -5, `in front of the wall (${camera.position.z.toFixed(2)})`);
  // Low over a hill: never under the ground.
  const low = new HeliCamera();
  low.start('chase');
  low.turn(0, 2);
  low.place(camera, pose({ h: 2 }), 0, eye, 1 / 60, camWorld([], () => 6), 0);
  assert.ok(camera.position.y >= 6 + CHASE.clear - 1e-9, `over the ground (${camera.position.y.toFixed(2)})`);
});

test('the wheel sets the chase distance within its range; in the cockpit you look round only so far', () => {
  const cam = new HeliCamera();
  cam.zoom(100);
  assert.equal(cam.dist, CHASE.max);
  cam.zoom(-100);
  assert.equal(cam.dist, CHASE.min);
  cam.start('cockpit');
  cam.turn(10, 10);
  assert.equal(cam.lookYaw, COCKPIT.yaw);
  assert.equal(cam.lookPitch, COCKPIT.pitch);
  cam.turn(-20, -20);
  assert.equal(cam.lookYaw, -COCKPIT.yaw);
  assert.equal(cam.lookPitch, -COCKPIT.pitch);
  assert.equal(cam.toggle(), 'chase');
});

test('the cockpit sees from your eye, the way it faces', () => {
  const cam = new HeliCamera();
  const camera = new THREE.PerspectiveCamera();
  cam.start('cockpit');
  cam.lookPitch = 0;
  const eye = new THREE.Vector3(1, 2, 3);
  cam.place(camera, pose({ yaw: Math.PI / 2, pitch: 0, roll: 0 }), 0, eye, 1 / 60, camWorld(), 0);
  assert.deepEqual(camera.position.toArray(), [1, 2, 3]);
  const ahead = new THREE.Vector3();
  camera.getWorldDirection(ahead);
  assert.ok(ahead.x > 0.999, `looking along its nose, east (${ahead.toArray().map((v) => v.toFixed(3))})`);
});

test('firstHit finds how far along a line the first box is', () => {
  const a = new THREE.Vector3(0, 1, 0);
  const b = new THREE.Vector3(0, 1, -10);
  const box: Solid = { minX: -1, maxX: 1, minZ: -6, maxZ: -4, bottom: 0, top: 5 };
  assert.ok(Math.abs(firstHit(a, b, [box], 0) - 0.4) < 1e-9);
  assert.equal(firstHit(a, b, [{ ...box, bottom: 3 }], 0), 1, 'over its top');
  assert.equal(firstHit(a, b, [box], 10), 1, 'with the street lower, the box is too');
});

// ---- Where it won't set down, for what's on your floor ----------------------------------------------

const G = STREET_Y;
const col = (x: number, z: number, w: number, d: number, top: number, bottom = G): Collider => ({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, bottom, top });

test('nothing under the skids taller than a kerb, and nothing up into the rotor', () => {
  const things: Collider[] = [];
  const check = new LandingCheck(() => things);
  let now = 0;
  const why = (x: number, z: number) => check.why(x, z, 0, 0, G, (now += 2000));
  assert.equal(why(0, 0), null, 'clear ground');
  things.push(col(0, 0.5, 1.9, 4.5, G + 1.2));
  assert.equal(why(0, 0), "Can't land here", 'a car under it');
  things.length = 0;
  things.push(col(0, 0, 3, 3, G + 0.12));
  assert.equal(why(0, 0), null, 'a kerb it can stand on');
  things.length = 0;
  things.push(col(3, 0, 0.3, 0.3, G + 5));
  assert.equal(why(0, 0), "Can't land here", 'a lamp post up into its rotor');
  things.length = 0;
  things.push(col(0, 0, 20, 20, 3.5, 0));
  assert.equal(why(0, 0), null, 'the floor overhead is no matter');
});

test('someone on your floor within HELI.clear on the street is underneath; up on a balcony, they are not', () => {
  assert.ok(underneath(2, G, 2, 0, 0, G));
  assert.ok(!underneath(HELI.clear + 0.5, G, 0, 0, 0, G));
  assert.ok(!underneath(1, 0, 1, 0, 0, G), 'on the balcony over the street');
});

// ---- The downwash -----------------------------------------------------------------------------------

function body(x: number, z: number, colliders: Collider[] = []) {
  return { pos: new THREE.Vector3(x, G, z), colliders: [col(0, 0, 400, 400, G, G - 1), ...colliders], grounded: true, stepOffset: 0 };
}

test('flying low it pushes you out from under it; down, or spun down, it does not', () => {
  const b = body(2, 0);
  const push = washOver(b, pose({ x: 0, z: 0, h: 4, spin: 1 }), false, G, 0, 0.1);
  assert.ok(push > 0 && b.pos.x > 2, `pushed out (${push.toFixed(2)} m/s)`);
  const c = body(2, 0);
  assert.equal(washOver(c, pose({ x: 0, z: 0, h: 0.25, spin: 1 }), true, G, 0, 0.1), 0, 'landed: walk up and get in');
  assert.equal(washOver(c, pose({ x: 0, z: 0, h: 4, spin: 0.3 }), false, G, 0, 0.1), 0, 'spinning down');
  assert.equal(c.pos.x, 2);
});

test('the downwash never pushes you through anything', () => {
  const wall = col(2.5, 0, 0.2, 10, G + 3);
  const b = body(2, 0, [wall]);
  for (let i = 0; i < 100; i++) washOver(b, pose({ x: 0, z: 0, h: 3, spin: 1 }), false, G, 0, 0.1);
  assert.ok(b.pos.x < wall.minX, `still this side of the wall (${b.pos.x.toFixed(3)})`);
});

// ---- Getting out, and the chip ----------------------------------------------------------------------

test('out by your own door, else the other one', () => {
  const ride = new Ride({} as PlayerController, new THREE.PerspectiveCamera());
  ride.place = 0;
  const p = pose({ x: 10, z: 10, yaw: 0, h: 0.25 });
  const mine = ride.wayOut(p, -3.35, () => true);
  assert.ok(mine.x < p.x - HELI.cabin.width / 2 && mine.y === -3.35, `the pilot's side is its right, -x (${mine.x.toFixed(2)})`);
  const other = ride.wayOut(p, -3.35, (x) => x > p.x);
  assert.ok(other.x > p.x + HELI.cabin.width / 2, 'no room on that side: the other door');
});

test('the chip names the heading and what it is doing', () => {
  assert.equal(compass(Math.PI), 'N 0°');
  assert.equal(compass(Math.PI / 2), 'E 90°');
  assert.equal(compass(0), 'S 180°');
  assert.equal(compass(-Math.PI / 2), 'W 270°');
  assert.equal(compass(Math.PI * 0.75), 'NE 45°');
  const base = { landed: false, home: false, speed: 0, spin: 1, why: null, engine: true };
  assert.equal(heliStatus({ ...base, landed: true, spin: 0.425 }).text, 'Spinning up · 50%');
  assert.equal(heliStatus({ ...base, landed: true }).text, 'Landed');
  assert.deepEqual(heliStatus({ ...base, why: "Can't land here" }), { text: "Can't land here", tone: 'warn' });
  assert.equal(heliStatus({ ...base, home: true, speed: 18 }).text, 'Flying itself home');
  assert.equal(heliStatus(base).text, 'Hover');
  assert.equal(heliStatus({ ...base, speed: 20 }).text, 'Flying');
});

// ---- The rotor's sound ------------------------------------------------------------------------------

/** Just enough of Web Audio to build the rotor's sound on and read back what it set. */
function fakeAudio() {
  const made: string[] = [];
  const param = (value = 0) => ({ value, target: value, setTargetAtTime(v: number) { this.target = v; }, setValueAtTime() {}, cancelScheduledValues() {} });
  const node = (kind: string, extra: Record<string, unknown> = {}) => {
    made.push(kind);
    return { kind, connect: (to: unknown) => to, ...extra };
  };
  const stopped: string[] = [];
  const source = (kind: string) => node(kind, { start() {}, stop() { stopped.push(kind); }, frequency: param(), type: '', buffer: null, loop: false });
  const ctx = {
    currentTime: 0,
    createGain: () => node('gain', { gain: param(1) }),
    createOscillator: () => source('osc'),
    createWaveShaper: () => node('shaper', { curve: null }),
    createBiquadFilter: () => node('filter', { type: '', frequency: param(), Q: param() }),
  };
  const core = {
    ctx,
    buf: { white: {}, brown: {} },
    ambience: node('ambience'),
    outdoors: false,
    count() {},
    where: () => 'out' as const,
    panner: () => node('panner', { positionX: param(), positionY: param(), positionZ: param() }),
    noise: () => source('noise'),
  };
  return { core, ctx, made, stopped };
}

test('the rotor is built once and then only turned up and down; aboard, it is the cabin mix; null lets it go', async () => {
  const { Rotor } = await import('../src/client/features/heli/sound.js');
  const a = fakeAudio();
  const rotor = new Rotor(a.core as never);
  const at = { x: 0, y: 3, z: 0 };
  rotor.set({ at, spin: 1, speed: 20, aboard: false });
  const built = a.made.length;
  assert.ok(built > 10, `its parts (${built})`);
  type Gain = { gain: { target: number } };
  const run = (rotor as unknown as { run: { out: Gain; inside: Gain; tone: { frequency: { target: number } }; lfo: { frequency: { target: number } } } }).run;
  assert.deepEqual([run.out.gain.target, run.inside.gain.target], [1, 0], 'from outside, from where it is');
  assert.equal(run.lfo.frequency.target, 13, 'a blade past 13 times a second at full spin');
  for (let i = 0; i < 100; i++) {
    a.ctx.currentTime += 1 / 60;
    rotor.set({ at, spin: 1, speed: 20, aboard: i > 50 });
  }
  assert.equal(a.made.length, built, 'nothing new made after the first frame');
  assert.deepEqual([run.out.gain.target, run.inside.gain.target], [0, 0.55], 'aboard, the cabin');
  assert.ok(run.tone.frequency.target < 1000, 'muffled');
  rotor.set(null);
  assert.ok(a.stopped.length >= 4, 'its sources stopped');
  rotor.set({ at, spin: 0.5, speed: 0, aboard: false });
  assert.ok(a.made.length > built, 'and built again when it starts up again');
});
