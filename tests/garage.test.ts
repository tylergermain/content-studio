import test from 'node:test';
import assert from 'node:assert/strict';
import { CAR, CARS, DRIVE, PAVEMENT, carFits, carPoint, drive, onPavement, overlaps, parked, paved, steerLimit, turnRadius, type CarPose, type Pedals } from '../src/shared/garage.js';
import { ELEVATOR, ELEVATOR_FRONT, FLOOR, ROAD } from '../src/shared/layout.js';
import { Garage } from '../src/server/garage.js';

const GAS: Pedals = { gas: 1, turn: 0, brake: false };
const COAST: Pedals = { gas: 0, turn: 0, brake: false };

/** `seconds` of these pedals, a 60th of a second at a time. */
function run(p: CarPose, pedals: Pedals, seconds: number): CarPose {
  for (let t = 0; t < seconds; t += 1 / 60) p = drive(p, pedals, 1 / 60);
  return p;
}

const still = (x = 0, z = 0, rotY = 0): CarPose => ({ x, z, rotY, speed: 0, steer: 0 });

test('every car is parked on the pavement, clear of the others and of the elevator', () => {
  const lift = { minX: ELEVATOR.x - ELEVATOR.width / 2, maxX: ELEVATOR.x + ELEVATOR.width / 2, minZ: FLOOR.minZ, maxZ: ELEVATOR_FRONT };
  const boxes = CARS.map((c) => {
    const a = carPoint(c, -CAR.width / 2, -CAR.length / 2);
    const b = carPoint(c, CAR.width / 2, CAR.length / 2);
    return { minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z) };
  });
  CARS.forEach((c, i) => {
    assert.ok(onPavement(c), `${c.name} is on the pavement`);
    assert.ok(!overlaps(c, lift), `${c.name} is out of the elevator`);
    boxes.forEach((b, j) => assert.ok(i === j || !overlaps(c, b), `${c.name} is clear of ${CARS[j].name}`));
  });
  assert.equal(new Set(CARS.map((c) => c.name)).size, CARS.length, 'no two cars go by the same name');
});

test('a car on the gas is quick off the line, gets up past 200 km/h (the boost well past that), and rolls to a dead stop off it', () => {
  let p = run(still(), GAS, 2);
  assert.ok(p.speed > 20 && p.speed < DRIVE.top, `quick off the line (${p.speed.toFixed(1)} m/s after 2 s)`);
  p = run(p, GAS, 20);
  assert.ok(Math.abs(p.speed - DRIVE.top) < 1e-9, `flat out (${p.speed.toFixed(1)} m/s)`);
  assert.ok(DRIVE.top * 3.6 > 200, `${Math.round(DRIVE.top * 3.6)} km/h`);
  assert.ok(Math.abs(p.x) < 1e-6 && p.z > 100, 'straight ahead, along its nose');
  const boosted = run(p, { ...GAS, boost: true }, 20);
  assert.ok(Math.abs(boosted.speed - DRIVE.boostTop) < 1e-9, `on the boost (${boosted.speed.toFixed(1)} m/s)`);
  assert.ok(Math.abs(run(boosted, GAS, 15).speed - DRIVE.top) < 1e-9, 'off it, back down to its top speed');
  p = run(p, COAST, 40);
  assert.equal(p.speed, 0, 'stopped, not creeping');
  const z = p.z;
  assert.equal(run(p, COAST, 1).z, z);
});

test('S brakes hard before it reverses, and the handbrake slows it too', () => {
  const fast = { ...still(), speed: DRIVE.top };
  const back = { gas: -1, turn: 0, brake: false };
  const braking = run(fast, back, 1);
  assert.ok(braking.speed > 0 && braking.speed < fast.speed - 25, `still going forward, a lot slower (${braking.speed.toFixed(1)})`);
  assert.ok(run(fast, back, 2.1).speed <= 0, 'stopped in a couple of seconds from flat out');
  assert.equal(run(fast, back, 8).speed, -DRIVE.reverse, 'then backs up, only so fast');
  const hand = run(fast, { gas: 0, turn: 0, brake: true }, 1);
  assert.ok(hand.speed < fast.speed - 10 && hand.speed > braking.speed, `the handbrake slows it, less than S (${hand.speed.toFixed(1)})`);
  assert.equal(run(fast, { gas: 0, turn: 0, brake: true }, 12).speed, 0);
});

test('A turns left and D right, going forward; backing up swings the other way', () => {
  const left = run({ ...still(), speed: 5 }, { gas: 0.4, turn: 1, brake: false }, 0.5);
  assert.ok(left.rotY > 0.1 && left.x > 0, 'left of +z is +x');
  const right = run({ ...still(), speed: 5 }, { gas: 0.4, turn: -1, brake: false }, 0.5);
  assert.ok(right.rotY < -0.1 && right.x < 0);
  const back = run({ ...still(), speed: -4 }, { gas: -1, turn: 1, brake: false }, 0.5);
  assert.ok(back.rotY < -0.1, 'reversing with the wheel left, the nose swings right');
});

test('slowly it turns tight; flat out it corners only as hard as the tyres hold, and on the handbrake the back comes round', () => {
  assert.ok(turnRadius(3) < 8, `a tight turn at a crawl (${turnRadius(3).toFixed(1)} m)`);
  assert.ok(turnRadius(DRIVE.top) > 100, `a wide one flat out (${turnRadius(DRIVE.top).toFixed(0)} m)`);
  // Full lock flat out: it turns as fast as the tyres let it and no faster, and holds the road.
  const lock = run({ ...still(), speed: DRIVE.top }, { gas: 1, turn: 1, brake: false }, 2);
  assert.ok((lock.spin ?? 0) > 0 && (lock.spin ?? 0) <= DRIVE.grip / DRIVE.top + 1e-9, `turning at ${(lock.spin ?? 0).toFixed(2)} rad/s`);
  assert.ok(Math.abs(lock.slip ?? 0) < 0.5, `not sliding (${(lock.slip ?? 0).toFixed(2)} m/s)`);
  // The handbrake into a turn: it spins round faster than it's going round, and slides out sideways.
  const drift = run({ ...still(), speed: 30 }, { gas: 0, turn: 1, brake: true }, 0.6);
  assert.ok((drift.spin ?? 0) > DRIVE.grip / 30, `spinning round (${(drift.spin ?? 0).toFixed(2)} rad/s)`);
  assert.ok(Math.abs(drift.slip ?? 0) > 3, `sliding out (${(drift.slip ?? 0).toFixed(1)} m/s)`);
  // Let go and it straightens up, the slide dying away.
  const after = run(drift, { gas: 0, turn: 0, brake: false }, 2);
  assert.ok(Math.abs(after.slip ?? 0) < 0.01 && Math.abs(after.spin ?? 0) < 0.05);
  // The wheel takes a moment to turn all the way, and then holds there.
  const p = run({ ...still(), speed: 10 }, { gas: 0, turn: 1, brake: false }, 0.05);
  assert.ok(p.steer > 0 && p.steer < steerLimit(10));
  const held = run(p, { gas: 1, turn: 1, brake: false }, 1);
  assert.ok(Math.abs(held.steer - steerLimit(held.speed)) < 0.05, 'less lock the faster it goes');
});

test('you can drive out of the garage, across the lot and down the street, but not onto the grass', () => {
  // A Ferrari backed in facing the street drives straight out onto the road.
  const ferrari = CARS.find((c) => c.kind === 'ferrari')!;
  for (let z = ferrari.z; z <= (ROAD.minZ + ROAD.maxZ) / 2; z += 0.5) assert.ok(onPavement({ ...ferrari, z }), `z ${z}`);
  // Turned along the road, both ways, and on past either end of the street onto the scenic loop.
  const road = (ROAD.minZ + ROAD.maxZ) / 2;
  for (const x of [80, 105, 115, 130]) {
    assert.ok(onPavement({ x, z: road, rotY: Math.PI / 2 }), `east, x ${x}`);
    assert.ok(onPavement({ x: -x, z: road, rotY: -Math.PI / 2 }), `west, x ${-x}`);
  }
  assert.ok(!onPavement({ x: 125, z: road + 8, rotY: Math.PI / 2 }), 'not off the side of the loop');
  assert.ok(!onPavement({ x: -40, z: 18, rotY: 0 }), 'the lawn beside the lot');
  assert.ok(!onPavement({ x: 0, z: FLOOR.minZ - 1, rotY: Math.PI / 2 }), 'through the back wall');
  assert.ok(!paved(0, ROAD.maxZ + 1.5), 'the far sidewalk');
  // Nothing sticks out of a paved patch where two meet a corner the car could cut.
  assert.ok(PAVEMENT.every((b) => b.minX < b.maxX && b.minZ < b.maxZ));
});

test("a car's turned footprint only overlaps what it really touches", () => {
  const diag = { x: 0, z: 0, rotY: Math.PI / 4 };
  // Inside the square round it, but past its corner: clear.
  const corner = carPoint(diag, CAR.width / 2, CAR.length / 2);
  assert.ok(!overlaps(diag, { minX: corner.x + 0.3, maxX: corner.x + 0.8, minZ: corner.z - 0.2, maxZ: corner.z + 0.2 }));
  const r = Math.hypot(CAR.width, CAR.length) / 2;
  assert.ok(!overlaps(diag, { minX: r - 0.4, maxX: r, minZ: r - 0.4, maxZ: r }), 'the empty corner of its bounding square');
  // Right by its side: hit.
  const side = carPoint(diag, CAR.width / 2 + 0.05, 0);
  assert.ok(overlaps(diag, { minX: side.x - 0.2, maxX: side.x + 0.2, minZ: side.z - 0.2, maxZ: side.z + 0.2 }));
  assert.ok(!carFits(still(CARS[0].x, 0), [{ minX: CARS[0].x - 0.25, maxX: CARS[0].x + 0.25, minZ: -0.25, maxZ: 0.25 }]), 'a column in the way');
  assert.ok(carFits(still(CARS[0].x, 0), []), 'the aisle, with nothing there');
});

test('the garage: one driver and one passenger a car, and only the driver moves it', () => {
  const g = new Garage();
  assert.deepEqual(g.state(), parked(), 'everything in its spot to start with');
  assert.ok(g.enter('ann', 1, 'driver'));
  assert.ok(!g.enter('bob', 1, 'driver'), "Ann's driving");
  assert.ok(g.enter('bob', 1, 'passenger'));
  assert.ok(!g.enter('cat', 1, 'passenger'), 'full');
  assert.deepEqual(g.seatOf('bob'), { car: 1, seat: 'passenger' });
  const pose = { x: 0, z: 18, rotY: 1, speed: 12, steer: 0.1 };
  const going = { ...pose, slip: 0, spin: 0 };
  assert.ok(!g.drive('bob', 1, pose), "the passenger doesn't steer");
  assert.deepEqual(g.drive('ann', 1, pose), going);
  assert.deepEqual({ ...g.state()[1], driver: undefined, passenger: undefined }, { ...going, driver: undefined, passenger: undefined });
  assert.ok(g.drive('ann', 1, { ...pose, x: -60 }), 'off across the grass');
  assert.ok(!g.drive('ann', 1, { ...pose, x: -280 }), 'but not into the sea');
  assert.ok(!g.drive('ann', 1, { ...pose, x: 5000 }), 'nor off the map');
  assert.ok(!g.drive('ann', 1, { ...pose, speed: Number.NaN }), 'nor any nonsense');
  assert.equal(g.drive('ann', 1, { ...pose, speed: 999 })?.speed, DRIVE.boostTop, 'no faster than a car goes');
  assert.ok(g.drive('ann', 1, pose));
  assert.ok(!g.enter('ann', 1, 'bogus' as never));
  // Ann gets out: it stops where she left it, with Bob still in it.
  assert.ok(g.leave('ann'));
  assert.ok(!g.leave('ann'), 'already out');
  const left = g.state()[1];
  assert.equal(left.driver, undefined);
  assert.equal(left.passenger, 'bob');
  assert.deepEqual([left.x, left.z, left.speed, left.steer], [0, 18, 0, 0]);
  // Bob slides over behind the wheel (out of the passenger seat into it), then leaves for good.
  assert.ok(g.enter('bob', 1, 'driver'));
  assert.equal(g.state()[1].passenger, undefined);
  assert.ok(g.leave('bob'));
  assert.ok(!g.enter('ann', 99, 'driver'), 'no such car');
});

test("the garage: a horn only from inside a car, and not faster than a person can press it", () => {
  let now = 1_000_000;
  const g = new Garage(() => now);
  assert.equal(g.honk('ann'), undefined, 'not in a car');
  g.enter('ann', 3, 'passenger');
  assert.equal(g.honk('ann'), 3);
  assert.equal(g.honk('ann'), undefined, 'leaning on it');
  now += 300;
  assert.equal(g.honk('ann'), 3);
});
