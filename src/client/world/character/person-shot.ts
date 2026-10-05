import * as THREE from 'three';
import { ease, reachCurve } from './curves';
import type { PersonRig } from './rig';

/**
 * A shot with the basketball, as everyone sees it: both arms up over the head and after the ball. Or a
 * heave from way out (see shared/hoop-range.ts), thrown one-armed: the right arm (armL, the one on -x)
 * up over the top and whipped through, the left out for balance, the body turning into it. Seconds
 * for each, and for the heave's parts: up over the top, the whip, holding the follow-through.
 */
const SHOT_TIME = 0.5;
const HEAVE = { time: 0.75, up: 0.08, whip: 0.16, hold: 0.42 } as const;

/** A shot `t` seconds on (a heave, if `heave`), over whatever the arms were doing. Says how far on it is, or -1 once it's over. */
export function shotStep(rig: PersonRig, t: number, heave: boolean): number {
  if (heave) return heaveStep(rig, t);
  const k = reachCurve(t / SHOT_TIME);
  for (const [arm, side] of [
    [rig.armL, 1],
    [rig.armR, -1],
  ] as const) {
    arm.rotation.x = THREE.MathUtils.lerp(arm.rotation.x, -2.75, k);
    arm.rotation.z = THREE.MathUtils.lerp(arm.rotation.z, side * 0.12, k);
  }
  return t >= SHOT_TIME ? -1 : t;
}

/** How far through a heave it is: up over the top (0 → 1), the whip (0 → 1), and how much of it shows (1, easing back to 0 after the follow-through). The one, written over each time. */
const phase = { up: 0, whip: 0, on: 0 };

/** How far through a heave `t` seconds on (in `phase`). */
function heavePhase(t: number): Readonly<typeof phase> {
  phase.up = ease(Math.min(1, t / HEAVE.up));
  phase.whip = t < HEAVE.up ? 0 : ease(Math.min(1, (t - HEAVE.up) / HEAVE.whip));
  phase.on = t < HEAVE.hold ? 1 : 1 - ease(Math.min(1, (t - HEAVE.hold) / (HEAVE.time - HEAVE.hold)));
  return phase;
}

function heaveStep(rig: PersonRig, t: number): number {
  const { up, whip, on } = heavePhase(t);
  // The throwing arm: up and back over the shoulder, then over the top and down through the throw.
  const arm = rig.armL;
  const swing = THREE.MathUtils.lerp(THREE.MathUtils.lerp(arm.rotation.x, -3.5, up), -0.75, whip);
  arm.rotation.x = THREE.MathUtils.lerp(arm.rotation.x, swing, on);
  arm.rotation.z = THREE.MathUtils.lerp(arm.rotation.z, -0.15, on);
  // The other out to the side and a little ahead.
  rig.armR.rotation.x = THREE.MathUtils.lerp(rig.armR.rotation.x, -0.5, on);
  rig.armR.rotation.z = THREE.MathUtils.lerp(rig.armR.rotation.z, 1.05, on);
  return t >= HEAVE.time ? -1 : t;
}

/** A heave `t` seconds on turns the body: the throwing shoulder back, then round and leaning into it. Over the body's own pose for the frame. */
export function heaveTurn(rig: PersonRig, t: number) {
  const { up, whip, on } = heavePhase(t);
  rig.body.rotation.y += THREE.MathUtils.lerp(-0.45 * up, 0.35, whip) * on;
  rig.body.rotation.x += 0.16 * whip * on;
}
