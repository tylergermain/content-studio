import * as THREE from 'three';
import type { Solid } from '../../../shared/mainstreet';
import type { HeliPose } from '../../../shared/protocol';
import { heliTurn } from './model';

// Aboard Friday One the camera is the helicopter's (the 'heli' activity takes it), placed each frame in
// the play tick, after the player's own camera (aimCamera, which keeps it within 3.5 m of the ground).
// Two views, C between them: the chase view, behind and above it, swinging round after it as it turns,
// which the mouse orbits and the wheel pulls in or out; and the cockpit, from your own seat, where the
// mouse looks round the canopy. Neither touches how far the camera sees (camera.far stays FAR).

export type HeliView = 'chase' | 'cockpit';

/**
 * The chase view: `back` behind it and `up` over it to start with, `min` to `max` back on the wheel,
 * following it with k = 1 - exp(-`follow` dt), at least `clear` over the ground and `gap` short of
 * anything solid between it and the helicopter. Left alone (`settle` seconds), it swings back round
 * behind as the helicopter flies on.
 */
export const CHASE = { back: 12, up: 4, min: 8, max: 30, follow: 6, clear: 1.5, gap: 0.6, settle: 2 } as const;
/** The cockpit: the most you can look round from your seat, sideways and up or down (radians). */
export const COCKPIT = { yaw: THREE.MathUtils.degToRad(100), pitch: THREE.MathUtils.degToRad(60) } as const;
/** The chase view's lowest and highest look down at it (radians up over it), and where it starts. */
const RISE = { min: -0.15, max: 1.25 } as const;
const RISE0 = Math.atan2(CHASE.up, CHASE.back);
/** The cockpit looks this far down to start with (radians): over the panel at the ground ahead. */
const COCKPIT_DOWN = -0.2;

/** What the chase view keeps out of: the ground (meters over the street at x, z) and the solids it flies among. */
export interface ViewWorld {
  terrain(x: number, z: number): number;
  readonly solids: readonly Solid[];
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const look = new THREE.Euler(0, 0, 0, 'YXZ');
const turned = new THREE.Quaternion();
const lookTurn = new THREE.Quaternion();
const want = new THREE.Vector3();
const target = new THREE.Vector3();

/** Where along a line a box starts and stops (see slab), as it's narrowed one axis at a time. */
let enter = 0;
let leave = 0;

/** Narrows enter..leave to where a line from `from` going `d` is between `lo` and `hi`: false once that's nowhere. */
function slab(from: number, d: number, lo: number, hi: number): boolean {
  if (Math.abs(d) < 1e-9) return from >= lo && from <= hi;
  const u = (lo - from) / d;
  const v = (hi - from) / d;
  enter = Math.max(enter, Math.min(u, v));
  leave = Math.min(leave, Math.max(u, v));
  return enter <= leave;
}

/** How far (0..1) along from `a` to `b` the first solid is (by its box), in a frame whose street is at `base`; 1 if none. */
export function firstHit(a: THREE.Vector3, b: THREE.Vector3, solids: readonly Solid[], base: number): number {
  let best = 1;
  for (const s of solids) {
    enter = 0;
    leave = best;
    if (slab(a.x, b.x - a.x, s.minX, s.maxX) && slab(a.y, b.y - a.y, base + s.bottom, base + s.top) && slab(a.z, b.z - a.z, s.minZ, s.maxZ) && enter < best) best = enter;
  }
  return best;
}

export class HeliCamera {
  view: HeliView = 'chase';
  /** The chase view's distance back (the wheel's). */
  dist: number = CHASE.back;
  /** The chase view: how far round from behind it (radians, + to its left) and up over it. */
  orbit = 0;
  rise = RISE0;
  /** The cockpit: looking round from your seat (radians, + to the left and up). */
  lookYaw = 0;
  lookPitch = 0;
  /** Where the chase view has followed it to, before anything pulls it in. */
  private readonly settled = new THREE.Vector3();
  private placed = false;
  /** Seconds since the mouse last turned the chase view. */
  private idle = 0;

  /** Aboard, in `view`: the chase view right behind it, the cockpit looking ahead and a little down. */
  start(view: HeliView) {
    this.view = view;
    this.placed = false;
    this.orbit = this.lookYaw = 0;
    this.lookPitch = COCKPIT_DOWN;
    this.rise = RISE0;
  }

  /** C: the other view, starting out ahead of you. */
  toggle(): HeliView {
    this.start(this.view === 'chase' ? 'cockpit' : 'chase');
    return this.view;
  }

  /** The wheel: the chase view in (-) or out (+). */
  zoom(by: number) {
    this.dist = THREE.MathUtils.clamp(this.dist + by, CHASE.min, CHASE.max);
  }

  /** The mouse moved the view `yaw` round (+ left) and `pitch` up (+ up, radians). */
  turn(yaw: number, pitch: number) {
    if (!yaw && !pitch) return;
    if (this.view === 'cockpit') {
      this.lookYaw = THREE.MathUtils.clamp(this.lookYaw + yaw, -COCKPIT.yaw, COCKPIT.yaw);
      this.lookPitch = THREE.MathUtils.clamp(this.lookPitch + pitch, -COCKPIT.pitch, COCKPIT.pitch);
      return;
    }
    this.orbit = wrap(this.orbit + yaw);
    // Looking down at it is the camera going up over it.
    this.rise = THREE.MathUtils.clamp(this.rise - pitch, RISE.min, RISE.max);
    this.idle = 0;
  }

  /**
   * Places `camera` for `pose`, drawn with its street at `base` in the frame you're in: behind it, or
   * at `eye` (your eye in your seat, in that frame) looking the way it's turned. `speed` (m/s along the
   * ground) swings an orbited chase view back round behind it.
   */
  place(camera: THREE.PerspectiveCamera, pose: HeliPose, base: number, eye: THREE.Vector3, dt: number, world: ViewWorld, speed: number) {
    if (this.view === 'cockpit') {
      camera.position.copy(eye);
      look.set(this.lookPitch, Math.PI + this.lookYaw, 0);
      lookTurn.setFromEuler(look);
      camera.quaternion.copy(heliTurn(pose, turned).multiply(lookTurn));
      this.placed = false;
      return;
    }
    this.idle += dt;
    if (this.idle > CHASE.settle && speed > 3) this.orbit *= Math.exp(-dt * 1.2);
    target.set(pose.x, base + pose.h + 1.8, pose.z);
    // As far from it whichever way round it's orbited: `dist` back and CHASE.up for it up, to start with.
    const yaw = pose.yaw + this.orbit;
    const reach = this.dist / Math.cos(RISE0);
    const back = reach * Math.cos(this.rise);
    want.set(target.x - Math.sin(yaw) * back, target.y + reach * Math.sin(this.rise), target.z - Math.cos(yaw) * back);
    if (this.placed) this.settled.lerp(want, 1 - Math.exp(-CHASE.follow * dt));
    else this.settled.copy(want);
    this.placed = true;
    // In off anything solid between it and the view, and up off the ground.
    want.copy(this.settled);
    const hit = firstHit(target, want, world.solids, base);
    if (hit < 1) {
      const len = target.distanceTo(want);
      want.lerp(target, 1 - Math.max(0.05, hit - CHASE.gap / Math.max(len, 1e-6)));
    }
    want.y = Math.max(want.y, base + world.terrain(want.x, want.z) + CHASE.clear);
    camera.position.copy(want);
    // A little ahead of it and over it, so it sits low in the view with more to see of where it's going.
    target.x += Math.sin(pose.yaw) * 2.5;
    target.y += this.dist * 0.14;
    target.z += Math.cos(pose.yaw) * 2.5;
    camera.up.set(0, 1, 0);
    camera.lookAt(target);
  }
}
