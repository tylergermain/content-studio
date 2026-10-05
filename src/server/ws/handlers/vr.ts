// Someone in VR (features/vr): their head and hands, passed on to everyone else on their floor and
// kept by nobody (see protocol/vr.ts). Each pose is cleaned up first (shared/vr-pose.ts), and at most
// twenty a second each get through; leaving VR (a null pose) always does.
import type { VrClientMsg } from '../../../shared/protocol.js';
import { cleanPose } from '../../../shared/vr-pose.js';
import { throttle } from '../../office/client.js';
import type { HandlerMap } from './types.js';

/** The least time between two poses from one person that the office passes on (ms). */
export const VR_POSE_EVERY_MS = 50;

export const vrHandlers = {
  'vr.pose'(ctx, c, msg) {
    if (msg.pose === null) return ctx.toNeighbors(c, { t: 'peer.vr', id: c.id, pose: null });
    const pose = cleanPose(msg.pose);
    if (!pose || !throttle(c, 'vr.pose', VR_POSE_EVERY_MS)) return;
    ctx.toNeighbors(c, { t: 'peer.vr', id: c.id, pose }, true);
  },
} satisfies HandlerMap<VrClientMsg>;
