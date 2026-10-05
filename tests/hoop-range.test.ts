import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BALL,
  HOOP,
  SWEET,
  WIND_UP,
  backboard,
  hoopArms,
  idealSpeed,
  launch,
  lookAtRim,
  meter,
  shotSpeed,
  simulate,
  step,
  throwOk,
  throwPitch,
  underCeiling,
  type Solid,
} from '../src/shared/hoop.js';
import {
  GREEN_MIN,
  HEAVE_FROM,
  HEAVE_PITCH,
  HEAVE_WIND_UP,
  RANGE,
  clearWay,
  farAim,
  farRelease,
  farShot,
  farSpeed,
  greenWidth,
  heaveThrow,
  isHeave,
  makeWidth,
  windMeter,
  windPace,
  windUpTime,
  type WindClock,
} from '../src/shared/hoop-range.js';
import { BALCONY, ELEVATOR, ELEVATOR_FRONT, FLOOR, LOFT, STAIRS, WALL_HEIGHT, WALL_T } from '../src/shared/layout.js';
import { FARTHEST, rimDistance } from '../src/shared/longshots.js';
import { DEFAULT_FURNITURE } from '../src/shared/furniture.js';
import { roomOf } from '../src/shared/floorplan.js';
import { AWAY_REACH } from '../src/server/pig.js';
import { flyShot, floorSolids } from '../src/server/shot-judge.js';

// Shooting from further out than the green used to show: the green getting smaller out there, and only
// the middle of it dropping in, less and less of the meter the further out you are; the one-armed heave
// from way out on its faster meter; and a long shot only where the ball has a clear way to the ring.

// The floor, the wall behind the hoop, the ceiling, the backboard and its arms: what a shot at the hoop meets.
const room: Solid[] = [
  backboard(),
  hoopArms(),
  { ...FLOOR, bottom: -0.3, top: 0 },
  { minX: FLOOR.minX - WALL_T, maxX: FLOOR.minX, minZ: FLOOR.minZ, maxZ: FLOOR.maxZ, top: 99 },
  { ...FLOOR, bottom: WALL_HEIGHT, top: WALL_HEIGHT + 0.3 },
];

type At = { x: number; y: number; z: number };
type Throw = At & { vx: number; vy: number; vz: number };

/** The throw `speed` m/s from `from`, squared up to the ring at `pitch`. */
function throwAt(from: At, pitch: number, speed: number): Throw {
  const heading = Math.atan2(HOOP.rim.x - from.x, HOOP.rim.z - from.z);
  const c = Math.cos(pitch);
  return { ...from, vx: Math.sin(heading) * c * speed, vy: Math.sin(pitch) * speed, vz: Math.cos(heading) * c * speed };
}

/** A shot at the hoop from `from`, as the page throws one from out past RANGE: the throw it makes let go of at any power on the meter. */
function farThrower(from: At) {
  const aim = farAim(from, throwPitch(lookAtRim(from)), rimDistance(from))!;
  const shot = farShot(from, aim);
  return { aim, shot, at: (power: number) => throwAt(from, shot.pitch, farSpeed(shot, power)) };
}

/** A shot at the hoop from `from` let go of at `power` on the meter, as the page throws one from out past RANGE. */
const farThrow = (from: At, power: number) => {
  const f = farThrower(from);
  return { aim: f.aim, shot: f.shot, s: f.at(power) };
};

/** The same from inside RANGE, as the page has always thrown it (third person, squared up to the hoop). */
function nearThrower(from: At) {
  const pitch = underCeiling(from, throwPitch(lookAtRim(from)));
  const ideal = idealSpeed(from, pitch)!;
  return (power: number) => throwAt(from, pitch, shotSpeed(ideal, power));
}

function goesIn(s: Throw) {
  const sim = launch(s);
  simulate(sim, 8, room);
  return sim.scored;
}

/**
 * How long (ms) round the middle of the green you can let go and have it drop in: every half a
 * thousandth of the meter out from the middle, either way, as long as it goes in.
 */
function makeWindow(at: (power: number) => Throw, heave: boolean): number {
  const by = 0.0005;
  if (!goesIn(at(SWEET.at))) return 0;
  let lo = SWEET.at;
  let hi = SWEET.at;
  while (goesIn(at(lo - by))) lo -= by;
  while (goesIn(at(hi + by))) hi += by;
  return (hi - lo) * windUpTime(heave) * 1000;
}

/** `dist` m out from the rim, `turn` radians round from straight out (toward -z), at `y`. */
const out = (dist: number, turn = 0, y = 1.4) => ({ x: HOOP.rim.x + dist * Math.cos(turn), y, z: HOOP.z - dist * Math.sin(turn) });

/** Where the ball leaves the hands of someone standing at `x`, `z` facing the hoop: 0.3 m toward it, `y` up (1.4 first person, 1.95 third). */
function standing(x: number, z: number, y: number): At {
  const toRim = Math.atan2(HOOP.rim.x - x, HOOP.rim.z - z);
  return { x: x + Math.sin(toRim) * 0.3, y, z: z + Math.cos(toRim) * 0.3 };
}

/** The floor as the office flies a throw past it (see server/shot-judge.ts). */
const office = floorSolids({ furniture: DEFAULT_FURNITURE, room: roomOf(undefined) });

test('inside RANGE the green is as it always was; out past it, smaller the further out, down to a hittable least', () => {
  for (const d of [0.5, 4, 9, 15.9, RANGE]) assert.equal(greenWidth(d), SWEET.width, `${d} m`);
  let last = SWEET.width;
  for (let d = RANGE + 0.5; d <= FARTHEST; d += 0.5) {
    const w = greenWidth(d);
    assert.ok(w <= last && w >= GREEN_MIN, `${d} m: ${w}`);
    last = w;
  }
  assert.ok(greenWidth(RANGE + 4) < SWEET.width * 0.85, 'a few meters out it has shrunk');
  assert.equal(greenWidth(FARTHEST), GREEN_MIN);
  // What of it drops in shrinks with it, and on a heave's faster meter it's still there to hit.
  assert.ok(makeWidth(greenWidth(RANGE + 4)) < makeWidth(SWEET.width));
  assert.ok(makeWidth(GREEN_MIN) * HEAVE_WIND_UP * 1000 >= 6.5);
});

test('a heave from HEAVE_FROM out, on a meter half as fast again', () => {
  assert.ok(HEAVE_FROM > RANGE, 'nothing inside the old range changes');
  assert.ok(!isHeave(RANGE) && !isHeave(HEAVE_FROM - 0.01) && isHeave(HEAVE_FROM) && isHeave(FARTHEST));
  assert.equal(windUpTime(false), WIND_UP);
  assert.ok(Math.abs(windUpTime(true) - WIND_UP / 1.5) < 1e-9);
});

test("the meter's clock reads exactly as the meter always did, and runs faster once it's a heave, without jumping", () => {
  const shot: WindClock = { at: 5000, runs: 0, heave: false };
  for (const held of [0, 0.31, 1.05, 1.6, 2.2, 7.77]) assert.equal(windMeter(shot, 5000 + held * 1000), meter(held), `${held} s in`);
  const heave: WindClock = { at: 5000, runs: 0, heave: true };
  assert.ok(Math.abs(windMeter(heave, 5000 + HEAVE_WIND_UP * 1000) - 1) < 1e-9, 'up in HEAVE_WIND_UP');
  // Walk out past HEAVE_FROM 0.4 s into the wind-up: the meter's where it was, and goes on faster.
  const at = 5400;
  const sped = windPace(shot, at, true);
  assert.ok(Math.abs(windMeter(sped, at) - windMeter(shot, at)) < 1e-12);
  const after = (c: WindClock) => windMeter(c, at + 100) - windMeter(c, at);
  assert.ok(Math.abs(after(sped) / after(shot) - WIND_UP / HEAVE_WIND_UP) < 1e-6);
  assert.equal(windPace(shot, at, false), shot, 'no change, the same clock');
});

test('out past RANGE, a shot squares up to the ring under the ceiling from anywhere on the floor (a heave from way out)', () => {
  let heaves = 0;
  const spots: At[] = [];
  for (let x = FLOOR.minX + 0.5; x < FLOOR.maxX; x += 1.5) for (let z = FLOOR.minZ + 0.5; z < BALCONY.maxZ; z += 1.5) {
    const onFloor = z < FLOOR.maxZ || (x > BALCONY.minX && x < BALCONY.maxX && z > BALCONY.minZ);
    if (onFloor) for (const eye of [1.4, 1.95]) spots.push({ x, y: eye, z });
    // Up in the corner loft, too.
    if (x > LOFT.minX && z > LOFT.minZ) spots.push({ x, y: LOFT.y + 1.4, z });
  }
  const into = { heading: 0, pitch: 0, dist: 0, width: 0, heave: false };
  for (const from of spots) {
    const dist = rimDistance(from);
    if (dist < RANGE) continue;
    const aim = farAim(from, throwPitch(lookAtRim(from)), dist);
    assert.ok(aim, `a green from ${from.x}, ${from.y}, ${from.z} (${dist.toFixed(1)} m)`);
    assert.equal(aim.width, greenWidth(dist));
    assert.equal(aim.heave, isHeave(dist));
    if (aim.heave) heaves++;
    // Squared up to the ring, and under the ceiling.
    assert.ok(Math.abs(aim.heading - Math.atan2(HOOP.rim.x - from.x, HOOP.rim.z - from.z)) < 1e-12);
    if (aim.heave) assert.ok(aim.pitch <= HEAVE_PITCH + 1e-9);
    // The page's, written over each frame of a wind-up, is the same aim.
    assert.equal(farAim(from, throwPitch(lookAtRim(from)), dist, into), into);
    assert.deepEqual(into, aim);
  }
  assert.ok(heaves > 100, `${heaves} heaves`);
});

test('a long shot or a heave let go of round the middle of its green drops in, and well off the green misses', () => {
  const spots = [out(17), out(19.5, 0.3), out(21, 0.5, 1.95), out(23), out(26, 0.4), out(29, 0.2, 1.95), out(33, 0.35), out(38, 0.55)];
  for (const from of spots) {
    const dist = rimDistance(from).toFixed(1);
    const { aim, shot, at } = farThrower(from);
    assert.ok(shot.half > 0, `something drops in from ${dist} m`);
    const make = makeWidth(aim.width);
    assert.ok(make < aim.width / 2, 'only the middle of the green');
    for (const u of [-0.9, -0.5, 0, 0.5, 0.9]) assert.ok(goesIn(at(SWEET.at + (u * make) / 2)), `in from ${dist} m, ${u} of the way to the edge of what drops in`);
    for (const power of [0, 0.5, SWEET.at - aim.width * 2, SWEET.at + aim.width * 2, 1]) assert.ok(!goesIn(at(power)), `out from ${dist} m at ${power.toFixed(3)}`);
  }
});

test('from just past RANGE what drops in is no more of the meter than just inside it, and it never grows further out', () => {
  for (const [turn, eye] of [
    [0, 1.4],
    [0, 1.95],
    [0.3, 1.4],
    [0.3, 1.95],
  ]) {
    const near = makeWindow(nearThrower(out(15.9, turn, eye)), false);
    const windows = [16.1, 17, 18, 20, 21.9, 22.1, 24, 27, 30, 33].map((d) => {
      const from = out(d, turn, eye);
      const { aim, at } = farThrower(from);
      return { d, heave: aim.heave, ms: makeWindow(at, aim.heave) };
    });
    const where = `${turn} round, eyes ${eye} m up`;
    assert.ok(near > 0 && windows[0].ms > 0, `something drops in either side of RANGE (${where})`);
    assert.ok(windows[0].ms <= near, `16.1 m: ${windows[0].ms.toFixed(1)} ms, 15.9 m: ${near.toFixed(1)} ms (${where})`);
    // Each no wider than the last (give or take the half a thousandth of the meter it's measured in).
    for (let i = 1; i < windows.length; i++) {
      const [a, b] = [windows[i - 1], windows[i]];
      assert.ok(b.ms <= a.ms + 0.5 * 1.05, `${b.d} m: ${b.ms.toFixed(1)} ms, wider than ${a.d} m: ${a.ms.toFixed(1)} ms (${where})`);
    }
    // A heave's the hardest of all, and still there to hit.
    for (const w of windows.filter((w) => w.heave)) assert.ok(w.ms < windows[0].ms * 0.7 && w.ms >= 6.5, `${w.d} m heave: ${w.ms.toFixed(1)} ms (${where})`);
  }
});

test('the middle of the green goes in the way the ideal throw does, not off the glass, wherever the ideal goes in', () => {
  // Straight out in front of the board, where a little long banks in: from 16 to 22 m the ideal swishes.
  for (const d of [16.1, 17, 18, 20]) {
    const from = out(d);
    const { shot, at } = farThrower(from);
    assert.ok(goesIn(throwAt(from, shot.pitch, shot.ideal)), `the ideal drops in from ${d} m`);
    const sim = launch(at(SWEET.at));
    simulate(sim, 8, room);
    assert.ok(sim.scored && !sim.touched.board, `${d} m: in, and not off the glass`);
  }
});

test('a heave is flatter and faster than a long two-handed shot, stays under the ceiling, and the office passes it on', () => {
  const long = farThrow(out(20), SWEET.at);
  const heave = farThrow(out(24), SWEET.at);
  assert.ok(!long.aim.heave && heave.aim.heave);
  assert.ok(heave.shot.pitch < long.shot.pitch - 0.05, `${heave.shot.pitch} under ${long.shot.pitch}`);
  for (const from of [out(24), out(33, 0.35), out(40.5, 0.6)]) {
    const { aim, at } = farThrower(from);
    // Thrown as hard as the middle of the green goes, it still clears the ceiling on its way.
    const top = at(SWEET.at + makeWidth(aim.width) / 2);
    assert.ok(top.y + top.vy ** 2 / (2 * 9.8) + BALL.r < WALL_HEIGHT, `under the ceiling from ${rimDistance(from).toFixed(1)} m`);
    const s = at(1);
    const speed = Math.hypot(s.vx, s.vy, s.vz);
    assert.ok(Math.hypot(at(SWEET.at).vx, at(SWEET.at).vy) > BALL.maxSpeed && speed <= BALL.heaveSpeed, `${speed.toFixed(1)} m/s`);
    assert.ok(throwOk(s));
  }
  assert.ok(!throwOk({ ...out(30), vx: -BALL.heaveSpeed, vy: 3, vz: 0 }), 'faster than a heave goes is too fast');
});

test("a long shot is only on where nothing's in the ball's way to the ring, and from inside the room", () => {
  // The corner loft as the page builds it (client/world/office/loft.ts): its floor over the room under
  // it, its roof, its glass to the north and the west of it up to its door; and the elevator's shaft.
  const T = 0.12;
  const roofY = LOFT.y + LOFT.height;
  const left = ELEVATOR.x - ELEVATOR.width / 2;
  const right = ELEVATOR.x + ELEVATOR.width / 2;
  const solids: Solid[] = [
    ...room,
    { minX: LOFT.minX, maxX: LOFT.maxX, minZ: LOFT.minZ, maxZ: LOFT.maxZ, bottom: LOFT.y - 0.25, top: LOFT.y },
    { minX: LOFT.minX, maxX: LOFT.maxX, minZ: LOFT.minZ, maxZ: LOFT.maxZ, bottom: roofY, top: roofY + 0.2 },
    { minX: LOFT.minX, maxX: LOFT.maxX, minZ: LOFT.minZ, maxZ: LOFT.minZ + T, bottom: LOFT.y, top: 99 },
    { minX: LOFT.minX, maxX: LOFT.minX + T, minZ: LOFT.minZ, maxZ: STAIRS.minZ, bottom: LOFT.y, top: 99 },
    { minX: left, maxX: left + ELEVATOR.wall, minZ: FLOOR.minZ, maxZ: ELEVATOR_FRONT, top: 99 },
    { minX: right - ELEVATOR.wall, maxX: right, minZ: FLOOR.minZ, maxZ: ELEVATOR_FRONT, top: 99 },
  ];
  const clear = (x: number, y: number, z: number) => {
    const from = { x, y, z };
    return clearWay(from, farAim(from, throwPitch(lookAtRim(from)), rimDistance(from))!, solids);
  };
  // Out on the floor, from the far end of it to the far corners.
  for (const [x, z] of [
    [6, 0],
    [12, -4],
    [17, 2],
    [17.5, -12.5],
    [0, -12],
    [3, 12.5],
  ])
    for (const eye of [1.4, 1.95]) assert.ok(clear(x, eye, z), `clear from ${x}, ${z}`);
  // Under the loft (in the glass room), up in it, and just north of it, where its glass is in the way.
  assert.ok(!clear(14, 1.4, 10.5) && !clear(16.5, 1.95, 12));
  assert.ok(!clear(12.5, LOFT.y + 1.4, 10.5) && !clear(15, LOFT.y + 1.95, 11.5));
  assert.ok(!clear(15.4, 1.4, 7.4) && !clear(16.4, 1.95, 7.6));
  // Just east of the elevator, its shaft's in the way; from out in front of it, it isn't.
  assert.ok(!clear(10.4, 1.4, -11.6) && clear(10.4, 1.4, -9));
  // Out on the balcony: the office's walls have no doors to throw through.
  assert.ok(!clear(5, 1.4, FLOOR.maxZ + 1));
  // The room as it was, with nothing in it, has a clear way from everywhere in it.
  assert.ok(clearWay(out(30, 0.2), farAim(out(30, 0.2), throwPitch(lookAtRim(out(30, 0.2))), 30)!, room));
});

test("a heave is told from its throw: from way out, straight at the ring; a long shot, a pass or a drop isn't one", () => {
  assert.ok(heaveThrow(farThrow(out(24), SWEET.at).s));
  assert.ok(heaveThrow(farThrow(out(36, 0.5), 0.3).s), 'a heave short of the green is still a heave');
  assert.ok(!heaveThrow(farThrow(out(20), SWEET.at).s), 'a long two-handed shot');
  const at = out(30);
  assert.ok(!heaveThrow({ ...at, vx: -5, vy: 4, vz: 4 }), 'a pass off to the side');
  assert.ok(!heaveThrow({ ...at, vx: -0.25, vy: 0, vz: 0 }), 'dropped');
});

test("PIG goes on with a player anywhere on the floor's own level: there's a long shot from nearly all of it", () => {
  assert.ok(AWAY_REACH >= FARTHEST);
});

test("a heave that's been off the ceiling is dead: it drops through the ring and doesn't count; a two-handed shot off it counts, as it always has", () => {
  /** Flies `s` past the office's floor: whether it went down through the ring, whether that counted, and what it touched. */
  const fly = (s: Throw) => {
    const sim = launch(s);
    let through = false;
    while (sim.t < 5 && !sim.still && !sim.lost && !sim.scored) {
      const y0 = sim.y;
      step(sim, office);
      if (y0 >= HOOP.rim.y && sim.y < HOOP.rim.y && Math.hypot(sim.x - HOOP.rim.x, sim.z - HOOP.rim.z) < HOOP.rim.r - 0.03) through = true;
    }
    return { through: through || sim.scored, scored: sim.scored, heave: sim.heave, ceiling: sim.touched.ceiling };
  };
  // 22.7 m straight out, let go way past the green: up off the ceiling, and down through the ring.
  const from = standing(6, HOOP.z, 1.4);
  const { shot } = farThrower(from);
  for (const power of [0.931, 0.9465]) {
    const heave = fly(throwAt(from, shot.pitch, farSpeed(shot, power)));
    assert.deepEqual(heave, { through: true, scored: false, heave: true, ceiling: true }, `let go at ${power}`);
  }
  // 12 m out, let go very late: two-handed, it comes off the ceiling and in.
  const near = out(12);
  const two = fly(nearThrower(near)(0.926));
  assert.deepEqual(two, { through: true, scored: true, heave: false, ceiling: true });
});

test('from out past RANGE nothing let go of outside the green goes in, anywhere on the meter: only the green counts', () => {
  // Where someone stands (x, z) and how high the ball leaves their hands: straight out, where a heave let
  // go late came off the ceiling and in, or banked in just past the green; off to the side and way out;
  // along the wall the hoop's on, where a long shot let go early can bounce up off the floor and in, and
  // one let go late (as hard as anyone throws it two-handed, right up to the top of the meter) went up
  // off the ceiling, down off the floor and back off the far wall into the ring.
  const spots: [number, number, number][] = [
    [6, HOOP.z, 1.4],
    [5.4, HOOP.z, 1.4],
    [12.5, 7.5, 1.95],
    [12.5, 7.5, 1.4],
    [16.5, 3.5, 1.4],
    [-17.5, -12.5, 1.4],
    [-17.5, -10.5, 1.4],
    [-17, -9.5, 1.4],
    [-16, -9.5, 1.95],
    [0.5, 9.5, 1.95],
  ];
  for (const [x, z, y] of spots) {
    const from = standing(x, z, y);
    const dist = rimDistance(from);
    const aim = farAim(from, throwPitch(lookAtRim(from)), dist)!;
    const shot = farShot(from, aim, office);
    const green = [SWEET.at - aim.width / 2, SWEET.at + aim.width / 2];
    let makes = 0;
    for (let i = 0; i <= 2000; i++) {
      const power = i / 2000;
      // The page lets go of it past the room as it has it, and the office flies it past the floor as it has it: here the same.
      const out = farRelease(from, aim.heading, shot, power, office);
      if (!flyShot(throwAt(from, out.pitch, out.speed), office).made) continue;
      assert.ok(power >= green[0] && power <= green[1], `in from ${dist.toFixed(1)} m let go at ${power}, off the green (${green[0].toFixed(3)} to ${green[1].toFixed(3)})`);
      makes++;
    }
    assert.ok(makes >= 10, `${makes} makes in the green from ${dist.toFixed(1)} m (standing at ${x}, ${z})`);
  }
});

test('every release round the middle of the green goes in, from wherever it is out past RANGE', () => {
  // From where the ball came in so flat that between two speeds that dropped in there was one that
  // rattled out: a little way out past RANGE, and way out to the side, eyes up as in first person and third.
  const spots: [number, number, number][] = [
    [11.5, -2.5, 1.4],
    [15.5, 5.5, 1.4],
    [13.5, -6.5, 1.4],
    [4.5, -10.5, 1.4],
    [-0.5, 11.5, 1.4],
    [3.5, 5.5, 1.95],
  ];
  let between = 0;
  for (const [x, z, y] of spots) {
    const from = standing(x, z, y);
    const dist = rimDistance(from);
    const aim = farAim(from, throwPitch(lookAtRim(from)), dist)!;
    const shot = farShot(from, aim, office);
    const middle = makeWidth(aim.width) / 2;
    for (let i = 0; i <= 400; i++) {
      const u = i / 200 - 1;
      const out = farRelease(from, aim.heading, shot, SWEET.at + u * middle, office);
      assert.ok(flyShot(throwAt(from, out.pitch, out.speed), office).made, `in from ${dist.toFixed(1)} m (standing at ${x}, ${z}), ${u.toFixed(3)} of the way to the edge of the middle`);
      // Thrown at the speeds in between those that were tried (as the middle of the green once went), some rattle out.
      if (!flyShot(throwAt(from, shot.pitch, shot.ideal * (1 + shot.mid + u * shot.half)), office).made) between++;
    }
  }
  assert.ok(between > 0, 'between the speeds tried, some rattle out');
});
