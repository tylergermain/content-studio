// At Friday One's controls: the pilot's page flies it (shared/heli.ts `fly`) at FLIGHT.step, a fixed
// step whatever the frame rate, and draws it between its last two steps so it glides on a fast screen
// too. It tells the office where it is every SEND_EVERY ms while it flies (and how fast its rotor turns
// while it spins up on the ground), and straight away on touching down or lifting off. The office checks every pose (server/heli) and snaps it back to the last one it
// took when it won't take one; a landing it refused there (someone underneath on another floor, say)
// isn't tried again there for a while. Pure: no three.js, nothing of the page's.

import { FLIGHT, fly, homePose, type Flight, type Flown, type FlyWorld, type HeliInput } from '../../../shared/heli';
import type { HeliPose } from '../../../shared/protocol';

/** How often the office hears where it is while it flies (ms), at most: as a car's driver does. */
export const SEND_EVERY = 66;
/** The most steps one frame takes (after a stall it carries on from there rather than racing to catch up). */
const MAX_STEPS = 8;
/** A landing the office refused isn't tried again for this long (ms), within this far (m) of there. */
export const REFUSED = { for: 8000, within: 6 } as const;
/** Hitting something faster than this (m/s) thunks and shakes the view. */
export const BUMP = 8;

export interface PilotHooks {
  /** Tells the office where it is now, and (`landed`) that it's down there. */
  send(pose: HeliPose, landed: boolean): void;
  /** It hit something at `speed` m/s (faster than BUMP). */
  bump(speed: number): void;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class Pilot {
  /** Your flight: where it is after the last step, how fast it's going, and whether it's down. */
  readonly flight: Flight = { pose: homePose(), vx: 0, vz: 0, vh: 0, landed: true };
  /** Where it's drawn: between the last two steps, by how far into the next one this frame is. */
  readonly drawn: HeliPose = homePose();
  active = false;
  /** The engine: on from the first Space after you get in (it spools up on the ground) until you get out. */
  engine = false;
  /** Why it won't set down where it is now, if it won't (it holds a hover there: see LAND_HOLD in shared/heli.ts). */
  why: string | null = null;
  /** At the edge of town (GROUNDS from the tower), being drawn back in. */
  edge = false;
  /** The landing the office last refused: why, where, and until when it's not tried there again. */
  refused: { why: string; x: number; z: number; until: number } | null = null;
  private readonly before: HeliPose = homePose();
  /** Seconds into the next step. */
  private acc = 0;
  /** What the office was told last, and when (ms). */
  private readonly sent: HeliPose = homePose();
  private sentLanded = true;
  private sentAt = -Infinity;
  /** What each step did (fly's), kept so a step makes nothing new. */
  private readonly out: Flown = { bump: 0, touchdown: false, liftoff: false, refused: null, edge: false };

  constructor(private readonly hooks: PilotHooks) {}

  /** At the controls of it where it is (`pose`, down if `landed`): its rotor turning as it is. */
  start(pose: HeliPose, landed: boolean) {
    this.active = true;
    const f = this.flight;
    Object.assign(f.pose, pose);
    f.vx = f.vz = f.vh = 0;
    f.landed = landed;
    Object.assign(this.before, pose);
    Object.assign(this.drawn, pose);
    Object.assign(this.sent, pose);
    this.sentLanded = landed;
    this.sentAt = -Infinity;
    this.acc = 0;
    // Still turning from a minute ago: the engine's running.
    this.engine = pose.spin > 0.3;
    this.why = null;
  }

  stop() {
    this.active = false;
    this.engine = false;
    this.why = null;
    this.edge = false;
  }

  /** Each frame at the controls: `dt` seconds of flying with `input` held in `world`, at `now` (ms). */
  update(dt: number, input: HeliInput, world: FlyWorld, now: number) {
    const f = this.flight;
    if (input.lift > 0) this.engine = true;
    input.engine = this.engine;
    this.acc = Math.min(this.acc + dt, FLIGHT.step * MAX_STEPS);
    let changed = false;
    let bump = 0;
    while (this.acc >= FLIGHT.step) {
      this.acc -= FLIGHT.step;
      Object.assign(this.before, f.pose);
      const wasDown = f.landed;
      const out = fly(f, input, FLIGHT.step, world, this.out);
      bump = Math.max(bump, out.bump);
      this.why = out.refused;
      this.edge = !!out.edge;
      if (f.landed !== wasDown) changed = true;
    }
    this.between(this.acc / FLIGHT.step);
    if (bump > BUMP) this.hooks.bump(bump);
    // Down or up: the office hears at once. Otherwise every so often, when there's something new to say:
    // where it's flying to, or on the ground, its rotor spinning up (the office passes that on too).
    if (changed || f.landed !== this.sentLanded) this.tell(now);
    else if (now - this.sentAt >= SEND_EVERY && this.moved()) this.tell(now);
  }

  /**
   * The office wouldn't take where it was said to be (or a landing there), and says where it was last
   * good: back there, still, in the air unless `landed`. Returns whether it was a landing refused.
   */
  snap(pose: HeliPose, landed: boolean, why: string, now: number): boolean {
    const landing = this.sentLanded && !landed;
    const f = this.flight;
    Object.assign(f.pose, pose);
    f.vx = f.vz = f.vh = 0;
    f.landed = landed;
    Object.assign(this.before, pose);
    Object.assign(this.drawn, pose);
    Object.assign(this.sent, pose);
    this.sentLanded = landed;
    this.acc = 0;
    if (landing) this.refused = { why, x: pose.x, z: pose.z, until: now + REFUSED.for };
    return landing;
  }

  /** Why it can't set down at (x, z) at `now`, if the office refused a landing there a moment ago. */
  refusedHere(x: number, z: number, now: number): string | null {
    const r = this.refused;
    if (!r || now > r.until) return null;
    return Math.hypot(x - r.x, z - r.z) < REFUSED.within ? r.why : null;
  }

  /** How fast it's going along the ground (m/s). */
  get speed(): number {
    return Math.hypot(this.flight.vx, this.flight.vz);
  }

  /** Draws it `k` of the way from the step before to the last one. */
  private between(k: number) {
    const a = this.before;
    const b = this.flight.pose;
    const d = this.drawn;
    d.x = a.x + (b.x - a.x) * k;
    d.h = a.h + (b.h - a.h) * k;
    d.z = a.z + (b.z - a.z) * k;
    d.yaw = wrap(a.yaw + wrap(b.yaw - a.yaw) * k);
    d.pitch = a.pitch + (b.pitch - a.pitch) * k;
    d.roll = a.roll + (b.roll - a.roll) * k;
    d.spin = a.spin + (b.spin - a.spin) * k;
  }

  /** Whether it's somewhere else (or turned, leaning or spinning otherwise) than the office was last told. */
  private moved(): boolean {
    const p = this.flight.pose;
    const s = this.sent;
    return Math.abs(p.x - s.x) + Math.abs(p.h - s.h) + Math.abs(p.z - s.z) > 0.01 || Math.abs(wrap(p.yaw - s.yaw)) > 0.003 || Math.abs(p.pitch - s.pitch) + Math.abs(p.roll - s.roll) > 0.005 || Math.abs(p.spin - s.spin) > 0.01;
  }

  private tell(now: number) {
    const f = this.flight;
    Object.assign(this.sent, f.pose);
    this.sentLanded = f.landed;
    this.sentAt = now;
    this.hooks.send({ ...f.pose }, f.landed);
  }
}
