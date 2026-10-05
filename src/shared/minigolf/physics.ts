// Putting on Putt Street's felt (see types.ts): the office rolls every putt with this, and only the
// office (server/minigolf), sending everyone the ball's path. The page draws the windmill's sails with
// millAngle, on the office's clock, so they turn in step with the ball. Pure, and the same inputs
// always give the same path.
//
// A putt is stepped STEPS times a second. On the felt the ball is pulled down the slope (g times it)
// and slowed by rolling friction, and it comes to rest under ROLL.stop where the slope's pull is no
// more than the felt can hold. Walls keep `bounce` of the speed into them and most of the speed along
// them, and bumpers give back less than all of it. A sail across the windmill's mouth shuts its tunnel
// on the office's clock. A lip throws the ball into the air, the loop is a track of its own, tunnels
// hand the ball on to where they come out, water and the felt's edge end the roll (a penalty, and
// it's played again from where it was putted), and the cup takes a ball that comes over it slowly
// enough. Nothing goes faster than ROLL.maxSpeed, and nothing comes out of the loop fast enough to
// rattle round its cell for long. The numbers are in rules.ts, and where a ball lies in lies.ts.

import { PUTT_RULES, type PuttEvent } from '../protocol/minigolf.js';
import { ready, type Ready } from './compile.js';
import { along, restSpot } from './lies.js';
import { HILL_BOUNCE, ROLL, millOpen, offBumper, puttSpeed, type Moving, type Rolled, type Stroke } from './rules.js';
import { gridAt, inside, lieAt, newLie } from './surface.js';
import { BALL_R, CUP, LOOP_WIDTH, STEPS, type Hole, type Tunnel, type XZ } from './types.js';

export * from './rules.js';
export { heightAt, restSpot, teeBall } from './lies.js';

/** How far under the street a ball going through a hill's tunnel is drawn, out of sight. */
const UNDER = -0.3;

const DT = 1 / STEPS;
/** Steps between the path's points. */
const EVERY = STEPS / PUTT_RULES.samples;
/** The most events a roll tells of (for its sounds). */
const MAX_EVENTS = 64;
const mm = (v: number) => Math.round(v * 1000) / 1000;

type Mode = 'roll' | 'air' | 'loop' | 'fall' | 'tunnel';
type End = 'rest' | 'holed' | 'water' | 'off';

/** Rolls a putt on `hole`: its path, PUTT_RULES.samples points a second from the strike, and how it ended. */
export function roll(hole: Hole, s: Stroke): Rolled {
  return new Run(ready(hole), s).go();
}

/** One putt being rolled: where the ball is, how it's going, and what's happened. */
class Run implements Moving {
  x: number;
  z: number;
  /** How high the bottom of the ball is (on the felt, the felt's height there). */
  y: number;
  vx = 0;
  vz = 0;
  vy = 0;
  mode: Mode = 'roll';
  /** Seconds since the strike. */
  t = 0;
  readonly lie = newLie();
  readonly path: number[] = [];
  readonly events: [number, PuttEvent][] = [];
  end: End | null = null;
  /** It's lipped out of the cup and hasn't left it yet (it doesn't drop on the same pass). */
  lipped = false;
  /** Round the loop: how far round (θ, 0 at the entry to 2π at the exit), how fast along it, how far right of its line it went in, and which way. */
  th = 0;
  ls = 0;
  lat = 0;
  forward = true;
  /** Whether it's fast enough to get round (it's decided at the loop's foot, by Loop.minSpeed). */
  pass = false;
  /** Falling off the loop: from where (along, right, up), how long it takes, and how long's left. */
  drop = { along: 0, right: 0, up: 0, time: 0, left: 0 };
  /** Through a tunnel: which, when it went in, how fast, and where from. */
  tube: Tunnel | null = null;
  tubeAt = 0;
  tubeSpeed = 0;
  tubeFrom = { x: 0, z: 0 };
  /** The loop's frame: forward along it and its right, and the felt's height at its foot. */
  private readonly fx: number;
  private readonly fz: number;
  private readonly rx: number;
  private readonly rz: number;
  private readonly loopY: number;

  constructor(
    readonly r: Ready,
    readonly s: Stroke,
  ) {
    this.x = s.from.x;
    this.z = s.from.z;
    this.y = lieAt(r.hole, r.felt, this.x, this.z, this.lie) ? this.lie.h : s.from.y;
    const speed = Math.min(ROLL.maxSpeed, puttSpeed(s.power));
    this.vx = Math.sin(s.yaw) * speed;
    this.vz = Math.cos(s.yaw) * speed;
    const loop = r.hole.loop;
    const yaw = loop?.yaw ?? 0;
    this.fx = Math.sin(yaw);
    this.fz = Math.cos(yaw);
    this.rx = -Math.cos(yaw);
    this.rz = Math.sin(yaw);
    const foot = newLie();
    this.loopY = loop && lieAt(r.hole, r.felt, loop.entry.x, loop.entry.z, foot) ? foot.h : 0.04;
  }

  go(): Rolled {
    this.sample();
    const steps = ROLL.maxS * STEPS;
    for (let step = 1; step <= steps && !this.end; step++) {
      this.t = step * DT;
      this[this.mode]();
      if (!this.end && step % EVERY === 0) this.sample();
    }
    return this.result();
  }

  private sample() {
    this.path.push(mm(this.x), mm(this.y), mm(this.z));
  }

  private event(kind: PuttEvent) {
    if (this.events.length < MAX_EVENTS) this.events.push([Math.round(this.t * 1000) / 1000, kind]);
  }

  private finish(end: End) {
    this.end = end;
    if (end === 'holed') this.event('cup');
    if (end === 'water') this.event('splash');
    if (end === 'off') this.event('off');
  }

  private result(): Rolled {
    const { hole, cupY } = this.r;
    const from = this.s.from;
    const base = { path: this.path, events: this.events, holed: false, out: null, moved: false };
    if (this.end === 'holed') {
      this.path.push(mm(hole.cup.x), mm(cupY - 0.06), mm(hole.cup.z));
      return { ...base, rest: { x: hole.cup.x, y: cupY, z: hole.cup.z }, holed: true };
    }
    if (this.end === 'water' || this.end === 'off') {
      this.path.push(mm(this.x), mm(this.end === 'water' ? this.y - 0.06 : this.y), mm(this.z));
      return { ...base, rest: { x: from.x, y: from.y, z: from.z }, out: this.end };
    }
    // At rest (or out of time, wherever it got to).
    this.sample();
    const at = { x: mm(this.x), y: mm(this.y), z: mm(this.z) };
    const rest = restSpot(hole, at, from);
    return { ...base, rest, moved: rest.x !== at.x || rest.z !== at.z };
  }

  // ---- On the felt ----------------------------------------------------------------------------

  roll() {
    const { hole, felt } = this.r;
    const lie = this.lie;
    const g = ROLL.g;
    this.vx -= g * lie.gx * DT;
    this.vz -= g * lie.gz * DT;
    let speed = Math.sqrt(this.vx * this.vx + this.vz * this.vz);
    const slow = ROLL.friction * DT;
    if (speed <= slow) {
      this.vx = 0;
      this.vz = 0;
      speed = 0;
    } else {
      const k = (Math.min(speed, ROLL.maxSpeed) - slow) / speed;
      this.vx *= k;
      this.vz *= k;
      speed = Math.min(speed, ROLL.maxSpeed) - slow;
    }
    if (speed < ROLL.stop && g * Math.sqrt(lie.gx * lie.gx + lie.gz * lie.gz) <= ROLL.hold) return this.finish('rest');
    const px = this.x;
    const pz = this.z;
    this.x += this.vx * DT;
    this.z += this.vz * DT;
    if (this.intoLoop(px, pz, speed)) return;
    if (this.hills(speed)) return;
    this.millMouth(px, pz);
    this.walls();
    this.bumpers();
    if (this.overLip(px, pz)) return;
    if (!lieAt(hole, felt, this.x, this.z, lie)) return this.finish(this.waterAt() === null ? 'off' : 'water');
    this.y = lie.h;
    this.cup();
  }

  /** The cup: it takes a ball over it that's slow enough; a faster one lips out, once a pass. */
  private cup() {
    const { cup } = this.r.hole;
    const dx = this.x - cup.x;
    const dz = this.z - cup.z;
    if (dx * dx + dz * dz >= CUP.take * CUP.take) {
      this.lipped = false;
      return;
    }
    if (this.lipped) return;
    if (this.vx * this.vx + this.vz * this.vz < CUP.speed * CUP.speed) return this.finish('holed');
    this.lipped = true;
    this.vx *= ROLL.lipOut;
    this.vz *= ROLL.lipOut;
    this.event('lip');
  }

  /** The walls near the ball (in the air, only those it isn't over): off any it's touching. */
  private walls() {
    const r = this.r;
    const sailDown = r.mill ? !millOpen(r.mill.m, this.s.startAt + this.t * 1000) : false;
    const near = gridAt(r.near, this.x, this.z);
    for (let k = 0; k < near.length; k++) {
      const q = r.pieces[near[k]];
      if (q.kind === 'sail' && !sailDown) continue;
      const t = along(q, this.x, this.z);
      if (this.mode === 'air' && this.y >= q.footA + (q.footB - q.footA) * t + q.height) continue;
      const qx = q.ax + q.ex * t;
      const qz = q.az + q.ez * t;
      let dx = this.x - qx;
      let dz = this.z - qz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= BALL_R * BALL_R) continue;
      let d = Math.sqrt(d2);
      if (d < 1e-9) {
        // Right on its line: out the side it was coming from.
        dx = -this.vx;
        dz = -this.vz;
        d = Math.hypot(dx, dz) || 1;
      }
      const nx = dx / d;
      const nz = dz / d;
      this.x = qx + nx * (BALL_R + 1e-6);
      this.z = qz + nz * (BALL_R + 1e-6);
      const vn = this.vx * nx + this.vz * nz;
      if (vn >= 0) continue;
      const tx = this.vx - vn * nx;
      const tz = this.vz - vn * nz;
      this.vx = tx * ROLL.along - q.bounce * vn * nx;
      this.vz = tz * ROLL.along - q.bounce * vn * nz;
      if (q.kind === 'sail') this.event('mill');
      else if (-vn > 0.25) this.event('wall');
    }
  }

  private bumpers() {
    const bumpers = this.r.bumpers;
    for (let i = 0; i < bumpers.length; i++) if (offBumper(this, bumpers[i]) > 0.1) this.event('bumper');
  }

  /** Into the windmill's tunnel through its mouth (when no sail's across it): the hollow roll through the house. */
  private millMouth(px: number, pz: number) {
    const mf = this.r.mill;
    if (!mf) return;
    const u0 = (px - mf.m.x) * mf.fx + (pz - mf.m.z) * mf.fz;
    const u1 = (this.x - mf.m.x) * mf.fx + (this.z - mf.m.z) * mf.fz;
    const w = (this.x - mf.m.x) * mf.rx + (this.z - mf.m.z) * mf.rz;
    if (u0 < -mf.half && u1 >= -mf.half && Math.abs(w) <= mf.gap) this.event('tunnel');
  }

  /** Off the edge of a patch of felt through one of its lips: into the air, rising as it was up the slope. */
  private overLip(px: number, pz: number): boolean {
    const lie = this.lie;
    const f = lie.felt >= 0 ? this.r.hole.felt[lie.felt] : undefined;
    if (!f?.lips || inside(f.poly, this.x, this.z)) return false;
    for (const i of f.lips) {
      const a = f.poly[i];
      const b = f.poly[(i + 1) % f.poly.length];
      if (!crosses(px, pz, this.x, this.z, a, b)) continue;
      this.vy = this.vx * lie.gx + this.vz * lie.gz;
      this.mode = 'air';
      return true;
    }
    return false;
  }

  /** The water the ball is over, if any: its surface's height. */
  private waterAt(): number | null {
    const water = this.r.water;
    for (let i = 0; i < water.length; i++) if (inside(water[i].poly, this.x, this.z)) return water[i].h;
    return null;
  }

  // ---- In the air -----------------------------------------------------------------------------

  air() {
    const { hole, felt } = this.r;
    this.vy -= ROLL.g * DT;
    this.x += this.vx * DT;
    this.z += this.vz * DT;
    this.y += this.vy * DT;
    this.walls();
    const water = this.waterAt();
    if (water !== null && this.y <= water) return this.finish('water');
    const lie = this.lie;
    if (lieAt(hole, felt, this.x, this.z, lie)) {
      if (this.y > lie.h) return;
      // Down on the felt: a little bounce back up, and some of its speed lost to the landing.
      this.y = lie.h;
      this.vx *= ROLL.landKeep;
      this.vz *= ROLL.landKeep;
      this.vy = -ROLL.land * this.vy;
      if (this.vy < 0.5) {
        this.vy = 0;
        this.mode = 'roll';
      }
    } else if (this.y <= 0) this.finish('off');
  }

  // ---- The loop-the-loop ----------------------------------------------------------------------

  /** Into the loop at its foot, going forward from the entry or backward from the exit. */
  private intoLoop(px: number, pz: number, speed: number): boolean {
    const loop = this.r.hole.loop;
    if (!loop) return false;
    const half = (loop.width ?? LOOP_WIDTH) / 2;
    const ex = loop.entry.x;
    const ez = loop.entry.z;
    const a0 = (px - ex) * this.fx + (pz - ez) * this.fz;
    const a1 = (this.x - ex) * this.fx + (this.z - ez) * this.fz;
    const right = (this.x - ex) * this.rx + (this.z - ez) * this.rz;
    let forward: boolean;
    if (a0 < 0 && a1 >= 0 && Math.abs(right) <= half) forward = true;
    else if (a0 > 0 && a1 <= 0 && Math.abs(right - loop.offset) <= half) forward = false;
    else return false;
    this.mode = 'loop';
    this.forward = forward;
    this.th = forward ? 0 : Math.PI * 2;
    this.ls = forward ? speed : -speed;
    // Inside the track, a ball's width from its edges, however it came at it.
    const keep = half - BALL_R;
    this.lat = Math.max(-keep, Math.min(keep, forward ? right : right - loop.offset));
    this.pass = speed >= loop.minSpeed;
    this.event('loop');
    this.placeInLoop();
    return true;
  }

  loop() {
    const loop = this.r.hole.loop!;
    const g = ROLL.g;
    this.ls += (-g * Math.sin(this.th) - ROLL.friction * Math.sign(this.ls)) * DT;
    this.th += (this.ls / loop.r) * DT;
    if (!this.pass) {
      // Too slow to get round: it comes off the track when there's nothing holding it to it, and over the top at the latest.
      const pressed = (this.ls * this.ls) / loop.r + g * Math.cos(this.th);
      const over = this.forward ? this.th >= Math.PI : this.th <= Math.PI;
      if (pressed < 0 || over) return this.peel();
      // Crept in and stopped just up the track's foot: it settles back out where it came in.
      if (Math.abs(this.ls) < ROLL.stop && 1 - Math.cos(this.th) < 0.01) return this.outOfLoop(!this.forward, 0);
    }
    // Round it, the track's way out brakes it; back out the way it came, it rolls out as it is.
    if (this.th >= Math.PI * 2) return this.outOfLoop(true, this.forward ? this.ls * ROLL.loopKeep : this.ls);
    if (this.th <= 0) return this.outOfLoop(false, this.forward ? this.ls : this.ls * ROLL.loopKeep);
    this.placeInLoop();
  }

  /** Where the ball is round the loop, for its path: up the track's inside, drifting right toward the exit. */
  private placeInLoop() {
    const loop = this.r.hole.loop!;
    const rc = loop.r - BALL_R;
    this.placeAt(rc * Math.sin(this.th), (loop.offset * this.th) / (Math.PI * 2) + this.lat, rc * (1 - Math.cos(this.th)));
  }

  /** The ball at `along` and `right` of the loop's entry, `up` over its foot. */
  private placeAt(along: number, right: number, up: number) {
    const e = this.r.hole.loop!.entry;
    this.x = e.x + this.fx * along + this.rx * right;
    this.z = e.z + this.fz * along + this.rz * right;
    this.y = this.loopY + up;
  }

  /** Off the track: it drops to the loop's foot, and then rolls out the way it came in. */
  private peel() {
    const loop = this.r.hole.loop!;
    const rc = loop.r - BALL_R;
    const up = rc * (1 - Math.cos(this.th));
    const time = Math.sqrt((2 * up) / ROLL.g);
    this.drop = { along: rc * Math.sin(this.th), right: (loop.offset * this.th) / (Math.PI * 2) + this.lat, up, time, left: time };
    this.mode = 'fall';
  }

  fall() {
    const f = this.drop;
    f.left -= DT;
    if (f.left <= 0) {
      // It lands hard and keeps a little of what the drop gave it, back the way it came.
      const speed = 0.35 * Math.sqrt(2 * ROLL.g * f.up);
      return this.outOfLoop(!this.forward, this.forward ? -speed : speed);
    }
    // Down through the loop's inside, back to its foot on the side it came in by.
    const dropped = f.time - f.left;
    const k = dropped / f.time;
    const back = this.forward ? this.lat : this.r.hole.loop!.offset + this.lat;
    this.placeAt(f.along * (1 - k), f.right + (back - f.right) * k, Math.max(0, f.up - 0.5 * ROLL.g * dropped * dropped));
  }

  /** Out of the loop at its exit (`atExit`) or back out of its entry, going `speed` along the loop's heading (negative: back). */
  private outOfLoop(atExit: boolean, speed: number) {
    const loop = this.r.hole.loop!;
    const v = Math.sign(speed) * Math.min(Math.abs(speed), ROLL.loopOut);
    const dir = atExit ? 1 : -1;
    this.placeAt(dir * 0.002, (atExit ? loop.offset : 0) + this.lat, 0);
    this.vx = this.fx * v;
    this.vz = this.fz * v;
    this.mode = 'roll';
    lieAt(this.r.hole, this.r.felt, this.x, this.z, this.lie);
    this.y = this.lie.h;
  }

  // ---- The hill and its tunnels ---------------------------------------------------------------

  /** Against a hill's foot: into a tunnel if that's a mouth (and the ball's going in), else off the grass. */
  private hills(speed: number): boolean {
    const hills = this.r.hills;
    for (let i = 0; i < hills.length; i++) {
      const h = hills[i];
      const ax = h.rx + BALL_R;
      const az = h.rz + BALL_R;
      const dx = this.x - h.x;
      const dz = this.z - h.z;
      const f = (dx / ax) ** 2 + (dz / az) ** 2;
      if (f >= 1) continue;
      let nx = dx / (ax * ax);
      let nz = dz / (az * az);
      const n = Math.hypot(nx, nz) || 1;
      nx /= n;
      nz /= n;
      const vn = this.vx * nx + this.vz * nz;
      const mouth = vn < 0 ? this.mouthAt() : undefined;
      if (mouth) {
        this.mode = 'tunnel';
        this.tube = mouth;
        this.tubeAt = this.t;
        this.tubeSpeed = speed;
        this.tubeFrom = { x: this.x, z: this.z };
        this.event('tunnel');
        this.y = UNDER;
        return true;
      }
      const k = 1 / Math.sqrt(f);
      this.x = h.x + dx * k + nx * 1e-6;
      this.z = h.z + dz * k + nz * 1e-6;
      if (vn < 0) {
        const tx = this.vx - vn * nx;
        const tz = this.vz - vn * nz;
        this.vx = tx * ROLL.along - HILL_BOUNCE * vn * nx;
        this.vz = tz * ROLL.along - HILL_BOUNCE * vn * nz;
        if (-vn > 0.25) this.event('wall');
      }
    }
    return false;
  }

  /** The tunnel whose mouth the ball is at, if any. */
  private mouthAt(): Tunnel | undefined {
    const tunnels = this.r.tunnels;
    for (let i = 0; i < tunnels.length; i++) {
      const t = tunnels[i];
      const dx = this.x - t.mouth.x;
      const dz = this.z - t.mouth.z;
      if (dx * dx + dz * dz < (t.r + BALL_R) * (t.r + BALL_R)) return t;
    }
    return undefined;
  }

  tunnel() {
    const tn = this.tube!;
    const k = (this.t - this.tubeAt) / tn.delay;
    if (k < 1) {
      // Under the hill, out of sight, on its way to the other end.
      this.x = this.tubeFrom.x + (tn.exit.x - this.tubeFrom.x) * k;
      this.z = this.tubeFrom.z + (tn.exit.z - this.tubeFrom.z) * k;
      this.y = UNDER;
      return;
    }
    const speed = Math.min(ROLL.tunnelMax, Math.max(ROLL.tunnelMin, this.tubeSpeed * ROLL.tunnelKeep));
    this.x = tn.exit.x;
    this.z = tn.exit.z;
    this.vx = Math.sin(tn.yaw) * speed;
    this.vz = Math.cos(tn.yaw) * speed;
    this.mode = 'roll';
    this.tube = null;
    this.y = lieAt(this.r.hole, this.r.felt, this.x, this.z, this.lie) ? this.lie.h : 0.04;
  }
}

/** Whether the move from (px, pz) to (x, z) crosses the edge from a to b. */
function crosses(px: number, pz: number, x: number, z: number, a: XZ, b: XZ): boolean {
  const side = (ux: number, uz: number) => (b.x - a.x) * (uz - a.z) - (b.z - a.z) * (ux - a.x);
  const s0 = side(px, pz);
  const s1 = side(x, z);
  if (s0 * s1 > 0) return false;
  const e0 = (x - px) * (a.z - pz) - (z - pz) * (a.x - px);
  const e1 = (x - px) * (b.z - pz) - (z - pz) * (b.x - px);
  return e0 * e1 <= 0;
}
