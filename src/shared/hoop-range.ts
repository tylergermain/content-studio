// Shooting from further out than the green used to show (it stopped at RANGE). Out there the green
// gets smaller the further out you are, only its middle is sure to drop in and nothing outside it does,
// and from HEAVE_FROM on a shot is a one-armed heave on a faster meter, flatter and harder (off the
// ceiling it's dead: see step in hoop.ts). It's only on where the ball has a clear way to the ring
// (clearWay). Inside RANGE nothing here comes into it: a shot goes exactly as shared/hoop.ts has it.
// The pages use this (features/basketball). A heave is told from its throw alone (heaveThrow), so the
// office passes throws on as it always has.

import { BALL, GRAVITY, HOOP, SWEET, SWEET_SLOPE, WIND_UP, backboard, hoopArms, idealSpeed, launch, step, type Solid } from './hoop.js';
import { FLOOR, SLAB, WALL_HEIGHT, WALL_T } from './layout.js';
import { rimDistance } from './longshots.js';

/**
 * As far out as the green always showed (m, along the floor from where the ball leaves your hands to
 * the middle of the ring). Inside it a shot goes exactly as it always has.
 */
export const RANGE = 16;
/**
 * From here out (m) a shot is a one-armed heave. It's where a two-handed shot runs out: under the
 * 6.8 m ceiling the arc that fits comes into the ring flatter than the 33° or so a ball needs to drop
 * in clean over the front of it, and it takes nearly everything anyone throws two-handed (BALL.maxSpeed)
 * to get there. That's about two thirds of the way down the floor, well past its middle.
 */
export const HEAVE_FROM = 22;
/** The smallest the green gets, way out (a share of the meter, as SWEET.width is). */
export const GREEN_MIN = 0.04;
/** A heave's meter runs up in this long (s), and back down: half as fast again as a shot's (WIND_UP). */
export const HEAVE_WIND_UP = 0.7;
/** How steeply a heave goes, at most (radians up from level): a flatter, longer arc than a shot's. */
export const HEAVE_PITCH = 0.6;

/**
 * How wide the green is, `dist` m out: as it always was inside RANGE, then smaller the further out you
 * are (as the ring looks), down to GREEN_MIN.
 */
export function greenWidth(dist: number): number {
  return dist <= RANGE ? SWEET.width : Math.max(GREEN_MIN, (SWEET.width * RANGE) / dist);
}

/**
 * How much of the green really drops in, round its middle, from out past RANGE. Inside it that's down
 * to physics: the ball has to come in just right, so from 15 or 16 m only 16 to 30% of the green goes
 * in (13 to 25 ms of the meter, depending where you stand). Out past it, it's this share of the green
 * (a little less than any of those, so it only gets harder from there on), and never less than `least`
 * of the meter: on a heave's faster meter that's 7 ms, as hard as it gets and still there to hit.
 */
const MAKE = { share: 0.155, least: 0.01 } as const;

/** How much of the meter round the middle of a green `width` wide drops in, from out past RANGE. */
export function makeWidth(width: number): number {
  return Math.max(MAKE.least, MAKE.share * width);
}

/** Whether a shot from `dist` m out is a heave. */
export function isHeave(dist: number): boolean {
  return dist >= HEAVE_FROM;
}

/** How long the meter takes to run up (s), for a heave or a shot. */
export function windUpTime(heave: boolean): number {
  return heave ? HEAVE_WIND_UP : WIND_UP;
}

/** Where the meter is after `runs` runs up or down it: up to 1, back down to 0, up again… (as meter in hoop.ts). */
export function meterAt(runs: number): number {
  const u = runs % 2;
  return u <= 1 ? u : 2 - u;
}

/**
 * The wind-up meter's clock: started `at` (performance.now(), ms), `runs` up or down the meter made by
 * then, and whether it's running at a heave's pace. Walking out past HEAVE_FROM mid wind-up (or back)
 * changes its pace from then on, without the meter jumping.
 */
export interface WindClock {
  at: number;
  runs: number;
  heave: boolean;
}

/** Where the meter is at `now` (ms). A clock that's never been a heave reads exactly as meter((now - at) / 1000). */
export function windMeter(c: WindClock, now: number): number {
  return meterAt(c.runs + (now - c.at) / 1000 / windUpTime(c.heave));
}

/** The clock running at a heave's pace (or a shot's) from `now`, the meter where it was. */
export function windPace(c: WindClock, now: number, heave: boolean): WindClock {
  if (heave === c.heave) return c;
  return { at: now, runs: c.runs + (now - c.at) / 1000 / windUpTime(c.heave), heave };
}

// ---- A long shot, and a heave ---------------------------------------------------------------------------

/**
 * How high the middle of the ball may go: as far under the ceiling as underCeiling (hoop.ts) keeps a
 * shot; and a heave, which only just clears it thrown as hard as anything that drops in from way out
 * goes (`skim` times the ideal speed: the middle of the green, or a little late off the glass).
 */
const UNDER = { shot: WALL_HEIGHT - BALL.r - 0.3, heave: WALL_HEIGHT - BALL.r - 0.02, skim: 1.025 } as const;

/**
 * The steepest pitch, `pitch` at most, that throws from `from` through the middle of the ring (a heave
 * if `heave`) no harder than it can go, and keeps it under the ceiling; null if none does.
 */
export function steepestUnder(from: { x: number; y: number; z: number }, pitch: number, heave: boolean): number | null {
  const top = heave ? BALL.heaveSpeed : BALL.maxSpeed;
  for (let p = Math.min(pitch, 1.4); p > 0.1; p -= 0.01) {
    const v = idealSpeed(from, p, top);
    if (v === null) continue;
    const rise = ((heave ? v * UNDER.skim : v) * Math.sin(p)) ** 2 / (2 * GRAVITY);
    if (from.y + rise <= (heave ? UNDER.heave : UNDER.shot)) return p;
  }
  return null;
}

/** What a shot meets on its way into the ring: the backboard and its arms, the floor, the wall behind the hoop and the ceiling. */
const AT_HOOP: Solid[] = [
  backboard(),
  hoopArms(),
  { ...FLOOR, bottom: -0.3, top: 0 },
  { minX: FLOOR.minX - WALL_T, maxX: FLOOR.minX, minZ: FLOOR.minZ, maxZ: FLOOR.maxZ, top: 99 },
  { ...FLOOR, bottom: WALL_HEIGHT, top: WALL_HEIGHT + SLAB },
];

type At = { x: number; y: number; z: number };

/** The throw from `from` at `speed` m/s, `heading` round and `pitch` (radians) up. */
function throwFrom(from: At, heading: number, pitch: number, speed: number) {
  const c = Math.cos(pitch);
  return { ...from, vx: Math.sin(heading) * c * speed, vy: Math.sin(pitch) * speed, vz: Math.cos(heading) * c * speed };
}

/**
 * Whether a throw from `from`, `heading` and `pitch` (radians) at `speed` m/s drops through the ring on
 * its way there, flown as every page flies it (what bounces up off the floor and back in is goesIn's).
 */
export function dropsIn(from: At, heading: number, pitch: number, speed: number): boolean {
  const s = launch(throwFrom(from, heading, pitch, speed));
  while (s.t < 6 && !s.still && !s.lost) {
    step(s, AT_HOOP);
    if (s.scored) return true;
    // Falling, and under the ring: it's missed it on the way.
    if (s.vy < 0 && s.y < HOOP.rim.y - 0.5) return false;
  }
  return false;
}

/** How long the office follows a throw (see server/shot-judge.ts): one that hasn't gone in by then missed. */
const FOLLOWED = 5;

/**
 * Whether a throw goes in at all, flown past `solids` until it does or can't any more: lying still, gone,
 * as long as the office follows one, or rolling along the floor too slowly to get back up to the ring.
 */
export function goesIn(t: At & { vx: number; vy: number; vz: number }, solids: readonly Solid[]): boolean {
  const s = launch(t);
  while (s.t < FOLLOWED && !s.still && !s.lost) {
    step(s, solids);
    if (s.scored) return true;
    if (s.y < BALL.r + 0.02 && Math.abs(s.vy) < 1 && Math.hypot(s.vx, s.vz) < 7) return false;
  }
  return false;
}

/**
 * The speeds tried around the ideal one (through the middle of the ring), as shares of it: every
 * `by`, then every `fine` round the stretch that drops in, as from way out it's only just, and its two
 * ends to within `edge`. The ball comes in too flat there to drop through the middle clean: a little
 * long goes in off the back of the ring, a little more rattles out, and more again can bank in.
 */
const TRY = { from: -0.015, to: 0.045, by: 0.001, fine: 0.0002, edge: 0.000002 } as const;
/** The last of the speeds tried every TRY.by (from 0, at TRY.from), and the ideal's. */
const COARSE = Math.round((TRY.to - TRY.from) / TRY.by);
const IDEAL = Math.round(-TRY.from / TRY.by);

/**
 * Work done a trial throw at a time: each next() flies one (see dropsIn), and the last hands back what
 * they came to. The page spreads a far shot's over the frames of a wind-up (see farShotSteps).
 */
export type Steps<T> = Generator<void, T, void>;

/** Does all of `steps` there and then. */
export function finish<T>(steps: Steps<T>): T {
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}

/** Whether a throw `share` faster than `ideal` (slower, below 0) drops in, no faster than `top`: one trial throw. */
type Trial = (share: number) => Steps<boolean>;

function trial(from: At, heading: number, pitch: number, ideal: number, top: number): Trial {
  return function* (share) {
    yield;
    const speed = ideal * (1 + share);
    return speed <= top && dropsIn(from, heading, pitch, speed);
  };
}

/** The stretches of 0…n (first and last) where `ok` holds, widest first. */
function* stretches(n: number, ok: (i: number) => Steps<boolean>): Steps<[number, number][]> {
  const out: [number, number][] = [];
  let run = -1;
  for (let i = 0; i <= n + 1; i++) {
    if (i <= n && (yield* ok(i))) {
      if (run < 0) run = i;
    } else if (run >= 0) {
      out.push([run, i - 1]);
      run = -1;
    }
  }
  return out.sort((a, b) => b[1] - b[0] - (a[1] - a[0]));
}

/** The stretch of 0…n (first and last) that `at` is in, where `ok` holds: out from `at` either way to where it doesn't. Null if it doesn't at `at`. */
function* around(n: number, at: number, ok: (i: number) => Steps<boolean>): Steps<[number, number] | null> {
  if (!(yield* ok(at))) return null;
  let a = at;
  while (a > 0 && (yield* ok(a - 1))) a--;
  let b = at;
  while (b < n && (yield* ok(b + 1))) b++;
  return [a, b];
}

/**
 * A stretch of speeds that drops in, as shares of the ideal one: `lo` to `hi`. Every one of them tried
 * dropped in: `lo` and `hi`, and every TRY.fine from `start` plus `a` of those steps to `start` plus `b`.
 * Between two of those there can still be one that rattles out (the ball comes in that flat), so a shot
 * round the middle of the green goes at the nearest of them (see tried).
 */
interface Between {
  lo: number;
  hi: number;
  start: number;
  a: number;
  b: number;
}

/** The stretch every TRY.fine from `start` plus `a` of those steps to `start` plus `b`, with its ends found to within TRY.edge: halfway out to the next step, and again. */
function* ends(goes: Trial, start: number, a: number, b: number): Steps<Between> {
  const end = function* (inside: number, outside: number): Steps<number> {
    while (Math.abs(outside - inside) > TRY.edge) {
      const half = (inside + outside) / 2;
      if (yield* goes(half)) inside = half;
      else outside = half;
    }
    return inside;
  };
  const lo = start + a * TRY.fine;
  const hi = start + b * TRY.fine;
  return { lo: yield* end(lo, lo - TRY.fine), hi: yield* end(hi, hi + TRY.fine), start, a, b };
}

/** Of the speeds in `b` that were tried and dropped in, the one nearest `share` (all as shares of the ideal). */
function tried(b: Between, share: number): number {
  const first = b.start + b.a * TRY.fine;
  const last = b.start + b.b * TRY.fine;
  if (share <= first) return share - b.lo < first - share ? b.lo : first;
  if (share >= last) return b.hi - share < share - last ? b.hi : last;
  return b.start + Math.min(b.b, Math.max(b.a, Math.round((share - b.start) / TRY.fine))) * TRY.fine;
}

/**
 * The stretch of speeds the ideal throw itself drops in with, from `from` at `heading` and `pitch` no
 * faster than `top`, so the middle of the green goes in the way the ideal does (not off the glass every
 * time); null if the ideal doesn't drop in. Out from the ideal every TRY.by, then every TRY.fine from a
 * step either side of that, and its ends to within TRY.edge.
 */
function* throughIdeal(from: At, heading: number, pitch: number, ideal: number, top: number): Steps<Between | null> {
  const goes = trial(from, heading, pitch, ideal, top);
  const coarse = yield* around(COARSE, IDEAL, (i) => goes(TRY.from + i * TRY.by));
  if (!coarse) return null;
  const [a, b] = coarse;
  const start = TRY.from + (a - 1) * TRY.by;
  const fine = yield* around(Math.round(((b - a + 2) * TRY.by) / TRY.fine), Math.round(-start / TRY.fine), (i) => goes(start + i * TRY.fine));
  return fine && (yield* ends(goes, start, fine[0], fine[1]));
}

/**
 * Where the ideal throw doesn't drop in (it rattles out), the widest stretch of speeds that does: every
 * TRY.by, then the widest few every TRY.fine from a step either side of them, and its ends to within
 * TRY.edge. Null if none tried does, or the ideal does after all (what's round it is throughIdeal's).
 */
function* widest(from: At, heading: number, pitch: number, ideal: number, top: number): Steps<Between | null> {
  const goes = trial(from, heading, pitch, ideal, top);
  const coarse = yield* stretches(COARSE, (i) => goes(TRY.from + i * TRY.by));
  if (coarse.some(([a, b]) => a <= IDEAL && IDEAL <= b)) return null;
  let best: { start: number; fine: [number, number]; lo: number; hi: number } | null = null;
  for (const [a, b] of coarse.slice(0, 3)) {
    const start = TRY.from + (a - 1) * TRY.by;
    const [fine] = yield* stretches(Math.round(((b - a + 2) * TRY.by) / TRY.fine), (i) => goes(start + i * TRY.fine));
    if (!fine) continue;
    const lo = start + fine[0] * TRY.fine;
    const hi = start + fine[1] * TRY.fine;
    if (!best || hi - lo > best.hi - best.lo) best = { start, fine, lo, hi };
  }
  return best && (yield* ends(goes, best.start, best.fine[0], best.fine[1]));
}

/** A shot at the hoop from out past RANGE, as it's wound up: which way (squared up to the ring), how steeply, how far out, how wide its green is, and whether it's a heave. */
export interface FarAim {
  heading: number;
  pitch: number;
  dist: number;
  width: number;
  heave: boolean;
}

/**
 * A shot at the hoop from `from` out past RANGE (`dist` m out), wanting to go `pitch` up: squared up to
 * the ring and as steep as that fits under the ceiling. A heave goes its own way (HEAVE_PITCH, or
 * flatter under the ceiling), however you look. Null when nothing thrown from there gets to the ring.
 * Written into `into` when it's given (the page's own, every frame of a wind-up), or else a new one.
 */
export function farAim(from: { x: number; y: number; z: number }, pitch: number, dist: number, into?: FarAim): FarAim | null {
  const heave = isHeave(dist);
  const steepest = steepestUnder(from, heave ? HEAVE_PITCH : pitch, heave);
  if (steepest === null) return null;
  const aim = into ?? { heading: 0, pitch: 0, dist: 0, width: 0, heave: false };
  aim.heading = Math.atan2(HOOP.rim.x - from.x, HOOP.rim.z - from.z);
  aim.pitch = steepest;
  aim.dist = dist;
  aim.width = greenWidth(dist);
  aim.heave = heave;
  return aim;
}

/**
 * How a far shot drops in, worked out as it's wound up (see farShotSteps): the pitch it goes at, the
 * ideal speed there (through the middle of the ring), the stretch of speeds that drops in (`mid`, give
 * or take `half`, as shares of the ideal) and the speeds in it that were tried (`sure`: null if none
 * drops in), how wide the green is, and as hard as it can go.
 */
export interface FarShot {
  pitch: number;
  ideal: number;
  mid: number;
  half: number;
  sure: Between | null;
  width: number;
  top: number;
}

/** How much flatter than its aim a far shot may go when the ideal rattles out (radians, a step at a time). */
const FLATTER = { by: 0.03, most: 0.12 } as const;

/**
 * Flies `aim` from `from` at the speeds round the ideal one, to see which drop in. Now and then the
 * ideal itself doesn't at its pitch (it rattles out), and a little flatter it may, where nothing of
 * `solids` is in the way there (see clearWay). The stretch the ideal drops in with, at the steepest
 * pitch that has one; failing that, the widest found; if none at all, the ideal. A trial throw a step
 * (see Steps): the page works one out over the frames of a wind-up, so letting go doesn't stall it.
 */
export function* farShotSteps(from: At, aim: FarAim, solids: readonly Solid[] = []): Steps<FarShot> {
  const top = aim.heave ? BALL.heaveSpeed : BALL.maxSpeed;
  const shot = (pitch: number, ideal: number, b: Between): FarShot => ({ pitch, ideal, mid: (b.lo + b.hi) / 2, half: (b.hi - b.lo) / 2, sure: b, width: aim.width, top });
  const pitches: { p: number; ideal: number }[] = [];
  for (let p = aim.pitch; p > aim.pitch - FLATTER.most - 0.01; p -= FLATTER.by) {
    const ideal = idealSpeed(from, p, top);
    if (ideal !== null && (p === aim.pitch || clearAt(from, aim, p, ideal, solids))) pitches.push({ p, ideal });
  }
  // Mostly the ideal drops in at the first pitch tried, and what's round it is all there is to fly.
  for (const { p, ideal } of pitches) {
    const between = yield* throughIdeal(from, aim.heading, p, ideal, top);
    if (between) return shot(p, ideal, between);
  }
  // Failing that, the widest stretch that drops in at any of them.
  let best: FarShot = { pitch: aim.pitch, ideal: idealSpeed(from, aim.pitch, top)!, mid: 0, half: 0, sure: null, width: aim.width, top };
  for (const { p, ideal } of pitches) {
    const between = yield* widest(from, aim.heading, p, ideal, top);
    if (between && between.hi - between.lo > best.half * 2) best = shot(p, ideal, between);
  }
  return best;
}

/** farShotSteps, all there and then. */
export function farShot(from: At, aim: FarAim, solids: readonly Solid[] = []): FarShot {
  return finish(farShotSteps(from, aim, solids));
}

/**
 * How fast a far shot goes, let go of at `power` on the meter. Round the middle of the green, as much of
 * the meter as makeWidth says, it's the stretch of speeds that drops in, the middle of it at the
 * green's, and it goes at the nearest of those speeds that was tried and dropped in (thrown from where
 * it was worked out, it goes in for sure). Either side of that it goes off as a shot either side of the
 * sweet spot always has (SWEET_SLOPE), short or long, only squeezed into the smaller green: the green
 * spans the same speeds as ever, from a little short to long enough to bank in, over less of the meter.
 */
export function farSpeed(s: FarShot, power: number): number {
  const off = power - SWEET.at;
  const edge = makeWidth(s.width) / 2;
  const inside = Math.max(-edge, Math.min(edge, off));
  const past = (off - inside) * (SWEET.width / s.width);
  let share = s.mid + (inside / edge) * s.half;
  if (past === 0 && s.sure) share = tried(s.sure, share);
  else share += past * (past < 0 ? SWEET_SLOPE.short : SWEET_SLOPE.long);
  return Math.max(0, Math.min(s.top, s.ideal * (1 + share)));
}

/** How much steeper or flatter (radians, a step at a time) a throw from outside the green goes once it's as hard, or as soft, as it can go and still drops in (see farRelease). */
const TILT = 0.01;

/**
 * How a far shot let go of at `power` goes from `from` at `heading`, as the page throws it: how steeply
 * and how fast. As farSpeed has it, except that nothing let go of outside the green drops in. From some
 * places a throw that far off still finds a way: a little long off the glass and the back of the ring,
 * short and up off the floor, or along the wall the hoop's on, up off the ceiling and back off the far
 * wall. That one goes a little further off (TRY.by of the ideal at a time) until it misses, and once
 * it's as hard as anyone throws it (or as soft), a little steeper or flatter instead; each flown past
 * `solids` (the room as the page has it) as the page and the office fly it.
 */
export function farRelease(from: At, heading: number, s: FarShot, power: number, solids: readonly Solid[]): { pitch: number; speed: number } {
  let speed = farSpeed(s, power);
  let pitch = s.pitch;
  const off = power - SWEET.at;
  if (Math.abs(off) <= s.width / 2) return { pitch, speed };
  const by = Math.sign(off) * TRY.by * s.ideal;
  let tilt = 0;
  for (let i = 0; i < 100 && goesIn(throwFrom(from, heading, pitch, speed), solids); i++) {
    const next = Math.max(0, Math.min(s.top, speed + by));
    if (next !== speed) speed = next;
    else {
      tilt++;
      pitch = s.pitch + (tilt % 2 ? 1 : -1) * Math.ceil(tilt / 2) * TILT;
    }
  }
  return { pitch, speed };
}

/**
 * Every throw the green can make at a pitch, and a little either side of it: `slow` to `fast` times the
 * ideal speed there. And how far short of the ring (m, along the floor) the way to it has to be clear,
 * past which it's the hoop's own: its backboard and the wall, which the office flies past too.
 */
const WAY = { slow: 0.97, fast: 1.06, short: 2 } as const;

/**
 * Whether a far shot `aim` from `from` has a clear way to the ring past `solids` (the room's, as the
 * page has them): nothing stands anywhere a throw of the green's might go, until it's nearly there. So
 * a long shot is only on where the ball can get to the ring, and what the office leaves out of its own
 * flight of a throw (the corner loft and the glass room under it, the elevator, the fire pole) is
 * nowhere a throw of the green's goes. From inside the room only: the office's walls are solid floor to
 * ceiling, so a throw out through a door or a window would go in on the page and miss in the office.
 */
export function clearWay(from: { x: number; y: number; z: number }, aim: FarAim, solids: readonly Solid[]): boolean {
  if (from.x <= FLOOR.minX || from.x >= FLOOR.maxX || from.z <= FLOOR.minZ || from.z >= FLOOR.maxZ) return false;
  const ideal = idealSpeed(from, aim.pitch, aim.heave ? BALL.heaveSpeed : BALL.maxSpeed);
  return ideal !== null && clearAt(from, aim, aim.pitch, ideal, solids);
}

/**
 * Whether every throw from `from` straight at the ring (as `aim` goes) at `pitch`, from WAY.slow to
 * WAY.fast times `ideal`, misses everything in `solids` until it's WAY.short from the ring. Each of
 * them goes up `tan` per meter out and falls away `drop` times the square of that, so the slowest is
 * lowest all the way along and the fastest highest. The ceiling it doesn't look at: the office has it.
 */
function clearAt(from: { x: number; y: number; z: number }, aim: FarAim, pitch: number, ideal: number, solids: readonly Solid[]): boolean {
  const tan = Math.tan(pitch);
  const cos2 = Math.cos(pitch) ** 2;
  const lowDrop = GRAVITY / (2 * (ideal * WAY.slow) ** 2 * cos2);
  const highDrop = GRAVITY / (2 * (ideal * WAY.fast) ** 2 * cos2);
  const apex = tan / (2 * highDrop);
  const ux = Math.sin(aim.heading);
  const uz = Math.cos(aim.heading);
  const r = BALL.r;
  for (const c of solids) {
    if ((c.bottom ?? 0) >= WALL_HEIGHT - 0.01) continue;
    // Where along the way (m from the hands) it passes over the solid, give or take the ball.
    let s0 = 0;
    let s1 = aim.dist - WAY.short;
    if (Math.abs(ux) < 1e-9) {
      if (from.x < c.minX - r || from.x > c.maxX + r) continue;
    } else {
      const a = (c.minX - r - from.x) / ux;
      const b = (c.maxX + r - from.x) / ux;
      s0 = Math.max(s0, Math.min(a, b));
      s1 = Math.min(s1, Math.max(a, b));
    }
    if (Math.abs(uz) < 1e-9) {
      if (from.z < c.minZ - r || from.z > c.maxZ + r) continue;
    } else {
      const a = (c.minZ - r - from.z) / uz;
      const b = (c.maxZ + r - from.z) / uz;
      s0 = Math.max(s0, Math.min(a, b));
      s1 = Math.min(s1, Math.max(a, b));
    }
    if (s0 > s1) continue;
    // Arcs both: the lowest is lowest at an end of that, the highest highest at its top (or the end nearer it).
    const under = from.y + Math.min(tan * s0 - lowDrop * s0 * s0, tan * s1 - lowDrop * s1 * s1);
    const peak = Math.min(Math.max(apex, s0), s1);
    const over = from.y + tan * peak - highDrop * peak * peak;
    if (under < c.top + r && over > (c.bottom ?? 0) - r) return false;
  }
  return true;
}

/**
 * Whether a throw (anyone's, as the office passes it on) was a heave: from HEAVE_FROM out or further,
 * straight at the ring, as only a heave is squared up to it (a toss goes the way someone faces).
 */
export function heaveThrow(s: { x: number; z: number; vx: number; vz: number }): boolean {
  const dist = rimDistance(s);
  const along = Math.hypot(s.vx, s.vz);
  if (!isHeave(dist) || along < 1) return false;
  const toward = ((HOOP.rim.x - s.x) * s.vx + (HOOP.rim.z - s.z) * s.vz) / (dist * along);
  return toward > Math.cos(0.01);
}
