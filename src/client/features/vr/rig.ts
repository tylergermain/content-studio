/**
 * Your head in the office: the headset's room placed in it (see rig-math.ts), so you see from where
 * your head really is, at your real height, and walking about the room walks you about the office.
 *
 * The camera keeps no parent (a lot of the office reads camera.position as where you are), so there's
 * no dolly to move: the room is placed by handing three.js an offset reference space instead, and it
 * reads the head and the controllers straight into the office's coordinates.
 *
 * Each frame:
 * - steer (before you move): whatever moved your feet or turned you since last frame (a teleport, a
 *   seat, `camYaw` set by the walk over to someone) carries the room along; your head is read, and
 *   it's where you look from (`player.camYaw` / `lookPitch`); walking about the room, your feet follow
 *   your head (bumping into things as feet do), and a wall they can't go through pushes the room back,
 *   so your head never ends up inside one.
 * - moved (once you have): the stick, gravity, a seat, the ladder or a car moved your feet, or turned
 *   you (a car going round a bend): the room comes too. Your body turns after your head, lazily, and
 *   the camera is put where your head is drawn this frame, for everything after that reads it.
 * - after the frame: if the room moved, three.js gets its new reference space, for the next frame.
 *   Everything this frame reads poses through the space it was drawn with (VrSession.world).
 */
import * as THREE from 'three';
import type { Ctx } from '../../core/context';
import type { VrRig, VrSession } from './types';
import { type Body, type Pose, type Rig, bodyYaw, carry, headWorld, offsetOf, placeHead, pushBack, quatWorld, rigMoved, turnAbout, wrap, yawPitch } from './rig-math';
import { stepTo } from '../../player/collide';

/** Your head in the headset's room until it's first seen: standing, at the origin, looking ahead. */
const STANDING: Pose = { x: 0, y: 1.6, z: 0, yaw: 0 };
/** How far up or down you can look, as the mouse can (see PlayerInput.look). */
const PITCH = 1.45;
/**
 * How far your head may lean past feet that can't go any further: less than your feet keep from a
 * wall (player/collide.ts keeps them 0.32 m off), so your head never ends up inside one.
 */
const LEAN = 0.28;
/**
 * A turn something else gives you (a seat, arriving where you walked to, the elevator) at least this
 * big (radians) turns the room: smaller ones are the eased pulls the office gives the camera (the walk
 * over to someone, swinging round a pole), which in VR are left to your head. In a car every turn counts.
 */
const TURNED = 0.25;
/** Walking about the room faster than this (m/s, eased), you're walking, to everyone who sees you and to your body. */
const STROLL = 0.35;

export interface RigOptions {
  /** How far the room's floor is below its origin: 0 for 'local-floor', a standing height for 'local' (whose origin is your head). */
  floor: number;
}

/** Starts placing the headset's room in the office (see above); `turn` and `recenter` for the stick and the headset's own recentring. */
export function startRig(ctx: Ctx, s: VrSession, opts: RigOptions = { floor: 0 }): VrRig {
  const { player, camera, renderer } = ctx;
  /** The room as the headset first gave it: every rig is an offset from it. */
  const base = renderer.xr.getReferenceSpace()!;
  /** The head in the room this frame (until it's seen, a guess), and as a quaternion. */
  let local: Pose = STANDING;
  const localQ = new THREE.Quaternion();
  /** Where the room's floor goes: your feet, eased after a stair, lifted by the height pref. */
  const floorY = () => player.pos.y + player.stepOffset + opts.floor + s.prefs.heightOffset;
  /** The room now, and as three.js drew this frame (its reference space). */
  let rig: Rig = placeHead(local, player.pos, player.camYaw, floorY());
  let drawn: Rig = rig;
  /** Where your feet were when the room last went along with them. */
  const feet = new THREE.Vector3().copy(player.pos);
  /** The way you looked when the rig last set it: anything else setting `camYaw` is turning you. */
  let looked = player.camYaw;
  let body: Body = { yaw: player.facing, turning: false };
  /** The headset recentred (or VR just started): put the room back under you at the next frame. */
  let recentre = true;
  /** How fast you're walking about the room (m/s, eased). */
  let stroll = 0;
  const head = s.head as { position: THREE.Vector3; quaternion: THREE.Quaternion; yaw: number; pitch: number; height: number };

  function apply() {
    const o = offsetOf(rig);
    renderer.xr.setReferenceSpace(base.getOffsetReferenceSpace(new XRRigidTransform(o.position, o.orientation)));
    drawn = rig;
  }
  apply();
  head.position.set(player.pos.x, floorY() + STANDING.y, player.pos.z);
  head.yaw = player.camYaw;

  /** Free to walk about the room: not sat down, and not held by the ladder, a pole or a car. */
  const free = () => !player.seat && !player.rig;

  /** Your feet moved without your head moving them (see above): the room goes with them. */
  function carryFeet() {
    const dx = player.pos.x - feet.x;
    const dz = player.pos.z - feet.z;
    if (dx || dz) rig = carry(rig, { x: dx, z: dz });
    feet.copy(player.pos);
  }

  /**
   * Something else set `camYaw` (a seat, arriving at someone, the car going round a bend): the room
   * turns about your head to match. Never a nudge toward somewhere, which would turn the world against
   * your head (see TURNED).
   */
  function takeTurn() {
    const d = wrap(player.camYaw - looked);
    if (Math.abs(d) > (player.riding ? 1e-5 : TURNED)) rig = turnAbout(rig, local, d);
    looked = player.camYaw;
  }

  function readHead(): boolean {
    const pose = s.frame()?.getViewerPose(base);
    if (!pose) return false;
    const { position: p, orientation: q } = pose.transform;
    localQ.set(q.x, q.y, q.z, q.w);
    local = { x: p.x, y: p.y, z: p.z, yaw: yawPitch(localQ).yaw };
    return true;
  }

  s.tick('steer', ({ dt }) => {
    carryFeet();
    const seen = readHead();
    if (seen && recentre) {
      recentre = false;
      rig = placeHead(local, player.pos, player.camYaw, rig.y);
      looked = player.camYaw;
    } else takeTurn();
    if (!seen) return;
    const now = headWorld(rig, local);
    if (free()) {
      // Your feet follow your head about the room, as far as they fit; what they don't get to, the room gives back.
      stepTo(player, now.x, player.pos.z);
      stepTo(player, player.pos.x, now.z);
      rig = pushBack(rig, now, player.pos, LEAN);
      const walked = Math.hypot(player.pos.x - feet.x, player.pos.z - feet.z);
      stroll += (walked / Math.max(dt, 1e-3) - stroll) * Math.min(1, dt * 8);
      feet.copy(player.pos);
    } else stroll = 0;
    // Where you look from: your head as drawn this frame (the room's space was set before it).
    const shown = headWorld(drawn, local);
    head.position.set(shown.x, shown.y, shown.z);
    quatWorld(drawn, localQ, head.quaternion);
    const look = yawPitch(head.quaternion);
    head.yaw = look.yaw;
    head.pitch = look.pitch;
    head.height = shown.y - player.pos.y;
    // You look the way your head does now (with any turn just taken, which shows from the next frame).
    player.camYaw = wrap(look.yaw + rig.yaw - drawn.yaw);
    player.lookPitch = THREE.MathUtils.clamp(look.pitch, -PITCH, PITCH);
    looked = player.camYaw;
  });

  s.tick('moved', ({ dt }) => {
    carryFeet();
    takeTurn();
    rig = { ...rig, y: floorY() };
    // Your body comes round after your head; a seat, the ladder or a car face you their own way.
    if (free()) {
      if (stroll > STROLL) player.moving = true;
      body = bodyYaw(body, player.camYaw + Math.PI, player.moving, dt);
      player.facing = body.yaw;
    } else body = { yaw: player.facing, turning: false };
    camera.position.copy(head.position);
    camera.quaternion.copy(head.quaternion);
    camera.updateMatrixWorld();
  });

  s.around({ after: () => rigMoved(rig, drawn) && apply() });

  // The headset recentred (a long press of the Meta button): its room moved under you.
  const onReset = () => void (recentre = true);
  base.addEventListener('reset', onReset);
  s.onEnd(() => base.removeEventListener('reset', onReset));

  return {
    turn(rad: number) {
      rig = turnAbout(rig, local, rad);
      player.camYaw = wrap(player.camYaw + rad);
      looked = player.camYaw;
    },
    recenter() {
      recentre = true;
    },
  };
}
