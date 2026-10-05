import test from 'node:test';
import assert from 'node:assert/strict';
import { HOLES } from '../src/shared/minigolf/course.js';
import { heightAt, millAngle, millOpen, roll, teeBall } from '../src/shared/minigolf/physics.js';
import { BALL_R, PUTT_METER, STANCE, type Hole } from '../src/shared/minigolf/types.js';
import type { PuttPlayer, PuttRound, ServerMsg } from '../src/shared/protocol.js';

// Putt Street on the page (client/features/minigolf and client/world/minigolf): the putting meter,
// playing a path back, whose ball is out and where you stand to it, the scorecard's sums, and that
// what's drawn (the windmill's sails, the loop's track) is where the office's physics has things.

// The store keeps the floor you're on in localStorage: stand it in before the store's module makes the store.
const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, String(v)), removeItem: (k: string) => void storage.delete(k) },
});

const play = await import('../src/client/features/minigolf/play.js');
const { meterAt, pathAt, headingAt, rollSeconds, stanceAt, ballOf, totalOf, toPar, parText, scoreName, highlights, clockText, distText, nth, feltAt, yawTo } = play;
const { inMill, followClear, aimClear, MILL_OVER } = await import('../src/client/features/minigolf/clear.js');

const at = () => ({ x: 0, y: 0, z: 0 });
const PARS = HOLES.map((h) => h.par);

test("the meter has golf's shape: up to full in PUTT_METER.up, back down in as long, and round again", () => {
  const up = PUTT_METER.up;
  assert.equal(meterAt(0), 0);
  assert.equal(meterAt(-1), 0);
  assert.ok(Math.abs(meterAt(up) - 1) < 1e-9);
  assert.ok(Math.abs(meterAt(up / 2) - 0.5) < 1e-9);
  assert.ok(Math.abs(meterAt(up * 1.5) - 0.5) < 1e-9, 'halfway back down');
  assert.ok(meterAt(up * 2) < 1e-9, 'empty again');
  assert.ok(Math.abs(meterAt(up * 2.25) - 0.25) < 1e-9, 'and on up');
  for (let t = 0; t < up * 6; t += 0.013) assert.ok(meterAt(t) >= 0 && meterAt(t) <= 1);
});

/** A level lane 0.8 m wide and 12 long, its cup 3 m from the tee: for timing the meter on a straight putt. */
function lane(dist: number): Hole {
  const poly = [
    { x: -0.4, z: -1 },
    { x: 0.4, z: -1 },
    { x: 0.4, z: 11 },
    { x: -0.4, z: 11 },
  ];
  return { n: 1, name: 'Lab', par: 2, cell: { x: 0, z: 5 }, tee: { x: 0, z: 0 }, cup: { x: 0, z: dist }, felt: [{ poly, h: 0.04 }], walls: [] };
}

test('the page’s meter gives a straight 3 m putt at least 120 ms of holding Space to drop it', () => {
  const hole = lane(3);
  const from = teeBall(hole);
  // How long Space is held, in ms, for each putt that drops: one long run of them.
  const holed: number[] = [];
  for (let ms = 1; ms <= PUTT_METER.up * 1000; ms++) {
    const power = meterAt(ms / 1000);
    if (roll(hole, { from, yaw: 0, power, startAt: 0 }).holed) holed.push(ms);
  }
  assert.ok(holed.length > 0, 'something drops');
  const window = holed[holed.length - 1] - holed[0] + 1;
  assert.equal(window, holed.length, 'one unbroken stretch of the meter');
  assert.ok(window >= 120, `the window is ${window} ms`);
});

test('a path plays back eased between its points, from its first before the strike to its last after it', () => {
  // Three points a 30th of a second apart, 10 cm each.
  const path = [0, 0.04, 0, 0, 0.04, 0.1, 0, 0.04, 0.2];
  assert.equal(rollSeconds(path), 2 / 30);
  assert.deepEqual(pathAt(path, -1, at()), { x: 0, y: 0.04, z: 0 });
  const mid = pathAt(path, 0.5 / 30, at());
  assert.ok(Math.abs(mid.z - 0.05) < 1e-9);
  assert.ok(Math.abs(pathAt(path, 1.5 / 30, at()).z - 0.15) < 1e-9);
  assert.deepEqual(pathAt(path, 5, at()), { x: 0, y: 0.04, z: 0.2 });
  assert.deepEqual(pathAt([], 1, at()), { x: 0, y: 0, z: 0 }, 'nothing to play: left where it was');
});

test('a ball handed on (out of a tunnel, a club length off) jumps there rather than sliding through the hill', () => {
  const path = [0, 0, 0, 0, -0.3, 0, 3, 0.04, 2];
  // Down into the tunnel is eased (it's close)…
  assert.ok(Math.abs(pathAt(path, 0.5 / 30, at()).y + 0.15) < 1e-9);
  // …but out at the far end isn't: it stays in until the next point, then it's there.
  const p = pathAt(path, 1.6 / 30, at());
  assert.deepEqual(p, { x: 0, y: -0.3, z: 0 });
  assert.deepEqual(pathAt(path, 2 / 30, at()), { x: 3, y: 0.04, z: 2 });
});

test('the camera follows the way the ball is going, and knows when it isn’t', () => {
  const east = [0, 0, 0, 0.1, 0, 0, 0.2, 0, 0, 0.3, 0, 0];
  assert.ok(Math.abs((headingAt(east, 3 / 30) ?? 0) - Math.PI / 2) < 1e-9);
  const south = [0, 0, 0, 0, 0, 0.1, 0, 0, 0.2];
  assert.ok(Math.abs(headingAt(south, 2 / 30) ?? 1) < 1e-9);
  assert.equal(headingAt([1, 0, 1, 1, 0, 1, 1, 0, 1], 1 / 30), null, 'still');
});

/**
 * The putting camera following a putt on `hole` as controller.ts has it (3 m behind the ball the way
 * it's going, 0.55 m to the side, 2 m up, easing there at 4 a second, 60 frames a second, clear.ts by
 * the windmill), from behind the tee: where it is each frame, and the ball.
 */
function follow(hole: Hole, path: ArrayLike<number>, yaw: number) {
  const ball = at();
  pathAt(path, 0, ball);
  const cam = { x: ball.x - Math.sin(yaw) * 3 - Math.cos(yaw) * 0.55, y: ball.y + 2, z: ball.z - Math.cos(yaw) * 3 + Math.sin(yaw) * 0.55 };
  const want = at();
  let heading = yaw;
  const frames: { cam: { x: number; y: number; z: number }; ball: { x: number; y: number; z: number } }[] = [];
  for (let t = 0; t <= rollSeconds(path) + 1; t += 1 / 60) {
    pathAt(path, t, ball);
    heading = headingAt(path, t) ?? heading;
    want.x = ball.x - Math.sin(heading) * 3 - Math.cos(heading) * 0.55;
    want.y = ball.y + 2;
    want.z = ball.z - Math.cos(heading) * 3 + Math.sin(heading) * 0.55;
    followClear(hole, ball, cam, want);
    const k = 1 - Math.exp(-4 / 60);
    cam.x += (want.x - cam.x) * k;
    cam.y += (want.y - cam.y) * k;
    cam.z += (want.z - cam.z) * k;
    frames.push({ cam: { ...cam }, ball: { ...ball } });
  }
  return frames;
}

/** Whether a camera at `c` is inside the windmill's house or the disc its sails sweep across its front. */
function inMillItself(hole: Hole, c: { x: number; y: number; z: number }): boolean {
  const m = hole.mill!;
  const half = m.base / 2;
  const house = Math.abs(c.x - m.x) < half && Math.abs(c.z - m.z) < half && c.y < m.height + 0.1;
  // The sails turn on the front toward the tee (-z), 0.08 m out from the house, 2.22 m round a hub 2.32 m up.
  const sails = Math.abs(c.z - (m.z - half - 0.08)) < 0.15 && Math.hypot(c.x - m.x, c.y - 2.32) < 2.3;
  return house || sails;
}

test('following a putt through the windmill, the camera goes up over its house and sails, never into them', () => {
  const hole = HOLES[1];
  const m = hole.mill!;
  const r = roll(hole, { from: teeBall(hole), yaw: -0.0506, power: 0.726, startAt: 1_000_000 });
  assert.ok(r.holed, 'the putt goes through the windmill and drops');
  const frames = follow(hole, r.path, -0.0506);
  for (const f of frames) assert.ok(!inMillItself(hole, f.cam), `the camera's in the windmill at ${JSON.stringify(f.cam)}`);
  // It did go up over the mill once the ball was through, and back down after it.
  assert.ok(frames.some((f) => f.cam.y > m.height + MILL_OVER - 0.5 && Math.abs(f.cam.z - m.z) < m.base), 'it goes over the mill');
  // Nowhere near a windmill, it's left where it would be.
  const want = { x: HOLES[0].cup.x, y: 2, z: HOLES[0].cup.z };
  followClear(HOLES[0], HOLES[0].cup, { x: 0, y: 0, z: 0 }, want);
  assert.deepEqual(want, { x: HOLES[0].cup.x, y: 2, z: HOLES[0].cup.z });
});

test('a putt a sail knocks back is watched from the tee’s side of the windmill, not from inside it or behind it', () => {
  const hole = HOLES[1];
  const m = hole.mill!;
  // A firm straight putt, struck while the mouth is shut: the sail sends it back toward the tee.
  let r: ReturnType<typeof roll> | null = null;
  for (let startAt = 1_000_000; startAt < 1_004_000 && !r; startAt += 25) {
    const tried = roll(hole, { from: teeBall(hole), yaw: 0, power: 0.7, startAt });
    if (!tried.holed && !tried.out && tried.rest.z < m.z - m.base / 2) r = tried;
  }
  assert.ok(r, 'some putt is knocked back');
  for (const f of follow(hole, r.path, 0)) {
    assert.ok(!inMillItself(hole, f.cam), `the camera's in the windmill at ${JSON.stringify(f.cam)}`);
    assert.ok(f.cam.z < m.z, 'the camera stays on the tee’s side of the mill');
  }
});

test('aiming from just behind the windmill, the camera looks down on the ball rather than from in the house', () => {
  const hole = HOLES[1];
  const m = hole.mill!;
  const ball = { x: m.x, y: 0.09, z: m.z + m.base / 2 + 0.4 };
  const aim = yawTo(ball, hole.cup);
  const want = { x: ball.x - Math.sin(aim) * 2.6, y: ball.y + 1.4, z: ball.z - Math.cos(aim) * 2.6 };
  assert.ok(inMill(hole, want.x, want.z, want.y), 'behind the ball along the line is in the house');
  aimClear(hole, ball, aim, want);
  assert.ok(!inMillItself(hole, want), 'out of the house');
  assert.ok(Math.hypot(want.x - ball.x, want.z - ball.z) < 0.5 && want.y > ball.y + 3, 'over the ball, looking down on it');
  // Out on the felt, the camera stands where it would.
  const open = { x: hole.tee.x, y: 1.4, z: hole.tee.z - 2.6 };
  aimClear(hole, { x: hole.tee.x, y: 0.09, z: hole.tee.z }, 0, open);
  assert.deepEqual(open, { x: hole.tee.x, y: 1.4, z: hole.tee.z - 2.6 });
});

test('you stand side on to the ball, STANCE from it, the hole on your left and facing the ball', () => {
  for (const yaw of [0, 0.7, Math.PI / 2, -2.4, Math.PI]) {
    const ball = { x: 3, z: -2 };
    const s = stanceAt(ball, yaw);
    assert.ok(Math.abs(Math.hypot(s.x - ball.x, s.z - ball.z) - STANCE) < 1e-9);
    // Square to the line…
    const along = (s.x - ball.x) * Math.sin(yaw) + (s.z - ball.z) * Math.cos(yaw);
    assert.ok(Math.abs(along) < 1e-9);
    // …facing the ball, so the way the putt goes (+x for the Person) is the line.
    assert.ok(Math.abs(Math.sin(s.facing) * (ball.x - s.x) + Math.cos(s.facing) * (ball.z - s.z) - STANCE) < 1e-9);
    assert.ok(Math.abs(Math.cos(s.facing) * Math.sin(yaw) - Math.sin(s.facing) * Math.cos(yaw) - 1) < 1e-9);
  }
  assert.ok(Math.abs(yawTo({ x: 0, z: 0 }, { x: 1, z: 0 }) - Math.PI / 2) < 1e-12);
});

const player = (id: string, extra: Partial<PuttPlayer> = {}): PuttPlayer => ({ id, name: id, color: '#fff', strokes: Array(9).fill(null), ball: null, taken: 0, ...extra });
const round = (players: PuttPlayer[], extra: Partial<PuttRound> = {}): PuttRound => ({ id: 'r', stage: 'playing', hole: 0, turn: 0, players, starter: players[0].id, since: 0, until: 0, ...extra });

test('whose ball is out: the one up has theirs on the tee or where it lies, the rest have theirs in hand', () => {
  const tee = teeBall(HOLES[0]);
  const a = player('a');
  const b = player('b');
  assert.deepEqual(ballOf(round([a, b]), a, tee), tee, 'up, and not putted yet: on the tee');
  assert.equal(ballOf(round([a, b]), b, tee), null, 'not up yet: in hand');
  const lies = { x: -43, y: 0.04, z: 43 };
  const putted = player('a', { ball: lies, taken: 1 });
  assert.deepEqual(ballOf(round([putted, b]), putted, tee), lies);
  assert.deepEqual(ballOf(round([putted, b], { turn: 1 }), putted, tee), lies, 'putted, and someone else up: still out there');
  const holed = player('a', { strokes: [2, null, null, null, null, null, null, null, null], taken: 2 });
  assert.equal(ballOf(round([holed, b], { turn: 1 }), holed, tee), null, 'holed out');
  assert.equal(ballOf(round([a, b], { stage: 'forming' }), a, tee), null, 'not teed off yet');
});

test('the card adds up: totals, against par, and what each score is called', () => {
  const p = player('a', { strokes: [1, 3, 2, 2, 4, null, null, null, null] });
  assert.equal(totalOf(p), 12);
  assert.equal(toPar(p, PARS), 12 - (2 + 3 + 3 + 2 + 3));
  assert.equal(parText(0), 'E');
  assert.equal(parText(2), '+2');
  assert.equal(parText(-1), '−1');
  assert.deepEqual(
    [1, 2, 3, 4, 5, 9].map((s) => scoreName(s, 3)),
    ['Hole in one', 'Birdie', 'Par', 'Bogey', 'Double bogey', '+6'],
  );
  assert.equal(scoreName(2, 4), 'Eagle');
  assert.deepEqual(highlights(p, PARS), [
    { name: 'Hole in one', holes: [1] },
    { name: 'Birdie', holes: [3] },
  ]);
  assert.deepEqual([clockText(42_000), clockText(90_000), clockText(-5)], ['0:42', '1:30', '0:00']);
  assert.deepEqual([distText(0.4), distText(3.44)], ['40 cm', '3.4 m']);
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22].map(nth), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd']);
});

test('the felt the page stands you on is the office’s', () => {
  for (const hole of HOLES)
    for (let i = 0; i < 200; i++) {
      const x = hole.cell.x - 5 + ((i * 7.31) % 10);
      const z = hole.cell.z - 5 + ((i * 3.77) % 10);
      assert.equal(feltAt(hole, x, z), heightAt(hole, x, z), `hole ${hole.n} at ${x}, ${z}`);
    }
});

test('the windmill’s sails are drawn across the mouth exactly while the office has it shut', async () => {
  const { shutMiddle } = await import('../src/client/world/minigolf/windmill.js');
  const mill = HOLES.find((h) => h.mill)!.mill!;
  const each = (Math.PI * 2) / mill.blades;
  const offset = shutMiddle(mill);
  for (let ms = 0; ms < mill.period * 1000; ms += 7) {
    // The drawn sail nearest straight down (see buildMill: turned millAngle - offset), how far off it it is.
    const drawn = millAngle(mill, ms) - offset;
    const off = Math.abs(((drawn % each) + each * 1.5) % each - each / 2);
    const shut = !millOpen(mill, ms);
    // A sail within half the shut stretch of straight down is across the mouth (a step either side for the sampling).
    if (off < (mill.shut * each) / 2 - 0.01) assert.ok(shut, `at ${ms} ms a sail's ${off} off straight down, but the mouth is open`);
    if (off > (mill.shut * each) / 2 + 0.01) assert.ok(!shut, `at ${ms} ms no sail is near the mouth, but it's shut`);
  }
});

test('the loop is drawn where the ball goes round it', async () => {
  const THREE = await import('three');
  const { loopPoint } = await import('../src/client/world/minigolf/loop.js');
  const hole = HOLES.find((h) => h.loop)!;
  const loop = hole.loop!;
  const base = heightAt(hole, loop.entry.x, loop.entry.z)!;
  // Hard enough to go round, from the tee straight at it.
  const rolled = roll(hole, { from: teeBall(hole), yaw: loop.yaw, power: 0.97, startAt: 0 });
  const up: number[] = [];
  for (let i = 0; i < rolled.path.length; i += 3) if (rolled.path[i + 1] > base + 0.03) up.push(i);
  assert.ok(up.length > 5, 'it went round');
  // The loop's frame: along its heading, to its right, and up.
  const frame = (x: number, z: number) => ({ along: (x - loop.entry.x) * Math.sin(loop.yaw) + (z - loop.entry.z) * Math.cos(loop.yaw), right: -(x - loop.entry.x) * Math.cos(loop.yaw) + (z - loop.entry.z) * Math.sin(loop.yaw) });
  // The drawn circle's middle: halfway round, the drawn ball is at the top, its radius above it.
  const centre = loopPoint(loop, base, 0.5, new THREE.Vector3()).y - (loop.r - BALL_R);
  for (const i of up) {
    const [x, y, z] = [rolled.path[i], rolled.path[i + 1] + BALL_R, rolled.path[i + 2]];
    const ball = frame(x, z);
    // How far round the office has it, and where the drawing has the ball that far round…
    const a = Math.atan2(ball.along, centre - y);
    const u = (a < 0 ? a + Math.PI * 2 : a) / (Math.PI * 2);
    const drawn = loopPoint(loop, base, u, new THREE.Vector3());
    const d = frame(drawn.x, drawn.z);
    assert.ok(Math.hypot(d.along - ball.along, drawn.y - y) < 0.004, `point ${i / 3} is off the drawn circle`);
    // …and between the drawn rails there.
    assert.ok(Math.abs(ball.right - d.right) <= (loop.width ?? 0.5) / 2 + 0.01, `point ${i / 3} is outside the track`);
  }
});

test('a scorecard doesn’t give a putt away: while it rolls, the round is shown as it was when it was struck', async () => {
  let clock = 1000;
  Object.defineProperty(performance, 'now', { configurable: true, writable: true, value: () => (clock += 10) });
  const { store } = await import('../src/client/state/index.js');
  const { shownRound } = await import('../src/client/features/minigolf/shown.js');
  const msg = (m: object) => m as ServerMsg;
  const before = round([player('p-a')]);
  store.apply(msg({ t: 'putt', rounds: [before] }));
  const path = Array.from({ length: 31 }, (_, i) => [0, 0.04, i * 0.05]).flat();
  store.apply(msg({ t: 'putt.rolled', round: 'r', id: 'p-a', hole: 0, path, events: [], startAt: 50_000, power: 0.3, rest: { x: 0, y: 0.04, z: 1.5 }, holed: true, out: null, taken: 1 }));
  const after = round([player('p-a', { strokes: [1, null, null, null, null, null, null, null, null], taken: 1 })]);
  store.apply(msg({ t: 'putt', rounds: [after] }));
  const live = store.puttRounds[0];
  assert.deepEqual(shownRound(live, 50_500), before, 'rolling: as it was');
  assert.equal(shownRound(live, 50_000 + 1000 + 1300), live, 'stopped: as it is');
  assert.equal(shownRound(undefined, 0), undefined);
});

test('the putter’s blade is down at the ball, STANCE in front of your feet, and the driver is where it was', async () => {
  const THREE = await import('three');
  const { clubSwing, swingStep } = await import('../src/client/world/character/person-golf.js');
  /** Where club `club`'s head is at address, from the feet of someone facing +z. */
  const headAt = (club: 'driver' | 'putter') => {
    const swing = clubSwing(club);
    const rig = { root: new THREE.Group(), body: new THREE.Group(), head: new THREE.Group(), armL: new THREE.Object3D(), armR: new THREE.Object3D(), legL: new THREE.Object3D(), legR: new THREE.Object3D() };
    rig.body.add(swing);
    swingStep(rig, { swing, club, back: 0, want: 0, top: 0, swingT: -1, autoT: -1, power: 0 }, 1 / 60);
    rig.body.updateMatrixWorld(true);
    const shaft = swing.children[0];
    return shaft.children[shaft.children.length - 1].getWorldPosition(new THREE.Vector3());
  };
  const putter = headAt('putter');
  assert.ok(Math.abs(putter.z - STANCE) < 0.03, `the blade is ${putter.z.toFixed(3)} m out`);
  assert.ok(Math.abs(putter.y - BALL_R) < 0.03, `the blade is ${putter.y.toFixed(3)} m up`);
  // golf's tee (features/golf/tee.ts) has the ball 0.57 m out, on the ground.
  const driver = headAt('driver');
  assert.ok(Math.abs(driver.z - 0.57) < 0.03 && driver.y < 0.08, `the driver's head is at ${driver.toArray().map((v) => v.toFixed(3))}`);
});

// The boards and the name cards are painted on canvases, which is all they need of a page.
const painted: string[] = [];
const ctx2d = new Proxy({} as Record<string | symbol, unknown>, {
  get: (_, k) => {
    if (k === 'measureText') return (s: string) => ({ width: s.length * 10 });
    if (k === 'fillText') return (s: string) => void painted.push(s);
    if (k === 'createLinearGradient') return () => ({ addColorStop() {} });
    return () => {};
  },
  set: () => true,
});
(globalThis as { document?: unknown }).document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }) };

test('the record board lists the newest holes in one, newest first, as the office keeps them', async () => {
  const { paintRecords } = await import('../src/client/world/minigolf/boards.js');
  // Thirty aces, newest first (records.ts), all today.
  const aces = Array.from({ length: 30 }, (_, i) => ({ name: `Ace${i}`, hole: i % 9, at: 1_000_000 - i * 1000 }));
  painted.length = 0;
  paintRecords(ctx2d as unknown as CanvasRenderingContext2D, 1024, 768, { record: null, best: Array(9).fill(null), aces, rounds: [] }, 1_000_000);
  const listed = painted.filter((s) => s.startsWith('Ace')).map((s) => s.split(' ')[0]);
  assert.ok(listed.length > 3 && listed.length < aces.length, `${listed.length} of them listed`);
  assert.deepEqual(listed, aces.slice(0, listed.length).map((a) => a.name));
});

test('a name card over a ball is kept while its player is in a round, and let go of once they are in none', async () => {
  const THREE = await import('three');
  const { PuttBalls } = await import('../src/client/features/minigolf/balls.js');
  const balls = new PuttBalls();
  const cards = () => balls.group.children.filter((o): o is InstanceType<typeof THREE.Sprite> => o instanceof THREE.Sprite);
  const kept = () => (balls as unknown as { labels: Map<string, unknown> }).labels.size;
  const disposed: string[] = [];
  const watch = (who: string) => cards()[0].material.addEventListener('dispose', () => void disposed.push(who));
  const a = player('p-a');
  const b = player('p-b');
  // A is up: their name's over their ball on the tee.
  balls.update(0, [round([a, b])], new Map());
  watch('a');
  // B's turn: B's name goes up, and A's card is kept for their next turn.
  balls.update(0, [round([a, b], { turn: 1 })], new Map());
  watch('b');
  assert.deepEqual([cards().length, kept(), disposed], [1, 2, []]);
  // The round's gone: both let go of.
  balls.update(0, [], new Map());
  assert.deepEqual([cards().length, kept(), disposed.sort()], [0, 0, ['a', 'b']]);
});
