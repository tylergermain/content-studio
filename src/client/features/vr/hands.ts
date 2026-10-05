/**
 * Your hands in VR: the first-person mittens (world/hands.ts) on the controllers, so the one holding
 * the mug, the dram or the cigarette is the one you're holding up, and reaching, sipping and the
 * emotes still play out from where your hands are. What's held in both hands (a card, a book, the
 * ball) stays in front of your face, where it is on a screen. Your own body isn't drawn: you're
 * looking out of it, wherever an activity's camera would have gone.
 */
import * as THREE from 'three';
import type { Ctx } from '../../core/context';
import type { VrControllers, VrSession } from './types';

/**
 * How a mitten sits on a grip: WebXR's grip space points -z out of the fist like the mitten, with
 * the palm toward the other hand; the mitten's palm faces down, so it's rolled a quarter turn in,
 * which puts its thumb on top, by the stick.
 */
const ROLL_IN = Math.PI / 2;

/** Puts your hands on the controllers for the session, and back in their own scene at its end. */
export function startHands(ctx: Ctx, s: VrSession, pads: VrControllers): void {
  const right = new THREE.Group();
  right.rotation.z = -ROLL_IN;
  const left = new THREE.Group();
  left.rotation.z = ROLL_IN;
  pads.right.grip.add(right);
  pads.left.grip.add(left);
  // Where the camera would be: the card, the book and the ball are placed in front of it.
  const between = new THREE.Group();
  ctx.scene.add(between);
  ctx.hands.mount({ right, left, between });

  // After the office's own (moveMe has posed the hands and decided whether to show you).
  s.tick('me', () => {
    // In a car or at the tee your hands are on the wheel or the club, out of sight.
    const shown = !ctx.activities.any('hidesHands');
    right.visible = shown && pads.right.connected;
    left.visible = shown && pads.left.connected;
    between.visible = shown;
    between.position.copy(s.head.position);
    between.quaternion.copy(s.head.quaternion);
    // You look out of your own head: an activity that takes the camera would otherwise show you your body around you.
    ctx.me.root.visible = false;
  });

  s.onEnd(() => {
    ctx.hands.mount(null);
    right.removeFromParent();
    left.removeFromParent();
    between.removeFromParent();
  });
}
