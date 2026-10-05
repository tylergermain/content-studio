// Friday One as everyone but its pilot sees it. The office passes on the pilot's word of where it is
// (heli.move) a dozen times a second or so, and each page draws it smoothly between those words
// (k = 1 - exp(-10 dt)): carried on the way it was going for up to AHEAD seconds when the next word is
// late, and straight to where it's said to be when that's more than SNAP meters off (a reload, a stall,
// a pilot snapped back by the office). Its rotor spins up and down at its own pace (FLIGHT's spool
// times), not in jumps. Pure: no three.js, nothing of the page's.

import { FLIGHT, homePose } from '../../../shared/heli';
import type { HeliPose } from '../../../shared/protocol';

/** How far on (seconds) a late word carries it the way it was going. */
export const AHEAD = 0.3;
/** Further off than this (meters) and it's drawn straight where it's said to be. */
export const SNAP = 20;
/** How quickly the drawn pose closes on the said one (see step). */
const SMOOTH = 10;

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export class PoseFollower {
  /** Where it's drawn. */
  readonly pose: HeliPose = homePose();
  /** How fast it's going along the ground (m/s), as near as the words say. */
  speed = 0;
  /** How fast its rotor is drawn turning (0..1). */
  spin = 0;
  /** The last word: where it was, and when (ms, the office's clock). */
  private readonly said: HeliPose = homePose();
  private at = 0;
  /** How fast it was going between the last two words (m/s, rad/s). */
  private vx = 0;
  private vh = 0;
  private vz = 0;
  private vyaw = 0;
  /** Nothing drawn yet: the first word is where it is. */
  private fresh = true;

  /** The office's word: it was at `pose` at `at`. `still` (it's down, or parked) carries it on nowhere. */
  hear(pose: HeliPose, at: number, still: boolean) {
    const dt = (at - this.at) / 1000;
    if (!still && !this.fresh && dt > 0.01 && dt < 1) {
      const max = FLIGHT.maxSpeed;
      this.vx = clamp((pose.x - this.said.x) / dt, -max, max);
      this.vh = clamp((pose.h - this.said.h) / dt, -max, max);
      this.vz = clamp((pose.z - this.said.z) / dt, -max, max);
      this.vyaw = clamp(wrap(pose.yaw - this.said.yaw) / dt, -3, 3);
    } else this.vx = this.vh = this.vz = this.vyaw = 0;
    Object.assign(this.said, pose);
    this.at = at;
  }

  /** Each frame: draws it where it'd be by `now` (the office's clock, ms), `dt` seconds on from the last frame. */
  step(now: number, dt: number) {
    const s = this.said;
    const ahead = clamp((now - this.at) / 1000, 0, AHEAD);
    const x = s.x + this.vx * ahead;
    const h = Math.max(0, s.h + this.vh * ahead);
    const z = s.z + this.vz * ahead;
    const yaw = s.yaw + this.vyaw * ahead;
    const p = this.pose;
    const far = this.fresh || Math.hypot(x - p.x, h - p.h, z - p.z) > SNAP;
    const k = far ? 1 : 1 - Math.exp(-SMOOTH * dt);
    p.x += (x - p.x) * k;
    p.h += (h - p.h) * k;
    p.z += (z - p.z) * k;
    p.yaw = wrap(p.yaw + wrap(yaw - p.yaw) * k);
    p.pitch += (s.pitch - p.pitch) * k;
    p.roll += (s.roll - p.roll) * k;
    p.spin = this.spin;
    this.speed = Math.hypot(this.vx, this.vz);
    this.fresh = false;
  }

  /** The rotor, `dt` seconds on: toward `want` (0..1), as fast as it spools up or down. */
  spinTo(want: number, dt: number) {
    const up = dt / FLIGHT.spoolUp;
    const down = dt / FLIGHT.spoolDown;
    this.spin = want > this.spin ? Math.min(want, this.spin + up) : Math.max(want, this.spin - down);
    this.pose.spin = this.spin;
  }

  /** Straight to `pose`, nothing carried on: the pilot's own flight, handed back when they get out. */
  reset(pose: HeliPose) {
    Object.assign(this.pose, pose);
    Object.assign(this.said, pose);
    this.vx = this.vh = this.vz = this.vyaw = 0;
    this.spin = pose.spin;
    this.speed = 0;
    this.fresh = false;
  }
}
