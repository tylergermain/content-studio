import * as THREE from 'three';
import { SEAT_HIPS } from '../../../shared/garage';
import { HELI, heliToStreet } from '../../../shared/heli';
import type { HeliCrew, HeliPose, HeliSeat } from '../../../shared/protocol';
import type { PlayerController } from '../../player';
import { shakeCamera } from '../../player/camera';
import { HeliCamera, type HeliView, type ViewWorld } from './camera';
import { heliPoint } from './model';

// Aboard Friday One: it has hold of you (PlayerController.rig, as a car does) and sits you in your seat
// wherever it's got to, and the camera is its own (see camera.ts). The mouse still turns the player's
// look as it always does (camYaw, and lookPitch in first person or camPitch in third); each frame what it
// turned since the last is the mouse, and goes to the helicopter's view, and the look is put back.

/** Where the player's look is put back to each frame (see look): yaw, the first-person pitch, the third-person one. */
const ANCHOR = { yaw: 0, look: 0, pitch: 0.6 } as const;
/** Which view you last flew or rode in, kept in this browser. */
const VIEW_KEY = 'agent-office.heliView';
/** Where you'd step out, round it (its own frame): beside your own door, the other one, a little further back, then the nose. */
const OUT = HELI.cabin.width / 2 + 0.95;

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

function savedView(): HeliView {
  try {
    return localStorage.getItem(VIEW_KEY) === 'cockpit' ? 'cockpit' : 'chase';
  } catch {
    return 'chase';
  }
}

function saveView(view: HeliView) {
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    // a private window: it's only for this visit then
  }
}

export class Ride {
  /** Your seat in it (HELI.seats), or -1 on your feet. */
  place = -1;
  seat: HeliSeat | null = null;
  readonly cam = new HeliCamera();
  /** How the third-person camera was before you got in. */
  private camWas: { dist: number; pitch: number } | null = null;
  private readonly at = { x: 0, h: 0, z: 0 };
  private readonly eye = new THREE.Vector3();

  constructor(
    private readonly player: PlayerController,
    private readonly camera: THREE.PerspectiveCamera,
  ) {}

  get active(): boolean {
    return this.place >= 0;
  }

  /** Into your seat (`c`): `rig` moves you each frame from now on, and the view is the helicopter's. */
  enter(c: HeliCrew, rig: (dt: number) => void) {
    const p = this.player;
    this.place = c.place;
    this.seat = c.seat;
    p.stopWalking();
    p.moving = false;
    p.vy = 0;
    this.camWas = { dist: p.camDist, pitch: p.camPitch };
    p.rig = rig;
    p.riding = true;
    this.anchor();
    this.cam.start(savedView());
  }

  /** Back on your feet: your own camera again, looking the way it faces (`yaw`). */
  leave(yaw: number) {
    const p = this.player;
    p.rig = null;
    p.riding = false;
    if (this.camWas) {
      p.camDist = this.camWas.dist;
      p.camPitch = this.camWas.pitch;
      this.camWas = null;
    }
    p.facing = yaw;
    p.camYaw = yaw + Math.PI;
    p.lookPitch = -0.08;
    this.place = -1;
    this.seat = null;
  }

  /** C: the other view, kept for next time. */
  switchView(): HeliView {
    const view = this.cam.toggle();
    saveView(view);
    return view;
  }

  /** You in your seat as it's drawn at `pose`, its street at `base` in the frame you're in. */
  sit(pose: HeliPose, base: number) {
    const s = HELI.seats[this.place] ?? HELI.seats[0];
    heliPoint(pose, s.x, s.y - SEAT_HIPS, s.z, this.at);
    const p = this.player;
    p.pos.set(this.at.x, base + this.at.h, this.at.z);
    p.facing = pose.yaw;
    p.moving = false;
  }

  /** What the mouse turned since the last frame goes to the helicopter's view; the player's look goes back to where it's read from. */
  look() {
    const p = this.player;
    const yaw = wrap(p.camYaw - ANCHOR.yaw);
    // Up is up in first person; in third, dragging down (camPitch up) looks down.
    const pitch = p.view === 'first' ? p.lookPitch - ANCHOR.look : ANCHOR.pitch - p.camPitch;
    this.cam.turn(yaw, pitch);
    this.anchor();
  }

  /**
   * Places the camera for it at `pose` (its street at `base`): the chase view, or your eye in your seat.
   * The view's tremble (coffee, a bump, a drink or two) goes on top, as it does on foot.
   */
  frame(pose: HeliPose, base: number, dt: number, world: ViewWorld, speed: number, t: number) {
    const s = HELI.seats[this.place] ?? HELI.seats[0];
    heliPoint(pose, s.x, HELI.eye, s.z + 0.12, this.at);
    this.eye.set(this.at.x, base + this.at.h, this.at.z);
    this.cam.place(this.camera, pose, base, this.eye, dt, world, speed);
    shakeCamera(this.camera, t, this.player.effects.sway, this.player.effects.jitter);
  }

  /**
   * Where you'd stand once out of it at `pose`, its skids `ground` up in your frame: beside your own
   * door, else the other, else a little further back or out by the nose, wherever there's room
   * (`fits`); beside your door if there's room nowhere.
   */
  wayOut(pose: HeliPose, ground: number, fits: (x: number, z: number, y: number) => boolean): { x: number; y: number; z: number } {
    const side = (HELI.seats[this.place]?.x ?? -1) < 0 ? -1 : 1;
    const door = HELI.doors[side < 0 ? 0 : 1].z;
    let first: { x: number; y: number; z: number } | null = null;
    for (const [x, z] of [
      [side * OUT, door],
      [-side * OUT, door],
      [side * OUT, door - 1.2],
      [-side * OUT, door - 1.2],
      [0, HELI.cabin.z + HELI.cabin.length / 2 + 1],
    ]) {
      const q = heliToStreet(pose, { x, y: 0, z });
      const at = { x: q.x, y: ground, z: q.z };
      if (fits(at.x, at.z, at.y)) return at;
      first ??= at;
    }
    return first!;
  }

  /** The player's look where `look` reads the mouse from. */
  private anchor() {
    const p = this.player;
    p.camYaw = ANCHOR.yaw;
    p.lookPitch = ANCHOR.look;
    p.camPitch = ANCHOR.pitch;
  }
}
