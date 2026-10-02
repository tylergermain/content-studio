/**
 * How the things to play with behave, as plain numbers: the punching bag's swing, how hard the trampoline
 * throws you, the prize wheel running down, the high striker's meter and puck, a ping-pong rally's ball,
 * and a foosball point. Pure: no three.js and no DOM, so tests/playthings.test.ts runs it under node. The
 * toys (toys.ts, games.ts) put it on the pieces.
 */

const TAU = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// ---- The punching bag: a damped pendulum ------------------------------------------------------------

/** How far a hanging thing leans from straight down, toward +x and toward +z (radians), and how fast each is changing. */
export interface Swing {
  x: number;
  z: number;
  vx: number;
  vz: number;
}

export const BAG = {
  /** From the hook to the middle of the bag, in meters: what sets how slowly it swings. */
  length: 0.75,
  /** How quickly the swing dies away, per second. */
  damping: 1.15,
  /** How fast a punch sets it swinging, in radians a second: one swings it out about half as far as it goes. */
  kick: 1.9,
  /** As far as it leans, however hard it's hit. */
  max: 0.72,
} as const;

export const restSwing = (): Swing => ({ x: 0, z: 0, vx: 0, vz: 0 });

/** A punch that pushes the bag toward (dx, dz) (a direction on the floor, in the bag's own frame), `strength` times the usual. */
export function punchSwing(s: Swing, dx: number, dz: number, strength = 1): void {
  const len = Math.hypot(dx, dz) || 1;
  s.vx += (dx / len) * BAG.kick * strength;
  s.vz += (dz / len) * BAG.kick * strength;
}

/** One axis of the pendulum, `dt` on: gravity pulls it back, the damping slows it, and at its limit it comes back off it. */
function swingAxis(angle: number, rate: number, dt: number): [number, number] {
  rate += (-(9.81 / BAG.length) * Math.sin(angle) - BAG.damping * rate) * dt;
  angle += rate * dt;
  if (Math.abs(angle) > BAG.max) {
    angle = Math.sign(angle) * BAG.max;
    rate *= -0.35;
  }
  return [angle, rate];
}

/** Moves the swing `dt` seconds on. False once it's hanging still again (and then it's exactly at rest). */
export function stepSwing(s: Swing, dt: number): boolean {
  // Small steps, so a slow frame doesn't add energy to it.
  const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    [s.x, s.vx] = swingAxis(s.x, s.vx, h);
    [s.z, s.vz] = swingAxis(s.z, s.vz, h);
  }
  if (Math.abs(s.x) + Math.abs(s.z) < 0.004 && Math.abs(s.vx) + Math.abs(s.vz) < 0.02) {
    s.x = s.z = s.vx = s.vz = 0;
    return false;
  }
  return true;
}

/** How long (seconds) between punches still counts as the same combo. */
export const COMBO_IDLE = 2.2;

/** A run of punches: how many, and when the last one landed (seconds). */
export interface Combo {
  n: number;
  at: number;
}

/** The combo as it stands at `now`: nothing, once it's been left alone for COMBO_IDLE. */
export function comboAt(c: Combo, now: number): number {
  return now - c.at <= COMBO_IDLE ? c.n : 0;
}

/** A punch at `now`: one more on the combo, or the first of a new one. Returns the count. */
export function hitCombo(c: Combo, now: number): number {
  c.n = comboAt(c, now) + 1;
  c.at = now;
  return c.n;
}

// ---- The trampoline ---------------------------------------------------------------------------------

export const BOUNCE = {
  /** Holding Space, each bounce is this much of the trampoline's own harder than the last… */
  build: 0.14,
  /** …up to this many times it. */
  most: 1.35,
  /** Not holding it, a bigger bounce keeps this much of itself each time, until it's the trampoline's own again. */
  keep: 0.88,
  /** How long your feet are in the mat before it throws you (seconds), and how deep it gives (meters, at most). */
  contact: 0.14,
  dip: 0.2,
} as const;

/**
 * How fast a trampoline throws you back up (m/s): `bounce` is its own (KindDef.bounce), `fall` how fast
 * you came down onto it, and `held` whether you're pushing off (Space). Never less than its own, so
 * standing on it is enough to start; never more than BOUNCE.most times it, so the ceiling's safe.
 */
export function rebound(bounce: number, fall: number, held: boolean): number {
  const most = bounce * BOUNCE.most;
  if (held) return Math.min(most, Math.max(bounce, fall) + bounce * BOUNCE.build);
  return clamp(fall * BOUNCE.keep, bounce, most);
}

/** How deep the mat gives under a landing at `fall` m/s. */
export function matDip(fall: number): number {
  return clamp(0.07 + fall * 0.012, 0.07, BOUNCE.dip);
}

/** How far down your feet are, `t` seconds into the mat (0 at the start and at BOUNCE.contact, `depth` halfway). */
export function contactDip(t: number, depth: number): number {
  return depth * Math.sin(Math.PI * clamp(t / BOUNCE.contact, 0, 1));
}

/** Something on a spring: where it is from its rest, and how fast it's moving. */
export interface Spring {
  x: number;
  v: number;
}

/** Moves a damped spring `dt` on. False once it's at rest again. */
export function stepSpring(s: Spring, dt: number, stiffness = 240, damping = 9): boolean {
  const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    s.v += (-stiffness * s.x - damping * s.v) * h;
    s.x += s.v * h;
  }
  if (Math.abs(s.x) < 0.0008 && Math.abs(s.v) < 0.01) {
    s.x = s.v = 0;
    return false;
  }
  return true;
}

// ---- The dance mat ----------------------------------------------------------------------------------

export const DANCE = {
  /** From one tile's middle to the next, and half the mat (meters). */
  pitch: 0.56,
  half: 0.86,
  /** How long a tile stays lit after you step off it (seconds). */
  fade: 2.2,
} as const;

/** Which tile (0 at the back left, row by row to 8 at the front right) is under (x, z) in the mat's own frame, or -1 off it. */
export function danceTile(x: number, z: number): number {
  if (Math.abs(x) > DANCE.half || Math.abs(z) > DANCE.half) return -1;
  const col = clamp(Math.floor(x / DANCE.pitch + 1.5), 0, 2);
  const row = clamp(Math.floor(z / DANCE.pitch + 1.5), 0, 2);
  return row * 3 + col;
}

/** The note each tile plays (Hz): a pentatonic scale from middle C, so any steps make a tune. */
export function tileNote(tile: number): number {
  return 261.63 * 2 ** ([0, 2, 4, 7, 9, 12, 14, 16, 19][tile] / 12);
}

// ---- The prize wheel --------------------------------------------------------------------------------

/** How far the wheel has turned (radians, clockwise as you face it), and how fast it's turning. */
export interface Spin {
  angle: number;
  speed: number;
}

export const WHEEL = {
  /** How fast a spin starts, from a gentle one to a good one (radians a second). */
  slowest: 8,
  fastest: 13,
  /** What slows it: the air, by this much of its speed a second, and the flapper on the pegs, by this much (rad/s) a second. */
  drag: 0.5,
  brake: 0.9,
} as const;

/** How fast a spin starts: `u` (0 to 1) picks between a gentle one and a good one. */
export function spinSpeed(u: number): number {
  return WHEEL.slowest + (WHEEL.fastest - WHEEL.slowest) * clamp(u, 0, 1);
}

/** Turns the wheel `dt` on as it runs down. False once it has stopped. */
export function stepSpin(s: Spin, dt: number): boolean {
  if (s.speed <= 0) return false;
  const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
  const h = dt / steps;
  for (let i = 0; i < steps && s.speed > 0; i++) {
    s.speed = Math.max(0, s.speed - (WHEEL.drag * s.speed + WHEEL.brake) * h);
    s.angle += s.speed * h;
  }
  return s.speed > 0;
}

/**
 * Which of a wheel's `n` wedges is under the flapper at the top once it has turned `angle`: wedge i runs
 * from i/n to (i+1)/n of a turn, counter-clockwise from the top as you face it (see build_play.py), and
 * the wheel turns clockwise, so they come under the flapper in order.
 */
export function wedgeAt(angle: number, n: number): number {
  const turn = (((angle % TAU) + TAU) % TAU) / TAU;
  return Math.min(n - 1, Math.floor(turn * n));
}

/** How many pegs (one between each pair of wedges) went under the flapper as the wheel turned from `from` to `to`. */
export function pegsPassed(from: number, to: number, n: number): number {
  const seg = TAU / n;
  return Math.max(0, Math.floor(to / seg) - Math.floor(from / seg));
}

// ---- The high striker -------------------------------------------------------------------------------

export const STRIKER = {
  /** The meter runs from nothing to full and back in this long (seconds). */
  period: 1.3,
  /** Hit it with the meter this full or more and the puck reaches the bell. */
  bell: 0.92,
  /** What pulls the puck back down, in rail lengths a second squared. */
  gravity: 4.2,
} as const;

/** A meter that runs from 0 up to 1 and back down, once every `period` seconds. */
export function sweep(t: number, period: number): number {
  const p = (((t / period) % 1) + 1) % 1;
  return p < 0.5 ? p * 2 : 2 - p * 2;
}

/** The puck on its rail: how far up it is (0 at rest, 1 at the bell), and how fast it's going. */
export interface Puck {
  y: number;
  v: number;
}

/** Sends the puck up for a hit of `power` (0 to 1): it'll get that far up the rail, or with enough, into the bell. */
export function launchPuck(p: Puck, power: number): void {
  const reach = power >= STRIKER.bell ? 1.12 : clamp(power, 0.04, 1) / STRIKER.bell * 0.97;
  p.y = Math.max(p.y, 0);
  p.v = Math.sqrt(2 * STRIKER.gravity * reach);
}

/** Moves the puck `dt` on. 'bell' the moment it hits the bell (and comes back off it), 'rest' the moment it's back down. */
export function stepPuck(p: Puck, dt: number): 'bell' | 'rest' | null {
  if (p.y <= 0 && p.v <= 0) return null;
  let what: 'bell' | 'rest' | null = null;
  const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    p.v -= STRIKER.gravity * h;
    p.y += p.v * h;
    if (p.y >= 1 && p.v > 0) {
      p.y = 1;
      p.v *= -0.3;
      what = 'bell';
    } else if (p.y <= 0 && p.v < 0) {
      p.y = p.v = 0;
      return what ?? 'rest';
    }
  }
  return what;
}

/** What a hit of `power` is called. */
export function strikeName(power: number): string {
  if (power >= STRIKER.bell) return 'DING! Top of the tower';
  if (power >= 0.75) return 'So close';
  if (power >= 0.5) return 'Solid swing';
  if (power >= 0.25) return 'Warming up';
  return 'A gentle tap';
}

/** A meter as the hint bar shows it: `cells` blocks, as many of them filled as `level` (0 to 1) fills. */
export function meterBar(level: number, cells = 10): string {
  const on = clamp(Math.round(level * cells), 0, cells);
  return '▰'.repeat(on) + '▱'.repeat(cells - on);
}

// ---- A ping-pong rally ------------------------------------------------------------------------------

export const RALLY = {
  /** How long the ball takes to go out and come back (seconds): at the serve, and at its quickest. */
  first: 1.7,
  fastest: 0.85,
  /** Each return makes the next trip this much of the last one's time. */
  quicken: 0.955,
  /** How near its arrival (seconds, either side) Space returns it. */
  window: 0.19,
  /** After a swing at nothing, how long before you can swing again. */
  recover: 0.32,
  /** How high above the table the ball's hit, at either end (meters). */
  hit: 0.22,
} as const;

/** How long the ball's trip out and back takes once you've returned it `n` times. */
export function rallyTrip(n: number): number {
  return Math.max(RALLY.fastest, RALLY.first * RALLY.quicken ** n);
}

/** One way down the table, `q` from 0 (hit) to 0.5 (reaching the other end): over the net, a bounce on the far half, and up. */
function rallyArc(q: number): number {
  // Down onto the table three quarters of the way across…
  if (q < 0.375) return Math.max(0, RALLY.hit + 1.4133 * q - 5.3333 * q * q);
  // …and up off it to where it's hit.
  const up = (0.5 - q) / 0.125;
  return RALLY.hit * (1 - up * up);
}

/**
 * Where the ball is, `p` of the way through its trip (0 as you hit it, 0.5 at the far end, 1 back at
 * you, and on past you if you miss): `z` from 1 at your end to -1 at the far one, and `y` meters above
 * the table.
 */
export function rallyBall(p: number): { z: number; y: number } {
  if (p >= 1) return { z: 1 + (p - 1) * 4, y: Math.max(0, RALLY.hit - (p - 1) * 0.6) };
  const z = p < 0.5 ? 1 - 4 * p : -1 + 4 * (p - 0.5);
  return { z, y: rallyArc(p < 0.5 ? p : p - 0.5) };
}

/** Whether a swing connects, `p` of the way through a trip that takes `trip` seconds. */
export function rallyHit(p: number, trip: number): boolean {
  return Math.abs(1 - p) * trip <= RALLY.window;
}

/** Whether the ball's gone past you: too late to swing at. */
export function rallyMissed(p: number, trip: number): boolean {
  return (p - 1) * trip > RALLY.window;
}

// ---- A foosball point -------------------------------------------------------------------------------

export const FOOSBALL = {
  /** How long a point takes to play out (seconds). */
  point: 2.6,
  /** First to this many goals wins the game. */
  game: 5,
  /** Half the field: along the table to the goal line, and across it (meters). */
  halfLength: 0.63,
  halfWidth: 0.22,
} as const;

export interface FoosScore {
  you: number;
  them: number;
}

/** A goal for you or for them: the score after it, and who's won the game if that's the game. */
export function foosGoal(s: FoosScore, yours: boolean): { score: FoosScore; won: 'you' | 'them' | null } {
  const score = { you: s.you + (yours ? 1 : 0), them: s.them + (yours ? 0 : 1) };
  const won = score.you >= FOOSBALL.game ? 'you' : score.them >= FOOSBALL.game ? 'them' : null;
  return { score, won };
}

/** A small seeded generator (mulberry32), so a point plays out the same from the same seed. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A point as it plays out: where the ball is knocked to and when (x along the table, z across it), ending in a goal. */
export interface FoosPoint {
  /** Whether it's yours: you play toward the right end (+x). */
  yours: boolean;
  path: { t: number; x: number; z: number }[];
}

/** The point that `seed` plays: from the middle, knocked about between the rods, and into one goal or the other. */
export function foosPoint(seed: number): FoosPoint {
  const rnd = seeded(seed);
  const yours = rnd() < 0.55;
  const knocks = 5 + Math.floor(rnd() * 3);
  const path = [{ t: 0, x: 0, z: 0 }];
  for (let i = 1; i <= knocks; i++) {
    // Back and forth, and closer to the goal it ends in as the point goes on.
    const toward = ((yours ? 1 : -1) * i) / (knocks + 1);
    const x = clamp(toward * 0.5 + (rnd() - 0.5) * 0.7, -0.52, 0.52);
    path.push({ t: (FOOSBALL.point * i) / (knocks + 1), x, z: (rnd() - 0.5) * 2 * FOOSBALL.halfWidth });
  }
  path.push({ t: FOOSBALL.point, x: (yours ? 1 : -1) * FOOSBALL.halfLength, z: (rnd() - 0.5) * 0.12 });
  return { yours, path };
}

/** Where a point's ball is `t` seconds in: straight from each knock to the next. */
export function foosBallAt(point: FoosPoint, t: number): { x: number; z: number } {
  const path = point.path;
  if (t <= 0) return { x: path[0].x, z: path[0].z };
  for (let i = 1; i < path.length; i++) {
    if (t > path[i].t) continue;
    const a = path[i - 1];
    const b = path[i];
    const k = (t - a.t) / (b.t - a.t);
    return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k };
  }
  const end = path[path.length - 1];
  return { x: end.x, z: end.z };
}

/** How far rod `i` is turned `t` seconds into a point: the men rocking back and forth, and now and then a rod spun right round. */
export function rodTurn(i: number, t: number, seed: number): number {
  const rock = Math.sin(t * (7 + (i % 3) * 1.7) + i * 1.3 + (seed % 7)) * 0.75;
  // One rod at a time gets a flourish: a full spin over a third of a second.
  const turnOf = Math.floor(t / 0.45);
  const spinning = (turnOf * 3 + seed) % 8 === i;
  const into = (t / 0.45) % 1;
  return rock + (spinning ? Math.min(1, into / 0.75) * TAU : 0);
}
