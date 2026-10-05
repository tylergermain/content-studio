import test from 'node:test';
import assert from 'node:assert/strict';
import { PUTT_CELLS, puttCell } from '../src/shared/mainstreet.js';
import { HOLES, PAR } from '../src/shared/minigolf/course.js';
import { ROLL, heightAt, millOpen, offBumper, puttSpeed, restSpot, roll, teeBall, type Rolled } from '../src/shared/minigolf/physics.js';
import { BALL_R, CLUB, PUTT_METER, type Hole, type XZ } from '../src/shared/minigolf/types.js';
import { within } from '../src/shared/minigolf/surface.js';
import { PUTT_RULES, type PuttBall } from '../src/shared/protocol.js';

// Putt Street's nine holes and the putting the office referees them with (shared/minigolf/): every
// hole can be played in par, the felt keeps every putt in (but for the lip, the water and the cup),
// the windmill's sails and the loop do what they say, the meter's window is fair, and the same putt
// always rolls the same way.

const toward = (a: XZ, b: XZ) => Math.atan2(b.x - a.x, b.z - a.z);
const yawDeg = (deg: number) => (deg * Math.PI) / 180;
/** Plays `strokes` from the tee: how each went, until one drops. */
function play(hole: Hole, strokes: { yaw: number; power: number; startAt: number }[]): Rolled[] {
  let ball: PuttBall = teeBall(hole);
  const out: Rolled[] = [];
  for (const s of strokes) {
    const r = roll(hole, { from: ball, ...s });
    out.push(r);
    if (r.holed) break;
    ball = r.rest;
  }
  return out;
}

/** The power that sends the ball off at `speed` m/s. */
function powerFor(speed: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (puttSpeed(mid) < speed) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

test('the nine holes are par 26, each in its own cell, teed up and holed on felt', () => {
  assert.equal(HOLES.length, PUTT_RULES.holes);
  assert.equal(PAR, 26);
  assert.deepEqual(
    HOLES.map((h) => h.par),
    [2, 3, 3, 2, 3, 3, 3, 3, 4],
  );
  for (const hole of HOLES) {
    const cell = puttCell(hole.n);
    assert.deepEqual(hole.cell, { x: PUTT_CELLS[hole.n - 1].x, z: PUTT_CELLS[hole.n - 1].z });
    const inCell = (p: XZ) => p.x >= cell.minX && p.x <= cell.maxX && p.z >= cell.minZ && p.z <= cell.maxZ;
    for (const f of hole.felt) for (const p of f.poly) assert.ok(inCell(p), `hole ${hole.n}'s felt stays in its cell`);
    for (const w of hole.walls) for (const p of w.pts) assert.ok(inCell(p), `hole ${hole.n}'s walls stay in its cell`);
    assert.notEqual(heightAt(hole, hole.tee.x, hole.tee.z), null, `hole ${hole.n}'s tee is on felt`);
    assert.notEqual(heightAt(hole, hole.cup.x, hole.cup.z), null, `hole ${hole.n}'s cup is on felt`);
    assert.ok(!hole.keepOff?.some((k) => within(k, hole.tee.x, hole.tee.z)), `hole ${hole.n}'s tee is somewhere to stand`);
  }
  assert.ok(HOLES[1].mill, 'the windmill is hole 2, front and centre');
  assert.equal(HOLES[1].mill!.period, 4);
  assert.equal(HOLES[1].mill!.shut, 0.35);
  assert.ok(HOLES[4].loop && HOLES[5].tunnels?.length === 3 && HOLES[6].water && HOLES[7].cones && HOLES[8].arch);
});

/** A way round each hole in par or better, as the office rolls it: yaw (degrees), power, and when it's struck. */
const KNOWN: [number, number, number][][] = [
  [[0, 0.55, 1_007_919]],
  [[-4, 0.58, 1_007_919]],
  [
    [-124.58, 0.94, 1_007_919],
    [-129.43, 0.87, 1_015_969],
  ],
  [[4.02, 0.82, 1_007_919]],
  [
    [92.18, 1, 1_007_919],
    [163.3, 0.13, 1_015_969],
  ],
  [
    [111.02, 0.46, 1_007_919],
    [143.59, 0.04, 1_015_969],
  ],
  [[0, 1, 1_007_919]],
  [[-90, 0.7, 1_007_919]],
  [
    [-88, 1, 1_007_919],
    [-90.15, 0.43, 1_015_969],
  ],
];

test('every hole has a known way to sink it in par or better', () => {
  for (const hole of HOLES) {
    const strokes = KNOWN[hole.n - 1].map(([deg, power, startAt]) => ({ yaw: yawDeg(deg), power, startAt }));
    const went = play(hole, strokes);
    assert.ok(went.at(-1)?.holed, `hole ${hole.n} drops: ${JSON.stringify(went.map((r) => r.rest))}`);
    assert.ok(went.length <= hole.par);
    assert.ok(went.every((r) => !r.out));
  }
});

// The search: from each spot, putts at the cup, the tunnels' mouths and the next corners of the
// route (a little either side), and a fan all round, at every power; it keeps the few spots left
// nearest the cup (along the route, on the holes that don't head straight for it).
const ROUTES: Record<number, XZ[]> = {
  3: [
    { x: -65.7, z: 46.7 },
    { x: -65.7, z: 42.8 },
    { x: -72.3, z: 42.8 },
    { x: -72.3, z: 39.4 },
  ],
  9: [
    { x: -65.2, z: 67.1 },
    { x: -71, z: 67.1 },
    { x: -72.3, z: 68.4 },
    { x: -71, z: 69.7 },
    { x: -66.6, z: 69.7 },
    { x: -65.3, z: 71 },
    { x: -66.6, z: 72.3 },
    { x: -72.2, z: 72.3 },
  ],
};

function togo(hole: Hole, p: XZ): number {
  const route = ROUTES[hole.n];
  if (!route) return Math.hypot(p.x - hole.cup.x, p.z - hole.cup.z);
  const lens = route.slice(1).map((q, i) => Math.hypot(q.x - route[i].x, q.z - route[i].z));
  let best = Infinity;
  for (let i = 0; i < lens.length; i++) {
    const a = route[i];
    const b = route[i + 1];
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.z - a.z) * ez) / (ex * ex + ez * ez)));
    const left = lens.slice(i + 1).reduce((s, l) => s + l, 0) + lens[i] * (1 - t);
    best = Math.min(best, Math.hypot(p.x - (a.x + ex * t), p.z - (a.z + ez * t)) * 3 + left);
  }
  return best;
}

function search(hole: Hole): number | null {
  type Spot = { ball: PuttBall; strokes: number; score: number };
  let spots: Spot[] = [{ ball: teeBall(hole), strokes: 0, score: 0 }];
  for (let depth = 1; depth <= hole.par; depth++) {
    const next: Spot[] = [];
    for (const spot of spots) {
      const aims: number[] = [];
      for (const t of [hole.cup, ...(hole.tunnels ?? []).map((tn) => tn.mouth), ...(ROUTES[hole.n]?.slice(1) ?? [])]) {
        for (let k = -4; k <= 4; k++) aims.push(toward(spot.ball, t) + yawDeg(k));
      }
      for (let k = 0; k < 24; k++) aims.push((k * Math.PI) / 12);
      for (const yaw of aims) {
        for (let power = 0.04; power <= 1.0001; power += 0.03) {
          const r = roll(hole, { from: spot.ball, yaw, power, startAt: 1_000_000 + depth * 7_919 });
          if (r.holed) return depth;
          if (!r.out) next.push({ ball: r.rest, strokes: depth, score: togo(hole, r.rest) });
        }
      }
    }
    next.sort((a, b) => a.score - b.score);
    spots = [];
    for (const n of next) {
      if (spots.some((m) => Math.hypot(m.ball.x - n.ball.x, m.ball.z - n.ball.z) < 0.3)) continue;
      spots.push(n);
      if (spots.length >= 4) break;
    }
  }
  return null;
}

test('a search finds par or better on every hole', () => {
  for (const hole of HOLES) {
    const strokes = search(hole);
    assert.ok(strokes !== null && strokes <= hole.par, `hole ${hole.n} (${hole.name}) in par: ${strokes}`);
  }
});

test('2,000 random putts a hole stay on the felt (but over the lip, into the water or the cup), in the cell, and never faster than the cap', () => {
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (const hole of HOLES) {
    const cell = puttCell(hole.n);
    const tee = teeBall(hole);
    const step = ROLL.maxSpeed / PUTT_RULES.samples + 0.002;
    for (let i = 0; i < 2000; i++) {
      // From the tee, or from somewhere a putt from the tee came to rest.
      const from = i % 2 ? tee : roll(hole, { from: tee, yaw: rnd() * 6.3 - 3.15, power: rnd(), startAt: 5e5 }).rest;
      const r = roll(hole, { from, yaw: rnd() * Math.PI * 2 - Math.PI, power: rnd(), startAt: Math.floor(rnd() * 1e6) });
      const what = `hole ${hole.n}, putt ${i}`;
      if (r.out === 'off') assert.ok(hole.felt.some((f) => f.lips?.length), `${what}: only a lip throws a ball off the felt`);
      if (r.out === 'water') assert.ok(hole.water?.length, `${what}: in water only where there's water`);
      const n = r.path.length / 3;
      for (let k = 0; k < n; k++) {
        const x = r.path[k * 3];
        const z = r.path[k * 3 + 2];
        assert.ok(x >= cell.minX && x <= cell.maxX && z >= cell.minZ && z <= cell.maxZ, `${what} stays in the cell`);
        // The last point can drop into the cup.
        if (k > 0 && k < n - 1) assert.ok(Math.hypot(x - r.path[k * 3 - 3], z - r.path[k * 3 - 1]) <= step, `${what} never goes faster than ${ROLL.maxSpeed} m/s`);
      }
      if (r.holed || r.out) continue;
      assert.notEqual(heightAt(hole, r.path[n * 3 - 3], r.path[n * 3 - 1]), null, `${what} comes to rest on the felt`);
      assert.ok(!hole.keepOff?.some((k) => within(k, r.rest.x, r.rest.z)), `${what} is played from somewhere to stand`);
    }
  }
});

test("the windmill's sails shut its tunnel on the office's clock: shut, the ball comes back off a sail; open, it goes through", () => {
  const hole = HOLES[1];
  const mill = hole.mill!;
  const from = teeBall(hole);
  let blocked = 0;
  let through = 0;
  for (let k = 0; k < 80; k++) {
    const startAt = 2_000_000 + k * 50;
    const r = roll(hole, { from, yaw: toward(from, mill), power: 0.58, startAt });
    const sail = r.events.find(([, e]) => e === 'mill');
    const tunnel = r.events.find(([, e]) => e === 'tunnel');
    assert.ok(!!sail !== !!tunnel, 'one or the other, every time');
    if (sail) {
      blocked++;
      assert.equal(millOpen(mill, startAt + sail[0] * 1000), false, 'a sail was across the mouth when it hit one');
      assert.ok(r.rest.z < mill.z, 'and it came back toward the tee');
    } else {
      through++;
      assert.equal(millOpen(mill, startAt + tunnel![0] * 1000), true, 'the mouth was open when it went in');
      assert.ok(r.holed || r.rest.z > mill.z || r.moved, 'and it came out behind');
    }
  }
  assert.ok(blocked > 5 && through > 20, `both happen over a turn of the sails (${blocked} turned back, ${through} through)`);
});

test("the sails cover the mouth for 35% of each sail's turn, half either side of a sail pointing straight down", () => {
  const mill = HOLES[1].mill!;
  const quarter = (mill.period * 1000) / mill.blades;
  let shut = 0;
  for (let t = 0; t < quarter; t++) if (!millOpen(mill, 7 * mill.period * 1000 + t)) shut++;
  assert.ok(Math.abs(shut / quarter - mill.shut) < 0.002);
  assert.equal(millOpen(mill, 0), false, 'a sail points straight down at millAngle 0');
  assert.equal(millOpen(mill, quarter / 2), true, 'and the mouth is clear halfway between sails');
  assert.equal(millOpen(mill, -quarter), false, 'the same before 1970 as after');
});

test('the loop sends a ball back out at 5.0 m/s at its foot, and round it at 6.2', () => {
  const hole = HOLES[4];
  const loop = hole.loop!;
  const f = { x: Math.sin(loop.yaw), z: Math.cos(loop.yaw) };
  const from = { x: loop.entry.x - f.x * 0.02, y: heightAt(hole, loop.entry.x - f.x * 0.02, loop.entry.z)!, z: loop.entry.z - f.z * 0.02 };
  const along = (p: XZ) => (p.x - loop.entry.x) * f.x + (p.z - loop.entry.z) * f.z;
  const slow = roll(hole, { from, yaw: loop.yaw, power: powerFor(5.0), startAt: 0 });
  assert.ok(slow.events.some(([, e]) => e === 'loop'));
  assert.ok(along(slow.rest) < 0, 'too slow: it rolls back out toward the tee');
  const fast = roll(hole, { from, yaw: loop.yaw, power: powerFor(6.2), startAt: 0 });
  assert.ok(fast.events.some(([, e]) => e === 'loop'));
  assert.ok(fast.holed || along(fast.rest) > 0, 'fast enough: round and out onto the green');
  // Out of the loop (once it's back down on the felt) it's going no faster than ROLL.loopOut: it doesn't rattle round the cell.
  let out = 0;
  for (let i = 0; i < fast.path.length; i += 3) if (fast.path[i + 1] > 0.041) out = i + 6;
  assert.ok(out > 6, 'it went up round the loop');
  for (let i = out; i + 3 < fast.path.length - 3; i += 3) {
    assert.ok(Math.hypot(fast.path[i + 3] - fast.path[i], fast.path[i + 5] - fast.path[i + 2]) * PUTT_RULES.samples <= ROLL.loopOut + 0.05);
  }
  // Where it decides is minSpeed, near enough.
  const passes = (v: number) => along(roll(hole, { from, yaw: loop.yaw, power: powerFor(v), startAt: 0 }).rest) > 0;
  assert.equal(passes(loop.minSpeed - 0.05), false);
  assert.equal(passes(loop.minSpeed + 0.05), true);
});

test('bumpers never add speed: they give back less than all of what hits them', () => {
  const bumper = HOLES[2].bumpers![0];
  let seed = 11;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  let hits = 0;
  for (let i = 0; i < 20_000; i++) {
    const a = rnd() * Math.PI * 2;
    const d = bumper.r + BALL_R * (0.2 + rnd() * 0.8);
    const ball = { x: bumper.x + d * Math.cos(a), z: bumper.z + d * Math.sin(a), vx: (rnd() - 0.5) * 14, vz: (rnd() - 0.5) * 14 };
    const before = Math.hypot(ball.vx, ball.vz);
    if (offBumper(ball, bumper) > 0) hits++;
    assert.ok(Math.hypot(ball.vx, ball.vz) <= before + 1e-9);
    assert.ok(Math.hypot(ball.x - bumper.x, ball.z - bumper.z) >= bumper.r + BALL_R - 1e-9, 'and leave it just touching');
  }
  assert.ok(hits > 5000);
  // However it's set, a bumper can't give back more than nearly all of it.
  const wild = { ...bumper, bounce: 3 };
  const ball = { x: bumper.x + bumper.r + 0.02, z: bumper.z, vx: -4, vz: 0 };
  offBumper(ball, wild);
  assert.ok(Math.abs(ball.vx) < 4);
});

test('a straight 3 m putt on level felt has a window of at least 120 ms on the meter, and longer ones less', () => {
  const flat: Hole = { n: 0, name: 'flat', par: 2, cell: { x: 0, z: 0 }, tee: { x: 0, z: -3 }, cup: { x: 0, z: 0 }, felt: [{ poly: [{ x: -1, z: -5 }, { x: 1, z: -5 }, { x: 1, z: 5 }, { x: -1, z: 5 }], h: 0.04 }], walls: [] };
  const windowMs = (d: number) => {
    const step = 0.0005;
    let first = -1;
    let last = -1;
    for (let p = 0; p <= 1; p += step) {
      if (!roll(flat, { from: { x: 0, y: 0.04, z: -d }, yaw: 0, power: p, startAt: 0 }).holed) continue;
      if (first < 0) first = p;
      else assert.ok(p - last < step * 1.5, `one window, not several, at ${d} m`);
      last = p;
    }
    return (last - first + step) * PUTT_METER.up * 1000;
  };
  const three = windowMs(3);
  assert.ok(three >= 120, `3 m: ${three.toFixed(0)} ms`);
  assert.ok(windowMs(1) > three && windowMs(5) < three);
});

test('putting harder sends it faster, from 0.4 m/s to the cap', () => {
  assert.equal(puttSpeed(0), 0.4);
  assert.equal(puttSpeed(1), ROLL.maxSpeed);
  assert.equal(puttSpeed(-3), 0.4);
  assert.equal(puttSpeed(9), ROLL.maxSpeed);
  for (let p = 0; p < 1; p += 0.01) assert.ok(puttSpeed(p + 0.01) > puttSpeed(p));
});

test('the same putt always rolls the same way, on any copy of the hole', () => {
  for (const hole of HOLES) {
    const s = { from: teeBall(hole), yaw: toward(hole.tee, hole.cup) + 0.03, power: 0.71, startAt: 1_234_567 };
    const a = roll(hole, s);
    assert.deepEqual(roll(hole, s), a);
    assert.deepEqual(roll(structuredClone(hole), s), a);
  }
});

test('a ball that stops where nobody can stand to putt it is moved a club length to where someone can', () => {
  const mill = HOLES[1];
  const inTunnel = { x: -56, y: 0.04, z: 43.2 };
  const tee = teeBall(mill);
  const moved = restSpot(mill, inTunnel, tee);
  assert.ok(Math.hypot(moved.x - inTunnel.x, moved.z - inTunnel.z) >= CLUB - 1e-9);
  assert.ok(!mill.keepOff!.some((k) => within(k, moved.x, moved.z)));
  assert.notEqual(heightAt(mill, moved.x, moved.z), null);
  assert.ok(moved.z < 42.1, 'back out in front of the mill, the way it came');
  // Coming back from the green, it goes back out behind.
  assert.ok(restSpot(mill, inTunnel, { x: -56, z: 46 }).z > 44.3);
  // Anywhere else stays put.
  assert.deepEqual(restSpot(mill, tee, tee), tee);
  // Under the arch on the last hole: along the lane, out from under it.
  const finale = HOLES[8];
  const under = restSpot(finale, { x: -68.8, y: 0.04, z: 69.7 }, finale.tee);
  assert.ok(Math.abs(under.x - -68.8) >= 0.5 && under.z > 69 && under.z < 70.4);
  // And a real putt that stops in the tunnel is played from there.
  let found = false;
  for (let p = 0.3; p < 0.7 && !found; p += 0.005) {
    const r = roll(mill, { from: tee, yaw: 0, power: p, startAt: 3_000_000 });
    if (!r.moved) continue;
    found = true;
    assert.ok(!mill.keepOff!.some((k) => within(k, r.rest.x, r.rest.z)));
  }
  assert.ok(found, 'some putt stops in the tunnel');
});
