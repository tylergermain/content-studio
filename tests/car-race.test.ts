import test from 'node:test';
import assert from 'node:assert/strict';
import { SURFACES, groundAt } from '../src/shared/car-ground.js';
import { bounceOff, crash, hitsBox, hitsCar, knock, standOff, velocity } from '../src/shared/car-crash.js';
import { CIRCUIT, GATE, GATES, circuitAt, gridSlot, pointAt } from '../src/shared/circuit.js';
import { CAR, CARS, DRIVE, carFits, drive, groundUnder, onGround, onPavement, paved, type CarPose, type Pedals } from '../src/shared/garage.js';
import { RACE, advance, ordinal, progressOf, raceTime, standings, type Racer } from '../src/shared/race.js';
import { FARM, LAKE, LOOP, STREET_Z, shoreX } from '../src/shared/scenic.js';
import { Garage } from '../src/server/garage.js';
import { joinRace, leftRace, raceTick, startRace } from '../src/server/race.js';
import { botMind, botPedals } from '../src/client/features/cars/bots.js';
import { stepCar } from '../src/client/features/cars/physics.js';

// Driving off the road, crashing, and racing (shared/car-ground.ts, car-crash.ts, circuit.ts, race.ts,
// server/race.ts, client/features/cars/bots.ts and physics.ts).

const GAS: Pedals = { gas: 1, turn: 0, brake: false };
const run = (p: CarPose, pedals: Pedals, seconds: number, ground = SURFACES.road) => {
  for (let t = 0; t < seconds; t += 1 / 60) p = drive(p, pedals, 1 / 60, ground);
  return p;
};
const still = (x = 0, z = 0, rotY = 0): CarPose => ({ x, z, rotY, speed: 0, steer: 0 });

test('off the road is grass (the farm’s fields dirt, the beach sand, the creek water), slower going; the sea, the lake and past the map nobody drives into', () => {
  assert.equal(groundAt(0, STREET_Z, paved(0, STREET_Z))?.name, 'road');
  assert.equal(groundAt(0, 200, false)?.name, 'grass');
  const field = FARM.fields[0];
  assert.equal(groundAt((field.minX + field.maxX) / 2, (field.minZ + field.maxZ) / 2, false)?.name, 'dirt');
  assert.equal(groundAt(shoreX(200) + 5, 200, false)?.name, 'sand');
  assert.equal(groundAt(150, 186, false)?.name, 'water', 'the creek');
  assert.equal(groundAt(shoreX(200) - 5, 200, false), null, 'the sea');
  assert.equal(groundAt(LAKE.x, LAKE.z, false), null, 'the lake');
  assert.equal(groundAt(2000, 0, false), null, 'off the map');
  // Every car can drive off its spot onto the grass beside the lot.
  assert.ok(onGround({ x: -40, z: 18, rotY: 0 }) && !onPavement({ x: -40, z: 18, rotY: 0 }));
  // Off the road it doesn't go as fast, nor corner as hard.
  const grass = run(still(0, 200), GAS, 30, SURFACES.grass);
  assert.ok(Math.abs(grass.speed - DRIVE.top * SURFACES.grass.top) < 1e-6, `${grass.speed.toFixed(1)} m/s on the grass`);
  assert.ok(run(still(0, 200), GAS, 30, SURFACES.sand).speed < grass.speed);
  // Half off the road, the wheels share it.
  const half = groundUnder({ x: 0, z: 31.4, rotY: Math.PI / 2 });
  assert.ok(half && half.grip < 1 && half.grip > SURFACES.grass.grip, `half the grip (${half?.grip})`);
  // Driving flat out off the road onto the grass, it slows down to what the grass allows.
  const ran = run({ ...still(0, 200), speed: DRIVE.top }, GAS, 10, SURFACES.grass);
  assert.ok(Math.abs(ran.speed - DRIVE.top * SURFACES.grass.top) < 1e-6);
});

test('a car hitting a post bounces back off it and out of it; hit off its middle, it spins', () => {
  const post = { minX: -0.3, maxX: 0.3, minZ: 2.6, maxZ: 3.2 };
  const car: CarPose = { x: 0, z: 0.5, rotY: 0, speed: 20, steer: 0 };
  const c = hitsBox(car, post);
  assert.ok(c, 'its nose is in the post');
  assert.ok(c!.nz < -0.99, 'the way out is back the way it came');
  const r = bounceOff(car, c!);
  assert.ok(r.hit > 19 && r.hit <= 20, `hit at ${r.hit}`);
  assert.ok(r.pose.speed < 0 && r.pose.speed > -10, `bounced back, slower (${r.pose.speed.toFixed(1)})`);
  assert.equal(hitsBox(r.pose, post), null, 'and out of it');
  // Off-centre, the knock spins it.
  const side = bounceOff({ ...car, x: 0.9 }, hitsBox({ ...car, x: 0.9 }, post)!);
  assert.ok(Math.abs(side.pose.spin ?? 0) > 0.3, `spun (${side.pose.spin})`);
  assert.ok(!hitsBox({ x: 0, z: -5, rotY: 0 }, post), 'nowhere near it');
});

test('two cars crashing push apart and share the knock, as two equal masses would', () => {
  const a: CarPose = { x: 0, z: 0, rotY: 0, speed: 30, steer: 0 };
  const b: CarPose = { x: 0, z: 4.4, rotY: 0, speed: 0, steer: 0 };
  const c = hitsCar(a, b)!;
  assert.ok(c && c.nz < 0, 'a ran up the back of b');
  const r = crash(a, b, c);
  const va = velocity(r.a), vb = velocity(r.b);
  // The momentum they had between them is what they have after.
  assert.ok(Math.abs(va.z + vb.z - 30) < 1e-6 && Math.abs(va.x + vb.x) < 1e-6, `${va.z.toFixed(2)} + ${vb.z.toFixed(2)}`);
  assert.ok(vb.z > va.z, 'b goes off faster than a, now');
  assert.ok(r.hit > 29, `closing at ${r.hit}`);
  assert.equal(hitsCar(r.a, r.b), null, 'and apart');
  // The kick is what b got: given to b as it was, it's b after.
  const kicked = knock(b, r.kick);
  assert.ok(Math.abs(kicked.speed - r.b.speed) < 1e-9 && Math.abs((kicked.spin ?? 0) - (r.b.spin ?? 0)) < 1e-9);
  // T-boned from the side, it's knocked sideways into a slide.
  const side = crash({ x: -3, z: 0, rotY: Math.PI / 2, speed: 25, steer: 0 }, { x: 0, z: 0, rotY: 0, speed: 0, steer: 0 }, hitsCar({ x: -1.4, z: 0, rotY: Math.PI / 2 }, { x: 0, z: 0, rotY: 0 })!);
  assert.ok(Math.abs(side.b.slip ?? 0) > 5, `knocked sideways (${side.b.slip})`);
  // A car only pushed out of another (its page already knocked them): no bounce, just not going into it.
  const off = standOff(a, c);
  assert.ok(Math.abs(velocity(off).z) < 1e-9 && off.z < a.z);
});

test('the circuit goes from the line east along the street, round the loop and back along the street, in one piece', () => {
  assert.ok(CIRCUIT > 1200 && CIRCUIT < 1600, `${CIRCUIT.toFixed(0)} m round`);
  let last = pointAt(0);
  for (let s = 2; s <= CIRCUIT; s += 2) {
    const p = pointAt(s);
    assert.ok(Math.hypot(p.x - last.x, p.z - last.z) < 2.6, `no gap at ${s}`);
    last = p;
  }
  // Where a point round it is, is how far round it.
  for (const s of [5, 80, 300, 700, 1100, CIRCUIT - 40]) {
    const p = pointAt(s);
    const at = circuitAt(p.x, p.z)!;
    assert.ok(Math.abs(at.s - s) < 3 && at.off < 0.5, `${s} comes back as ${at.s.toFixed(1)}`);
  }
  // The gates are evenly round it; the grid is behind the line, on the street, nobody on top of anybody.
  assert.equal(GATES.length, 15);
  const slots = Array.from({ length: CARS.length }, (_, k) => gridSlot(k));
  for (const [k, p] of slots.entries()) {
    assert.ok(p.x < -6 && onPavement(p), `slot ${k} is on the street behind the line`);
    for (const q of slots.slice(k + 1)) assert.ok(!hitsCar(p, q), `slots ${k} and others are clear of each other`);
  }
});

test('a racer goes through every gate in turn and back over the line for a lap; going back over it, or skipping the loop, does not count', () => {
  let r = { lap: -1, gate: 0 } as ReturnType<typeof advance>;
  // On the grid, then over the line: the start.
  r = advance(r, -20, STREET_Z);
  r = advance(r, 3, STREET_Z);
  assert.deepEqual([r.lap, r.gate], [0, 0]);
  // Straight back over the line: nothing.
  r = advance(r, -3, STREET_Z);
  r = advance(r, 3, STREET_Z);
  assert.deepEqual([r.lap, r.gate], [0, 0]);
  // Every gate, then round to the line: a lap.
  for (const g of GATES) r = advance(r, pointAt(g).x, pointAt(g).z);
  assert.equal(r.gate, GATES.length);
  r = advance(r, -20, STREET_Z);
  const behind = progressOf(r);
  r = advance(r, 3, STREET_Z);
  assert.equal(r.lap, 1);
  assert.ok(r.lapped);
  assert.ok(progressOf(r) > behind, 'further round than just before the line');
  // A shortcut from the street's east end to its west end skips the gates: it gets no further than the next one.
  let cheat = { ...r, lapped: false };
  cheat = advance(cheat, 40, STREET_Z);
  cheat = advance(cheat, -100, STREET_Z);
  assert.equal(cheat.gate, 0);
  assert.ok(progressOf(cheat) <= r.lap * CIRCUIT + GATES[0] + GATE.half, 'no further than its next gate');
  cheat = advance(cheat, 3, STREET_Z);
  assert.equal(cheat.lap, 1, 'and over the line it is no lap');
  // Who's ahead: the finished by time, then by how far round, those out last.
  const racers = [
    { car: 0, name: 'a', slot: 0, lap: 1, gate: 2, progress: 2000 },
    { car: 1, name: 'b', slot: 1, lap: 2, gate: 0, progress: 3000, time: 90_000, place: 2 },
    { car: 2, name: 'c', slot: 2, lap: 2, gate: 0, progress: 2900, time: 80_000, place: 1 },
    { car: 3, name: 'd', slot: 3, lap: 1, gate: 3, progress: 2500, out: true },
  ] as Racer[];
  assert.deepEqual(standings(racers).map((x) => x.name), ['c', 'b', 'a', 'd']);
  assert.equal(raceTime(83_450), '1:23.5');
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd']);
});

test('a race: started from a wheel, bots in the free cars on the grid, joined while lining up, laps to a finish, then over and cleared away', () => {
  let now = 1_000_000;
  const clock = () => now;
  const g = new Garage(clock);
  assert.equal(typeof startRace(g, 'ann', 'Ann', 2, 3, clock), 'string', 'not from your feet');
  assert.ok(g.enter('ann', 4, 'driver'));
  assert.ok(g.enter('bob', 5, 'driver'));
  const race = startRace(g, 'ann', 'Ann', 2, 3, clock);
  assert.ok(typeof race === 'object');
  if (typeof race !== 'object') return;
  // Three bots, in cars nobody's in, which nobody else can now get into.
  const bots = race.racers.filter((r) => r.bot);
  assert.equal(bots.length, 3);
  for (const r of bots) {
    assert.equal(g.state()[r.car].bot, 'ann');
    assert.ok(![4, 5].includes(r.car));
    assert.deepEqual([g.state()[r.car].x, g.state()[r.car].z], [gridSlot(r.slot).x, gridSlot(r.slot).z], 'on its place on the grid');
  }
  assert.ok(!g.enter('cat', bots[0].car, 'driver'), 'a bot is racing it');
  assert.ok(!g.drive('bob', bots[0].car, { x: 0, z: STREET_Z, rotY: 0, speed: 0, steer: 0 }), 'only the starter’s page drives the bots');
  assert.ok(g.drive('ann', bots[0].car, { ...gridSlot(bots[0].slot), speed: 0, steer: 0 }));
  assert.equal(typeof startRace(g, 'bob', 'Bob', 2, 3, clock), 'string', 'one race at a time');
  // Bob joins: people line up in front of the bots.
  assert.equal(joinRace(g, 'bob', 'Bob'), undefined);
  assert.deepEqual(race.racers.filter((r) => !r.bot).map((r) => [r.who, r.slot]), [['ann', 0], ['bob', 1]]);
  assert.ok(race.racers.filter((r) => r.bot).every((r) => r.slot >= 2));
  // Before the lights nothing moves anyone up; after, the laps count.
  assert.equal(race.moved(4, 3, STREET_Z), undefined);
  now += RACE.lobby + 10;
  assert.ok(race.underway);
  const lap = (car: number) => {
    race.moved(car, -20, STREET_Z);
    race.moved(car, 3, STREET_Z);
    for (let n = 0; n < 2; n++) {
      for (const gate of GATES) race.moved(car, pointAt(gate).x, pointAt(gate).z);
      race.moved(car, -20, STREET_Z);
      race.moved(car, 3, STREET_Z);
    }
  };
  lap(5);
  const bob = race.racers.find((r) => r.who === 'bob')!;
  assert.equal(bob.place, 1, 'Bob home first');
  assert.ok(bob.time! > 0);
  assert.equal(raceTick(g, now), undefined, 'Ann still racing');
  // Ann gets out of her car: out of the race, and with her (the starter) the bots.
  assert.ok(leftRace(g, 'ann'));
  assert.ok(race.racers.find((r) => r.who === 'ann')!.out);
  assert.equal(raceTick(g, now), 'over');
  for (const r of bots) {
    const c = g.state()[r.car];
    assert.equal(c.bot, undefined, 'its bot gone');
    assert.deepEqual([c.x, c.z], [CARS[r.car].x, CARS[r.car].z], 'parked back in its spot');
  }
  assert.ok(race.view().over);
  now += RACE.keepOver + 1;
  assert.equal(raceTick(g, now), 'gone');
  assert.equal(g.race, undefined);
});

test('lining up, the last person leaving calls the race off; a knock rolls a car nobody is in, and reaches the driver of one somebody is', () => {
  const g = new Garage();
  g.enter('ann', 4, 'driver');
  const race = startRace(g, 'ann', 'Ann', 1, 2);
  assert.ok(typeof race === 'object');
  assert.ok(leftRace(g, 'ann'));
  assert.equal(g.race, undefined, 'called off');
  assert.ok(g.state().every((c) => !c.bot), 'the bots went home');
  // Ann knocks the empty car next to her rolling: her page rolls it, a little way at a time.
  const empty = g.state()[5];
  assert.ok(g.push('ann', 5, { ...empty, x: empty.x + 1, speed: 3 }));
  assert.equal(g.push('ann', 5, { ...empty, x: empty.x + 200 }), undefined, 'not across the map');
  assert.equal(g.push('cat', 5, { ...empty, x: empty.x + 1 }), undefined, 'not from someone not driving');
  // Bob's in the car she hits: the knock goes to him, if she's near it.
  g.enter('bob', 6, 'driver');
  const near = g.state()[5];
  g.drive('ann', 4, { x: near.x - 5, z: near.z, rotY: 0, speed: 0, steer: 0 });
  g.drive('bob', 6, { x: near.x - 9, z: near.z, rotY: 0, speed: 0, steer: 0 });
  assert.equal(g.hit('ann', 6, 4), 'bob');
  assert.equal(g.hit('ann', 5, 4), undefined, 'nobody to tell in an empty car');
  assert.equal(g.hit('bob', 6, 4), undefined, 'not with someone else’s car');
  g.drive('bob', 6, { x: near.x + 60, z: near.z, rotY: 0, speed: 0, steer: 0 });
  assert.equal(g.hit('ann', 6, 4), undefined, 'not from across the lot');
});

test('a bot drives laps of the circuit on its own, braking for the bends, and the office counts them', () => {
  const g = new Garage();
  g.enter('ann', 4, 'driver');
  let now = 0;
  const race = startRace(g, 'ann', 'Ann', 2, 1, () => now);
  assert.ok(typeof race === 'object');
  if (typeof race !== 'object') return;
  now += RACE.lobby;
  const bot = race.racers.find((r) => r.bot)!;
  const mind = botMind(bot.car);
  let pose: CarPose = { ...gridSlot(bot.slot), speed: 0, steer: 0 };
  const world = { solids: () => [], cars: () => [] };
  const events = { bump: () => {}, hitCar: () => {} };
  let fastest = 0;
  let offRoad = 0;
  const dt = 1 / 30;
  for (let t = 0; t < 240 && bot.time === undefined; t += dt) {
    pose = stepCar(bot.car, pose, botPedals(pose, mind, dt, true), dt, world, events);
    race.moved(bot.car, pose.x, pose.z);
    fastest = Math.max(fastest, pose.speed);
    if ((circuitAt(pose.x, pose.z)?.off ?? 99) > 8) offRoad += dt;
    now += dt * 1000;
  }
  assert.ok(bot.time !== undefined, `it finished two laps (lap ${bot.lap}, gate ${bot.gate})`);
  assert.ok(bot.time! < 150_000, `in ${raceTime(bot.time!)}`);
  assert.ok(fastest > 40, `flat out at ${Math.round(fastest * 3.6)} km/h somewhere`);
  assert.ok(offRoad < 3, `on the road nearly all the way (${offRoad.toFixed(1)} s off it)`);
  // Before the lights it sits on the brakes.
  assert.deepEqual(botPedals({ ...gridSlot(0), speed: 0, steer: 0 }, botMind(0), dt, false), { gas: 0, turn: 0, brake: true });
  assert.ok(carFits(gridSlot(0), []));
  void LOOP;
  void CAR;
});
