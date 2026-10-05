// Where Friday One may set down as the pilot's page sees it, over and above shared/heli-world.ts: nobody
// on your floor within HELI.clear of its hub, and nothing standing on the street under its skids (a car,
// a lamp post, a bench) or up into its rotor (a lamp post, a tree). The office checks the people on every
// floor and every floor's cars as well (server/heli); the page checks what it can see, so it doesn't ask
// to land where the office would refuse it over something in plain view. And the downwash on your own
// player (rotorWash in shared/heli.ts), moved the way walking moves you, never through anything.

import { HELI, SKIDS, rotorWash } from '../../../shared/heli';
import { discHitsBox, turnedHitsBox } from '../../../shared/heli-shapes';
import type { StreetPoint } from '../../../shared/mainstreet';
import type { HeliPose } from '../../../shared/protocol';
import { stepTo, type Body } from '../../player/collide';
import type { Collider } from '../../world/types';

/** Something under its skids taller than this over the ground there, and it won't set down on it. */
const SKID_CLEAR = 0.3;
/** Something under its rotor's disc reaching higher than this over the ground there, and the blades would hit it. */
const ROTOR_CLEAR = HELI.hub - 0.4;
/** The skids' box: its middle along it, and half its length. */
const SKID_MID = (SKIDS.front + SKIDS.back) / 2;
const SKID_HALF = (SKIDS.front - SKIDS.back) / 2;
/** What's looked at round it: everything standing on the street within NEAR, gathered again once it's moved MOVED, or every EVERY ms. */
const NEAR = HELI.rotor + 6;
const MOVED = 4;
const EVERY = 1000;

/** What on your floor stands where it might set down: gathered now and then rather than every step (see near). */
export class LandingCheck {
  private readonly near: Collider[] = [];
  private x = Infinity;
  private z = Infinity;
  private street = NaN;
  private at = -Infinity;

  /** `colliders` is everything on your floor that's in the way (the office's), and `own` says which are the helicopter's own. */
  constructor(
    private readonly colliders: () => readonly Collider[],
    private readonly own: (c: Collider) => boolean = () => false,
  ) {}

  /**
   * Why it can't set down at (x, z) turned `yaw`, with the ground `ground` over the street and the street
   * at `street` in your floor's frame, at `now` (ms): something standing under its skids or reaching up
   * into its rotor; null if there's nothing.
   */
  why(x: number, z: number, yaw: number, ground: number, street: number, now: number): string | null {
    this.gather(x, z, street, now);
    const s = Math.sin(yaw);
    const c = Math.cos(yaw);
    const floor = street + ground;
    for (const o of this.near) {
      const top = o.top - floor;
      if (top > SKID_CLEAR && turnedHitsBox(o, x + SKID_MID * s, z + SKID_MID * c, s, c, SKIDS.half, SKID_HALF)) return "Can't land here";
      if (top > ROTOR_CLEAR && discHitsBox(o, x, z, HELI.rotor)) return "Can't land here";
    }
    return null;
  }

  /** What stands on the street round (x, z), unless it was gathered close by a moment ago. */
  private gather(x: number, z: number, street: number, now: number) {
    if (street === this.street && Math.abs(x - this.x) < MOVED && Math.abs(z - this.z) < MOVED && now - this.at < EVERY) return;
    this.x = x;
    this.z = z;
    this.street = street;
    this.at = now;
    this.near.length = 0;
    const r = NEAR + MOVED;
    for (const o of this.colliders()) {
      // On the street (not overhead, like the balconies, nor the ground itself), and near.
      if ((o.bottom ?? 0) > street + 1 || o.top <= street + SKID_CLEAR || o.top > street + 60 || this.own(o)) continue;
      if (o.minX > x + r || o.maxX < x - r || o.minZ > z + r || o.maxZ < z - r) continue;
      this.near.push(o);
    }
  }
}

/** Whether someone at (px, py, pz) on your floor, the street at `street`, is under it setting down at (x, z): within HELI.clear, on the ground. */
export function underneath(px: number, py: number, pz: number, x: number, z: number, street: number): boolean {
  return py - street < 2 && Math.hypot(px - x, pz - z) < HELI.clear;
}

const at: StreetPoint = { x: 0, h: 0, z: 0 };
const push = { x: 0, z: 0 };

/**
 * The rotor's downwash on you, `dt` seconds of it: while it flies low over you (`pose`, not `landed`),
 * you're pushed out from under it as fast as rotorWash says, a step along each axis the way walking
 * moves you, so it never puts you through anything. `street` is the street's height in your floor's
 * frame and `ground` the ground's over it where you stand. Returns how hard you were pushed (m/s).
 */
export function washOver(body: Body, pose: HeliPose, landed: boolean, street: number, ground: number, dt: number): number {
  at.x = body.pos.x;
  at.h = body.pos.y - street;
  at.z = body.pos.z;
  rotorWash(pose, landed, at, push, ground);
  if (!push.x && !push.z) return 0;
  stepTo(body, body.pos.x + push.x * dt, body.pos.z);
  stepTo(body, body.pos.x, body.pos.z + push.z * dt);
  return Math.hypot(push.x, push.z);
}
