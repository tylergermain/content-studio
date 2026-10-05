/**
 * Your head and hands, for everyone else on your floor while you're in VR (protocol/vr.ts): sent as
 * your head turns about 2° or a hand moves a centimetre and a half, ten times a second at most, at
 * least once a second for whoever arrives, and a null pose as you leave VR. Where your body faces and
 * where you stand go out as they always do (core/loop.ts), so this is only the head's turn from the
 * body and the hands from the eyes. remote.ts shows other people's.
 */
import * as THREE from 'three';
import type { VrPose } from '../../../shared/protocol';
import { POSE_EVERY_MS, POSE_HEARTBEAT_MS, poseMoved, poseOf } from '../../../shared/vr-pose';
import type { Ctx } from '../../core/context';
import type { VrControllers, VrHand, VrSession } from './types';

export function startPresence(ctx: Ctx, s: VrSession, pads: VrControllers): void {
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const at = { left: new THREE.Vector3(), right: new THREE.Vector3() };
  const handAt = (h: VrHand) => (h.connected ? h.grip.getWorldPosition(at[h.hand]) : null);
  let last: VrPose | null = null;
  let lastAt = -Infinity;

  s.tick('me', ({ now }) => {
    if (now - lastAt < POSE_EVERY_MS) return;
    // The head as it's drawn this frame (the rig set it in 'steer'), as the camera's yaw, pitch and roll.
    euler.setFromQuaternion(s.head.quaternion, 'YXZ');
    const head = { position: s.head.position, yaw: euler.y, pitch: euler.x, roll: euler.z };
    const pose = poseOf(head, ctx.player.facing, { left: handAt(pads.left), right: handAt(pads.right) });
    if (now - lastAt < POSE_HEARTBEAT_MS && !poseMoved(last, pose)) return;
    ctx.net.send({ t: 'vr.pose', pose });
    last = pose;
    lastAt = now;
  });
  s.onEnd(() => ctx.net.send({ t: 'vr.pose', pose: null }));
}
