/**
 * Getting about on the sticks: the left one walks you the way you look (as far as it's pushed, as
 * fast; click it in to run, until you let it go), and the right one turns you a snap at a time
 * (30°, or 45° in the prefs). Pushing the left stick off a seat gets you up, as walking off does.
 * With only one controller (pads.solo) its stick does both: forward and back walk, a flick to the side
 * turns, and while its ray is on a panel it scrolls the panel instead of walking.
 * On the ladder, a pole or in a car, which go by the keys, the left stick holds W, A, S and D down
 * for you. With the comfort vignette on (VrPrefs.vignette), the edges of the view dim while the
 * stick moves you.
 */
import * as THREE from 'three';
import type { Ctx } from '../../core/context';
import { noOutline } from '../../core/outline';
import type { VrControllers, VrRig, VrSession } from './types';
import { snapStep, soloStick, stickKeys } from './input-map';
import { keyDown, keyUp } from './keys';

/** On a rig, a key goes down with the stick pushed this far its way, and up again under LET_GO. */
const PRESS = 0.5;
const LET_GO = 0.3;
/** Back this near the middle, the stick stops running. */
const REST = 0.1;
/** The keys the left stick can hold for a rig. */
const RIG_KEYS = ['KeyW', 'KeyS', 'KeyA', 'KeyD'];

/** Starts the sticks moving you (see above); `rig` turns you. */
export function startLocomotion(ctx: Ctx, s: VrSession, pads: VrControllers, rig: VrRig): void {
  const { player } = ctx;
  const { stick } = player;
  /** The right stick has come back to the middle since its last turn. */
  let armed = true;
  let running = false;
  /** The keys the stick is holding down for a rig. */
  const held = new Set<string>();
  const vignette = makeVignette(ctx, s);

  function hold(code: string, down: boolean) {
    if (down === held.has(code)) return;
    if (down) {
      held.add(code);
      keyDown(code);
    } else {
      held.delete(code);
      keyUp(code);
    }
  }

  const split = { turnX: 0, walk: 0 };

  // After the rig's own steer tick, so you go the way your head looks this frame.
  s.tick('steer', ({ dt }) => {
    // The stick that walks and the one that turns: the left and the right, or the one there is.
    const solo = pads.solo;
    const walker = pads.byHand(solo ?? 'left');
    const turner = pads.byHand(solo ?? 'right');
    let x = walker.connected ? walker.stick.x : NONE.x;
    let y = walker.connected ? walker.stick.y : NONE.y;
    let turnX = turner.connected ? turner.stick.x : NONE.x;
    if (solo) {
      soloStick(x, y, split);
      // On a rig the stick is all keys (a car steers with A and D), so it doesn't turn you there.
      if (player.rig) turnX = 0;
      else {
        turnX = split.turnX;
        x = 0;
        y = pads.onPanel[solo] ? 0 : split.walk;
      }
    }
    const snap = snapStep(armed, turnX);
    armed = snap.armed;
    // Pushed right is a turn to the right: camYaw goes the other way.
    if (snap.turn) rig.turn(-snap.turn * THREE.MathUtils.degToRad(s.prefs.snapDeg));
    const push = Math.hypot(x, y);
    if (walker.stickPress.down) running = true;
    else if (push < REST) running = false;
    if (player.rig) {
      stick.x = stick.z = 0;
      stick.run = false;
      // Down past PRESS, and held until back under LET_GO.
      const pressed = stickKeys(x, y, PRESS);
      const kept = stickKeys(x, y, LET_GO);
      for (const code of RIG_KEYS) hold(code, pressed.includes(code) || (held.has(code) && kept.includes(code)));
    } else {
      for (const code of held) hold(code, false);
      stick.x = x;
      stick.z = y;
      stick.run = running;
    }
    vignette.update(dt, s.prefs.vignette && push > REST);
  });

  s.onEnd(() => {
    stick.x = stick.z = 0;
    stick.run = false;
    for (const code of held) hold(code, false);
    vignette.dispose();
  });
}

const NONE = { x: 0, y: 0 } as const;
/** How many pieces the vignette's ring is made of. */
const SEGMENTS = 48;

/**
 * The comfort vignette: a ring around the middle of your view, clear inside and dark at its edge,
 * that fades in while the stick moves or turns you, so the world sliding by is only seen ahead.
 */
function makeVignette(ctx: Ctx, s: VrSession) {
  const ring = new THREE.RingGeometry(0.16, 0.6, SEGMENTS, 1);
  // Clear on the inner edge (the first row of points), dark on the outer.
  const inner = SEGMENTS + 1;
  const rgba = new Float32Array(ring.attributes.position.count * 4);
  for (let i = 0; i < ring.attributes.position.count; i++) rgba[i * 4 + 3] = i < inner ? 0 : 1;
  ring.setAttribute('color', new THREE.BufferAttribute(rgba, 4));
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false, toneMapped: false });
  const mesh = new THREE.Mesh(ring, material);
  mesh.name = 'vr-vignette';
  mesh.frustumCulled = false;
  mesh.renderOrder = 980;
  mesh.visible = false;
  noOutline(mesh);
  ctx.scene.add(mesh);
  return {
    update(dt: number, on: boolean) {
      material.opacity += ((on ? 0.85 : 0) - material.opacity) * Math.min(1, dt * 10);
      mesh.visible = material.opacity > 0.01;
      if (!mesh.visible) return;
      // Head-locked, 0.3 m ahead of your eyes as they're drawn this frame.
      const { position, quaternion } = s.head;
      mesh.position.set(0, 0, -0.3).applyQuaternion(quaternion).add(position);
      mesh.quaternion.copy(quaternion);
    },
    dispose() {
      mesh.removeFromParent();
      ring.dispose();
      material.dispose();
    },
  };
}
