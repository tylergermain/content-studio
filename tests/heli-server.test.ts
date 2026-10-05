// The office's Friday One (server/heli/), with a made-up office of two floors, people on them and the
// cars in their garages: only street admins fly it and three ride along, from beside a door while it's
// down; every pose the pilot's page sends is checked (how fast, what's solid, how far out), poses the
// network bunches up included; it won't set down over anyone at street level on any floor, or any
// floor's car; it flies itself home when its pilot goes mid-flight, out from under bar 2's overhang or a
// crane's jib first (just off the ground too), and waits for anyone on its pad; a trip home that gets
// nowhere gives up; and heli.json keeps where it was parked, a file that won't read being set aside.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { WebSocket } from 'ws';
import { BODY, FLIGHT, HELI, bodyHit, groundUnder, heliToStreet } from '../src/shared/heli.js';
import { heliSolids } from '../src/shared/heli-world.js';
import { streetBelow } from '../src/shared/layout.js';
import { PARK, craneAt, type Solid, type StreetPoint } from '../src/shared/mainstreet.js';
import type { BusinessCard, CarState, HeliPose, ServerMsg } from '../src/shared/protocol.js';
import { ROOF } from '../src/shared/rooftop.js';
import { Helicopter, heliIfAny, heliOf } from '../src/server/heli/index.js';
import { STEP, cleanPose, stepWhy } from '../src/server/heli/checks.js';
import { HOME, homeStep, startTrip, type HomeWorld } from '../src/server/heli/home.js';
import { heliTerrain, heliTerrainOver, whyNotLand } from '../src/shared/heli-world.js';
import { newClient, type Client } from '../src/server/office/client.js';
import type { Ctx } from '../src/server/office/context.js';
import { heliHandlers, heliHooks } from '../src/server/ws/handlers/heli.js';

const FLOORS = ['ground', 'upstairs'];

/** A made-up office: two floors (each with its cars), whoever joins, what's sent, and a clock to wind on. */
function office(dir = mkdtempSync(path.join(tmpdir(), 'heli-'))) {
  const clients = new Map<string, Client>();
  const cars = new Map<string, CarState[]>(FLOORS.map((f) => [f, []]));
  const floors = new Map(FLOORS.map((id) => [id, { id, garage: { state: () => cars.get(id)! } }]));
  const admins = new Set<string>();
  const sent: { to: string; msg: ServerMsg }[] = [];
  const all: { msg: ServerMsg; except?: string; droppable?: boolean }[] = [];
  const toasts: string[] = [];
  const clock = { now: 1_800_000_000_000 };
  let cards: BusinessCard[] = [];
  const ctx = {
    cfg: { dataDir: dir },
    clients,
    floors,
    meOf: (accountId?: string) => ({ admin: !!accountId && admins.has(accountId) }),
    sendTo: (c: Client, msg: ServerMsg) => sent.push({ to: c.id, msg }),
    warn: (c: Client, text?: string) => text && sent.push({ to: c.id, msg: { t: 'toast', text, level: 'warn' } }),
    broadcast: (msg: ServerMsg, except?: string, droppable?: boolean) => all.push({ msg, except, droppable }),
    toastAll: (text: string) => toasts.push(text),
  } as unknown as Ctx;
  const make = () => new Helicopter(ctx, { timers: false, now: () => clock.now, cards: () => cards });
  /** Someone on `floor` (or the roof), standing at `at` in the street frame. */
  const join = (name: string, at: { x: number; z: number; h?: number }, opts: { admin?: boolean; floor?: string } = {}): Client => {
    const floor = opts.floor ?? 'ground';
    const i = FLOORS.indexOf(floor);
    const y = (at.h ?? 0) + (i < 0 ? 0 : streetBelow(i));
    const ws = { readyState: 1, send() {} } as unknown as WebSocket;
    const c = newClient(name, ws, { accountId: name, admin: !!opts.admin }, { id: name, name, color: '#2fbf71', look: { skin: 0, hair: 0, style: 0 }, x: at.x, y, z: at.z, rotY: 0, moving: false, voice: false, muted: true, sharing: false, floor } as never);
    if (opts.admin) admins.add(name);
    clients.set(name, c);
    return c;
  };
  /** Moves `c` to `at` in the street frame, on their floor. */
  const walk = (c: Client, at: { x: number; z: number }) => {
    c.peer.x = at.x;
    c.peer.z = at.z;
  };
  const toastsTo = (c: Client) => sent.filter((s) => s.to === c.id && s.msg.t === 'toast').map((s) => (s.msg as Extract<ServerMsg, { t: 'toast' }>).text);
  const snaps = (c: Client) => sent.filter((s) => s.to === c.id && s.msg.t === 'heli.snap').map((s) => s.msg as Extract<ServerMsg, { t: 'heli.snap' }>);
  return { ctx, dir, clients, cars, admins, sent, all, toasts, clock, make, join, walk, toastsTo, snaps, setCards: (c: BusinessCard[]) => (cards = c) };
}

/** Beside its left door, a step out. */
const byDoor = (pose: HeliPose): StreetPoint => heliToStreet(pose, { x: HELI.doors[0].x - 0.8, y: 0, z: HELI.doors[0].z });

/** Has the pilot's page fly it to `to` in steps it could take (27 m/s), a pose every 66 ms, and says whether the office took every one. */
function flyTo(o: ReturnType<typeof office>, heli: Helicopter, pilot: Client, to: Partial<HeliPose>, landed = false): boolean {
  const before = o.snaps(pilot).length;
  const from = heli.state().pose;
  const goal = { ...from, ...to };
  const d = Math.hypot(goal.x - from.x, goal.h - from.h, goal.z - from.z);
  const n = Math.max(1, Math.ceil(d / 1.8));
  for (let i = 1; i <= n; i++) {
    o.clock.now += 66;
    const k = i / n;
    heli.fly(pilot, { x: from.x + (goal.x - from.x) * k, h: from.h + (goal.h - from.h) * k, z: from.z + (goal.z - from.z) * k, yaw: goal.yaw, pitch: 0, roll: 0, spin: 1 }, landed && i === n);
  }
  return o.snaps(pilot).length === before;
}

/** A pilot at the controls on its pad, and up 6 m over it. */
function airborne(o: ReturnType<typeof office>) {
  const heli = o.make();
  const pilot = o.join('tyler', byDoor(heli.state().pose), { admin: true });
  heli.board(pilot, 'pilot');
  assert.equal(heli.state().crew[0]?.id, 'tyler');
  o.clock.now += 66;
  heli.fly(pilot, { ...heli.state().pose, h: 1, spin: 1 }, false);
  assert.equal(heli.state().stage, 'flying');
  assert.ok(flyTo(o, heli, pilot, { h: 6 }));
  return { heli, pilot };
}

test('only street admins fly it, three ride along, and everyone gets in by a door while it is down', () => {
  const o = office();
  const heli = o.make();
  const pose = heli.state().pose;
  assert.deepEqual({ stage: heli.state().stage, pad: heli.state().pad, landed: heli.state().landed }, { stage: 'parked', pad: 'park', landed: true });
  const ada = o.join('ada', byDoor(pose));
  heli.board(ada, 'pilot');
  assert.deepEqual(o.toastsTo(ada), ['🚁 Only street admins fly Friday One']);
  assert.equal(heli.state().crew.length, 0);
  // From across the park, no; from beside a door, yes.
  const tyler = o.join('tyler', { x: pose.x + 15, z: pose.z }, { admin: true });
  heli.board(tyler, 'pilot');
  assert.deepEqual(o.toastsTo(tyler), ['🚁 Walk up to one of its doors first']);
  o.walk(tyler, byDoor(pose));
  o.clock.now += 300;
  heli.board(tyler, 'pilot');
  assert.deepEqual(heli.state().crew.map((m) => [m.id, m.seat, m.place, m.floor]), [['tyler', 'pilot', 0, 'ground']]);
  assert.equal(heli.state().stage, 'landed');
  assert.equal(o.all.at(-1)?.msg.t, 'heli', 'everyone is told');
  // One pilot.
  const gavin = o.join('gavin', byDoor(pose), { admin: true });
  heli.board(gavin, 'pilot');
  assert.deepEqual(o.toastsTo(gavin), ["🚁 Someone's already at the controls"]);
  // Anyone rides along: from another floor too, standing on its street; three at most, in seats 1 to 3.
  heli.board(ada, 'passenger');
  const bo = o.join('bo', byDoor(pose), { floor: 'upstairs' });
  heli.board(bo, 'passenger');
  o.clock.now += 300;
  heli.board(gavin, 'passenger');
  assert.deepEqual(heli.state().crew.map((m) => [m.id, m.place, m.floor]), [['tyler', 0, 'ground'], ['ada', 1, 'ground'], ['bo', 2, 'upstairs'], ['gavin', 3, 'ground']]);
  const cy = o.join('cy', byDoor(pose));
  heli.board(cy, 'passenger');
  assert.deepEqual(o.toastsTo(cy), ["🚁 It's full: three ride along at most"]);
  o.clock.now += 300;
  heli.board(ada, 'passenger');
  assert.ok(o.toastsTo(ada).includes("🚁 You're already aboard"));
  // Up on the roof, there's no door to walk up to.
  const roof = o.join('dee', byDoor(pose), { floor: ROOF });
  heli.board(roof, 'passenger');
  assert.deepEqual(o.toastsTo(roof), ['🚁 Walk up to one of its doors first']);
  // Out again while it's down: a passenger, and the pilot (it's parked, and kept in heli.json).
  o.clock.now += 300;
  heli.leave(ada);
  heli.leave(tyler);
  assert.deepEqual(heli.state().crew.map((m) => m.id), ['bo', 'gavin']);
  assert.equal(heli.state().stage, 'parked');
  assert.ok(existsSync(path.join(o.dir, 'heli.json')));
});

test('every pose the pilot sends is checked: who sends it, how fast, what it goes into, how far out', () => {
  const o = office();
  const { heli, pilot } = airborne(o);
  const good = heli.state().pose;
  const moves = () => o.all.filter((a) => a.msg.t === 'heli.move').length;
  // Anyone else's is ignored.
  const ada = o.join('ada', { x: 0, z: 0 });
  o.clock.now += 66;
  heli.fly(ada, { ...good, x: good.x + 1 }, false);
  assert.equal(heli.state().pose.x, good.x);
  // Twice inside 40 ms, the second is dropped.
  const before = moves();
  o.clock.now += 66;
  heli.fly(pilot, { ...good, x: good.x + 1 }, false);
  o.clock.now += 10;
  heli.fly(pilot, { ...good, x: good.x + 1.2 }, false);
  assert.equal(moves(), before + 1);
  assert.equal(heli.state().pose.x, good.x + 1);
  assert.equal(o.all.at(-1)?.except, 'tyler', "to everyone but the pilot's page");
  assert.equal(o.all.at(-1)?.droppable, true);
  // Too fast, into the tower, out of town, past the ceiling, not a number: back to the last it took.
  const last = heli.state().pose;
  const cases: [Partial<HeliPose>, string][] = [
    [{ x: last.x + 30 }, 'Too fast'],
    [{ x: 600 }, "That's the edge of town"],
    [{ h: 260 }, 'Too high'],
    [{ h: Number.NaN }, 'Lost track of it'],
  ];
  for (const [to, why] of cases) {
    o.clock.now += 66;
    heli.fly(pilot, { ...last, ...to }, false);
    assert.deepEqual(o.snaps(pilot).at(-1), { t: 'heli.snap', pose: last, landed: false, why });
    assert.deepEqual(heli.state().pose, last);
  }
  // Up to the tower's south face, just clear of it: fine; into it, no.
  assert.ok(flyTo(o, heli, pilot, { x: 0, z: 13.3 + HELI.rotor + 6, h: 40 }));
  const near = heli.state().pose;
  assert.ok(!flyTo(o, heli, pilot, { z: 13.3 + HELI.rotor - 1 }), 'but not into it');
  assert.ok(o.snaps(pilot).some((m) => m.why === 'Mind the building!'));
  assert.ok(heli.state().pose.z >= 13.3 + HELI.rotor && heli.state().pose.z <= near.z);
  // A pilot who's no longer a street admin hands it to its autopilot, and rides home as a passenger.
  o.admins.delete('tyler');
  o.clock.now += 66;
  heli.fly(pilot, heli.state().pose, false);
  assert.equal(heli.state().stage, 'home');
  assert.deepEqual(heli.state().crew.map((m) => [m.id, m.seat]), [['tyler', 'passenger']]);
  assert.ok(o.toastsTo(pilot).at(-1)?.startsWith('🚁 Only street admins fly Friday One'));
});

test("poses the network bunches up don't snap an honest pilot back; a jump, or flying faster than it can for long, still does", () => {
  const o = office();
  const { heli, pilot } = airborne(o);
  assert.ok(flyTo(o, heli, pilot, { h: 60 }));
  // West at the page's top speed, a pose every 66 ms, as the page sends them.
  const from = heli.state().pose;
  const along = (k: number): HeliPose => ({ ...from, x: from.x - FLIGHT.forward * 0.066 * k });
  const send = (p: HeliPose, ms: number) => {
    o.clock.now += ms;
    heli.fly(pilot, p, false);
  };
  let k = 0;
  while (k < 10) send(along(++k), 66);
  // The network holds three up for 200 ms and lets them through together (the throttle takes the first
  // and drops the other two); the next comes on time, three poses on from the one taken.
  send(along(++k), 200);
  send(along(++k), 1);
  send(along(++k), 1);
  send(along(++k), 64);
  assert.deepEqual(o.snaps(pilot), []);
  assert.equal(heli.state().pose.x, along(k).x);
  while (k < 20) send(along(++k), 66);
  assert.deepEqual(o.snaps(pilot), [], 'and on it flies');
  // A jump further than STEP.gap of flying is never let through.
  const last = heli.state().pose;
  send({ ...last, x: last.x - FLIGHT.maxSpeed * STEP.gap - STEP.slack - 1 }, 66);
  assert.equal(o.snaps(pilot).at(-1)?.why, 'Too fast');
  assert.deepEqual(heli.state().pose, last);
  // Faster than it can fly (by 60%), pose after pose: let through only while there was flying in hand.
  let n = 0;
  while (o.snaps(pilot).length === 1 && n < 200) send({ ...last, x: last.x - FLIGHT.maxSpeed * 1.6 * 0.066 * ++n }, 66);
  assert.equal(o.snaps(pilot).at(-1)?.why, 'Too fast');
  assert.ok(n <= STEP.gap / (0.066 * 0.6) + 2, `snapped back after ${n} poses`);
});

test("it won't set down over anyone at street level on any floor, nor any floor's car", () => {
  const o = office();
  const { heli, pilot } = airborne(o);
  // Over the street in front of the park, its tail over the park, and down to the ground.
  assert.ok(flyTo(o, heli, pilot, { x: 0, z: 27, h: 6, yaw: Math.PI }));
  const bo = o.join('bo', { x: 2, z: 26 }, { floor: 'upstairs' });
  assert.ok(!flyTo(o, heli, pilot, { h: 0 }, true));
  assert.deepEqual(o.snaps(pilot).at(-1), { t: 'heli.snap', pose: { ...heli.state().pose, h: 3 }, landed: false, why: "Someone's underneath" });
  assert.equal(heli.state().pose.h, 3, 'it holds 3 m up');
  assert.ok(!heli.state().landed);
  // Someone up on the balcony upstairs is no one underneath; someone under its tail is.
  bo.peer.y = streetBelow(1) + 3.6;
  o.walk(bo, { x: 0, z: 27 + HELI.tail - 1 });
  bo.peer.y = streetBelow(1);
  assert.ok(!flyTo(o, heli, pilot, { h: 0 }, true));
  assert.equal(o.snaps(pilot).at(-1)?.why, "Someone's underneath");
  o.walk(bo, { x: 30, z: 27 });
  // A car on the bottom floor's street, under its rotor.
  o.cars.get('ground')!.push({ x: 2.5, z: 25, rotY: 0, speed: 0, steer: 0 } as CarState);
  assert.ok(!flyTo(o, heli, pilot, { h: 0 }, true));
  assert.equal(o.snaps(pilot).at(-1)?.why, "There's a car underneath");
  o.cars.get('ground')!.length = 0;
  // Somewhere it may never land: what the world says.
  assert.ok(flyTo(o, heli, pilot, { x: 25, z: 18.5, h: 4, yaw: 0 }));
  assert.ok(!flyTo(o, heli, pilot, { h: 0 }, true));
  assert.equal(o.snaps(pilot).at(-1)?.why, 'Not on the lot: the parachutes land there');
  // Clear: down, and kept in heli.json.
  assert.ok(flyTo(o, heli, pilot, { h: 8 }));
  assert.ok(flyTo(o, heli, pilot, { x: 0, z: 27, yaw: Math.PI }));
  assert.ok(flyTo(o, heli, pilot, { h: 0 }, true));
  assert.deepEqual({ landed: heli.state().landed, stage: heli.state().stage, pad: heli.state().pad, h: heli.state().pose.h }, { landed: true, stage: 'landed', pad: null, h: 0 });
  const saved = JSON.parse(readFileSync(path.join(o.dir, 'heli.json'), 'utf8'));
  assert.deepEqual([saved.version, saved.pose.x, saved.pose.z, saved.pad], [1, 0, 27, null]);
  // Getting out mid-flight, no; down, yes.
  heli.fly(pilot, { ...heli.state().pose, h: 1 }, false);
  o.clock.now += 300;
  heli.leave(pilot);
  assert.ok(o.toastsTo(pilot).includes("🚁 Wait till it's down"));
});

test('its pilot gone mid-flight, it flies itself home: out from under bar 2 first, and waiting for anyone on the pad', () => {
  const o = office();
  const { heli, pilot } = airborne(o);
  const ada = o.join('ada', byDoor(heli.state().pose));
  // A passenger along for the ride.
  heli.fly(pilot, { ...heli.state().pose }, false);
  // Under bar 2's overhang, west of the tower, 40 m up.
  assert.ok(flyTo(o, heli, pilot, { x: -18.3 - HELI.rotor - 0.2, z: 68, h: 40 }));
  assert.ok(flyTo(o, heli, pilot, { z: 0 }));
  // Someone's standing on the pad, on the floor upstairs.
  const bo = o.join('bo', { x: PARK.pad.x + 1, z: PARK.pad.z, h: PARK.pad.deck }, { floor: 'upstairs' });
  o.clients.delete(pilot.id);
  heli.gone(pilot);
  assert.equal(heli.state().stage, 'home');
  const solids = heliSolids(15, [], 2);
  let waited = 0;
  let landedAt = -1;
  for (let i = 0; i < 2000 && heli.state().stage === 'home'; i++) {
    o.clock.now += 100;
    heli.step(0.1);
    const p = heli.state().pose;
    assert.equal(bodyHit(p, solids), null, `in something at (${p.x.toFixed(1)}, ${p.h.toFixed(1)}, ${p.z.toFixed(1)})`);
    if (Math.hypot(p.x - PARK.pad.x, p.z - PARK.pad.z) < 0.1 && p.h > PARK.pad.deck + HOME.near - 0.01 && p.h < PARK.pad.deck + HOME.near + 0.01) waited++;
    landedAt = i;
  }
  assert.equal(o.toasts.filter((t) => t.includes('waiting to land')).length, 1, 'it asked once');
  assert.ok(waited >= HOME.wait * 10 - 2, `it waited ${waited / 10} s over the pad`);
  const s = heli.state();
  assert.deepEqual({ stage: s.stage, landed: s.landed, pad: s.pad, crew: s.crew }, { stage: 'parked', landed: true, pad: null, crew: [] }, 'its passenger is put out');
  const d = Math.hypot(s.pose.x - PARK.pad.x, s.pose.z - PARK.pad.z);
  assert.ok(d >= HOME.ring[0] - 0.01 && d <= HOME.ring[1] + 0.01, `down ${d.toFixed(1)} m from the pad`);
  assert.equal(whyNotLand(s.pose.x, s.pose.z, s.pose.yaw, []), null);
  assert.ok(Math.hypot(s.pose.x - bo.peer.x, s.pose.z - bo.peer.z) > HELI.clear);
  assert.ok(landedAt > 0);
  void ada;
  // And it spins down.
  for (let i = 0; i < 70; i++) heli.step(0.1);
  assert.equal(heli.state().pose.spin, 0);
});

test('flying home with the pad clear, it sets down on it, turned the way it parks', () => {
  const o = office();
  const { heli, pilot } = airborne(o);
  assert.ok(flyTo(o, heli, pilot, { x: 120, z: -60, h: 30, yaw: 1 }));
  // Its socket closed: out of the office, then let go of.
  o.clients.delete(pilot.id);
  heli.gone(pilot);
  for (let i = 0; i < 1500 && heli.state().stage === 'home'; i++) {
    o.clock.now += 100;
    heli.step(0.1);
  }
  const s = heli.state();
  assert.deepEqual({ stage: s.stage, pad: s.pad }, { stage: 'parked', pad: 'park' });
  assert.ok(Math.abs(s.pose.h - PARK.pad.deck) < 1e-9 && Math.abs(Math.cos(s.pose.yaw - PARK.pad.yaw) - 1) < 1e-6);
  assert.equal(o.toasts.length, 0);
  const saved = JSON.parse(readFileSync(path.join(o.dir, 'heli.json'), 'utf8'));
  assert.deepEqual([saved.pose.x, saved.pose.z, saved.pad], [PARK.pad.x, PARK.pad.z, 'park']);
});

test("the trip home climbs out of the mountains' way, and never through anything", () => {
  const solids = heliSolids(15, [], 3);
  const w: HomeWorld = { solids, terrain: heliTerrain, terrainOver: heliTerrainOver, whyNotLand: (x, z, yaw) => whyNotLand(x, z, yaw, []), occupied: () => false, towerTop: 131.8 };
  for (const start of [
    { x: -60, h: 90, z: 440 },
    { x: -22.5, h: 20, z: 5 },
    { x: 15.7, h: 2, z: -27 },
    { x: 200, h: 5, z: 300 },
  ]) {
    const pose: HeliPose = { ...start, yaw: 0, pitch: 0, roll: 0, spin: 1 };
    pose.h = Math.max(pose.h, heliTerrainOver(pose.x - 8, pose.x + 8, pose.z - 8, pose.z + 8) + 1);
    const trip = startTrip(pose, w, 0);
    let leg = 'flying';
    for (let i = 0; i < 4000 && leg !== 'landed'; i++) {
      leg = homeStep(pose, trip, 0.1, i * 100, w);
      assert.equal(bodyHit(pose, solids), null, `from (${start.x}, ${start.z}) into something at (${pose.x.toFixed(1)}, ${pose.h.toFixed(1)}, ${pose.z.toFixed(1)})`);
      assert.ok(pose.h + BODY.bottom >= heliTerrain(pose.x, pose.z) - 1e-6, 'under the ground');
    }
    assert.equal(leg, 'landed', `home from (${start.x}, ${start.z})`);
  }
});

test("its pilot gone just after lifting off under bar 2's overhang, it edges out, flies home and can be boarded again", () => {
  const o = office();
  const { heli, pilot } = airborne(o);
  // Over to the grass by the tower's west wall, under bar 2 (53 to 81 m up), and down on it.
  for (const to of [{ x: 13, h: 8, z: 68 }, { x: 30, z: 27 }, { x: -23 }, { z: 0 }]) assert.ok(flyTo(o, heli, pilot, to));
  assert.ok(flyTo(o, heli, pilot, { h: 0 }, true));
  assert.deepEqual({ landed: heli.state().landed, x: heli.state().pose.x, z: heli.state().pose.z }, { landed: true, x: -23, z: 0 });
  // Up 0.3 m, and the pilot's tab goes.
  o.clock.now += 300;
  heli.fly(pilot, { ...heli.state().pose, h: 0.3 }, false);
  assert.equal(heli.state().stage, 'flying');
  o.clients.delete(pilot.id);
  heli.gone(pilot);
  const solids = heliSolids(15, [], 2);
  for (let i = 0; i < 1500 && heli.state().stage === 'home'; i++) {
    o.clock.now += 100;
    heli.step(0.1);
    const p = heli.state().pose;
    assert.equal(bodyHit(p, solids), null, `in something at (${p.x.toFixed(1)}, ${p.h.toFixed(1)}, ${p.z.toFixed(1)})`);
  }
  const s = heli.state();
  assert.deepEqual({ stage: s.stage, landed: s.landed, pad: s.pad, x: s.pose.x, z: s.pose.z }, { stage: 'parked', landed: true, pad: 'park', x: PARK.pad.x, z: PARK.pad.z });
  // Its rotor run down, it says nothing more; and anyone gets in by a door.
  const moves = () => o.all.filter((a) => a.msg.t === 'heli.move').length;
  for (let i = 0; i < FLIGHT.spoolDown * 10 + 1; i++) heli.step(0.1);
  const said = moves();
  for (let i = 0; i < 50; i++) heli.step(0.1);
  assert.equal(moves(), said);
  const ada = o.join('ada', byDoor(s.pose));
  o.clock.now += 300;
  heli.board(ada, 'passenger');
  assert.deepEqual(heli.state().crew.map((m) => m.id), ['ada']);
});

test("from anywhere under a building site's crane's jib, at any height under it, the trip home gets out from under and never into anything", () => {
  const cards = (['P2', 'P3', 'P7'] as const).map((plot) => ({ id: `b-${plot}`, name: 'Acme', plot, accent: '#ff8800', skin: 'glass', stage: 'site', home: 'hosted', storeys: [] }) as unknown as BusinessCard);
  const solids = heliSolids(15, cards, 3);
  const w: HomeWorld = { solids, terrain: heliTerrain, terrainOver: heliTerrainOver, whyNotLand: (x, z, yaw) => whyNotLand(x, z, yaw, cards), occupied: () => false, towerTop: 131.8 };
  let tried = 0;
  for (const plot of ['P2', 'P3', 'P7'] as const) {
    const mast = craneAt(plot);
    for (let dx = -30; dx <= 30; dx += 6) {
      for (let dz = -30; dz <= 30; dz += 6) {
        for (const h of [5, 15, 25]) {
          const pose: HeliPose = { x: mast.x + dx, h, z: mast.z + dz, yaw: (dx - dz) / 9, pitch: 0, roll: 0, spin: 1 };
          // Only from where it fits, with the jib over it.
          if (bodyHit(pose, solids) || !bodyHit(pose, solids, 100) || groundUnder(pose, w) > h) continue;
          tried++;
          const from = `from (${pose.x}, ${h}, ${pose.z})`;
          const trip = startTrip(pose, w, 0);
          let leg = 'flying';
          for (let i = 0; i < 3000 && leg !== 'landed'; i++) {
            leg = homeStep(pose, trip, 0.1, i * 100, w);
            if (bodyHit(pose, solids)) assert.fail(`${from} into something at (${pose.x.toFixed(1)}, ${pose.h.toFixed(1)}, ${pose.z.toFixed(1)})`);
          }
          assert.equal(leg, 'landed', `home ${from}`);
        }
      }
    }
  }
  assert.ok(tried > 300, `${tried} starts under a jib`);
});

test('a trip home that gets nowhere gives up after HOME.stuck s: down where it is if it may land there, else back on its pad', () => {
  // Walled in all round and under a lid, as nothing on the street could ever wall it in.
  const at = { x: 120, z: -60, yaw: Math.PI };
  const box = (minX: number, maxX: number, minZ: number, maxZ: number, bottom: number, top: number): Solid => ({ minX, maxX, minZ, maxZ, bottom, top });
  const CAGE = [
    box(at.x - 10, at.x + 10, at.z - 10, at.z + 10, 12.5, 14),
    box(at.x - 11, at.x - 10, at.z - 11, at.z + 11, -1, 14),
    box(at.x + 10, at.x + 11, at.z - 11, at.z + 11, -1, 14),
    box(at.x - 11, at.x + 11, at.z - 11, at.z - 10, -1, 14),
    box(at.x - 11, at.x + 11, at.z + 10, at.z + 11, -1, 14),
  ];
  let cage: Solid[] = [];
  class Caged extends Helicopter {
    protected override world(): HomeWorld {
      const w = super.world();
      return { ...w, solids: [...w.solids, ...cage] };
    }
  }
  assert.equal(whyNotLand(at.x, at.z, at.yaw, []), null, 'somewhere it may land');
  for (const someone of [false, true]) {
    const o = office();
    cage = [];
    const heli = new Caged(o.ctx, { timers: false, now: () => o.clock.now, cards: () => [] });
    const pad = heli.state().pose;
    const pilot = o.join('tyler', byDoor(pad), { admin: true });
    const ada = o.join('ada', byDoor(pad));
    heli.board(pilot, 'pilot');
    heli.board(ada, 'passenger');
    o.clock.now += 66;
    heli.fly(pilot, { ...pad, h: 1, spin: 1 }, false);
    assert.ok(flyTo(o, heli, pilot, { h: 30 }));
    assert.ok(flyTo(o, heli, pilot, { x: at.x, z: at.z }));
    assert.ok(flyTo(o, heli, pilot, { h: 8 }));
    // The cage goes up round it, and (the second time) someone's standing under it, on the floor upstairs.
    cage = CAGE;
    if (someone) o.join('bo', { x: at.x + 1, z: at.z }, { floor: 'upstairs' });
    o.clients.delete(pilot.id);
    heli.gone(pilot);
    const warned: string[] = [];
    const warn = console.warn;
    console.warn = (...a: unknown[]) => void warned.push(a.join(' '));
    let steps = 0;
    try {
      for (; steps < 600 && heli.state().stage === 'home'; steps++) {
        o.clock.now += 100;
        heli.step(0.1);
        const p = heli.state().pose;
        if (heli.state().stage === 'home') assert.deepEqual([p.x, p.h, p.z], [at.x, 8, at.z], 'nowhere to go, it stays put');
      }
    } finally {
      console.warn = warn;
    }
    assert.equal(steps, HOME.stuck * 10, `gave up after ${steps / 10} s`);
    const s = heli.state();
    const where = someone ? { x: PARK.pad.x, h: PARK.pad.deck, z: PARK.pad.z, pad: 'park' } : { x: at.x, h: 0, z: at.z, pad: null };
    assert.deepEqual({ stage: s.stage, landed: s.landed, crew: s.crew, x: s.pose.x, h: s.pose.h, z: s.pose.z, pad: s.pad }, { stage: 'parked', landed: true, crew: [], ...where }, 'its passenger is put out');
    assert.deepEqual(o.all.at(-1)?.msg, { t: 'heli', heli: s }, 'everyone is told');
    const saved = JSON.parse(readFileSync(path.join(o.dir, 'heli.json'), 'utf8'));
    assert.deepEqual([saved.pose.x, saved.pose.z, saved.pad], [where.x, where.z, where.pad]);
    assert.equal(warned.length, 1);
    assert.match(warned[0], someone ? /back on its pad/ : /set down there/);
    // And it's there to get into.
    o.walk(ada, byDoor(s.pose));
    o.clock.now += 300;
    heli.board(ada, 'passenger');
    assert.deepEqual(heli.state().crew.map((m) => m.id), ['ada']);
  }
});

test('heli.json keeps where it was parked; a file that will not read is set aside, and a spot claimed since sends it home', () => {
  const o = office();
  const { heli, pilot } = airborne(o);
  // Down on Plot 2's lawn, for lease.
  assert.ok(flyTo(o, heli, pilot, { x: -56, z: 0, h: 6, yaw: 0 }));
  assert.ok(flyTo(o, heli, pilot, { h: 0 }, true));
  o.clock.now += 300;
  heli.leave(pilot);
  const back = o.make().state();
  assert.deepEqual({ x: back.pose.x, z: back.pose.z, stage: back.stage, pad: back.pad, landed: back.landed, crew: back.crew }, { x: -56, z: 0, stage: 'parked', pad: null, landed: true, crew: [] });
  // Plot 2 claimed since: home on its pad.
  o.setCards([{ id: 'acme', name: 'Acme', plot: 'P2', accent: '#ff8800', skin: 'glass', stage: 'site', home: 'hosted', storeys: [] } as unknown as BusinessCard]);
  const home = o.make().state();
  assert.deepEqual({ x: home.pose.x, z: home.pose.z, pad: home.pad }, { x: PARK.pad.x, z: PARK.pad.z, pad: 'park' });
  o.setCards([]);
  // A file that won't read: logged, it starts on its pad, and the file is moved aside before the next write.
  const file = path.join(o.dir, 'heli.json');
  for (const bad of ['{oops', JSON.stringify({ version: 2, pose: { x: 1, h: 0, z: 1, yaw: 0 }, pad: null }), JSON.stringify({ version: 1, pose: { x: 'a' } })]) {
    writeFileSync(file, bad);
    const errors: string[] = [];
    const log = console.error;
    console.error = (...a: unknown[]) => void errors.push(a.join(' '));
    try {
      const h = o.make();
      assert.deepEqual({ pad: h.state().pad, x: h.state().pose.x }, { pad: 'park', x: PARK.pad.x });
      assert.ok(errors.some((e) => e.includes(file)), `logged: ${errors.join(' | ')}`);
      assert.equal(readFileSync(file, 'utf8'), bad, 'not written over yet');
      const tyler = o.join('tyler', byDoor(h.state().pose), { admin: true });
      o.clock.now += 300;
      h.board(tyler, 'pilot');
      o.clock.now += 300;
      h.leave(tyler);
    } finally {
      console.error = log;
    }
    const aside = readdirSync(o.dir).filter((f) => f.startsWith('heli.json.corrupt-'));
    assert.ok(aside.some((f) => readFileSync(path.join(o.dir, f), 'utf8') === bad), 'moved aside');
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).version, 1, 'and a good one written');
  }
});

test('the pure checks: a pose cleaned up, and a step against the flying it had in hand', () => {
  assert.deepEqual(cleanPose({ x: 1, h: 2, z: 3, yaw: 7, pitch: 4, roll: -4, spin: 3 }), { x: 1, h: 2, z: 3, yaw: Math.atan2(Math.sin(7), Math.cos(7)), pitch: 0.6, roll: -0.6, spin: 1 });
  assert.equal(cleanPose(null), 'Lost track of it');
  assert.equal(cleanPose({ x: 1, h: -1, z: 3, yaw: 0, pitch: 0, roll: 0, spin: 1 }), 'Mind the ground!');
  const w = { solids: heliSolids(15, [], 3), terrain: heliTerrain, whyNotLand: () => null };
  const at = (x: number, h: number, z: number): HeliPose => ({ x, h, z, yaw: 0, pitch: 0, roll: 0, spin: 1 });
  assert.equal(stepWhy(at(0, 50, 40), at(2, 50, 40), 0.066, w), null);
  assert.equal(stepWhy(at(0, 50, 40), at(6, 50, 40), 0.066, w), 'Too fast');
  // Nothing in hand: the leeway, and no more.
  assert.equal(stepWhy(at(0, 50, 40), at(STEP.slack - 0.1, 50, 40), 0, w), null);
  assert.equal(stepWhy(at(0, 50, 40), at(STEP.slack + 0.1, 50, 40), 0, w), 'Too fast');
  // Quiet for a minute: held to a second and a half of flying.
  assert.equal(stepWhy(at(0, 50, 40), at(0, 50, 40 + FLIGHT.maxSpeed * STEP.gap), 60, w), null);
  assert.equal(stepWhy(at(0, 50, 40), at(0, 50, 150), 60, w), 'Too fast');
  assert.equal(stepWhy(at(0, 50, 40), at(0, 50, 18), 1, w), 'Mind the building!');
  // Already in something (it went up round it): out it may go.
  assert.equal(stepWhy(at(0, 50, 10), at(0, 50, 12), 0.066, w), null);
  assert.equal(stepWhy(at(5, 60, 470), at(5, 20, 470), 1.5, w), 'Mind the ground!');
});

test('the handler and the hooks: heliOf for the office, and a pilot whose socket goes sends it home', () => {
  const o = office();
  const tyler = o.join('tyler', byDoor(heliOf(o.ctx).state().pose), { admin: true });
  heliHandlers['heli.board'](o.ctx, tyler, { t: 'heli.board', seat: 'pilot' });
  assert.equal(heliIfAny(o.ctx)?.state().crew[0]?.seat, 'pilot');
  // Off to another floor while it's down: out.
  heliHooks.leaving!(o.ctx, tyler, undefined);
  assert.equal(heliOf(o.ctx).state().crew.length, 0);
  assert.equal(heliIfAny(office().ctx), undefined, "an office that hasn't asked has none");
});
