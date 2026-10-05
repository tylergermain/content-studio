// VR mode (features/vr): someone in a headset sends which way their head is turned and where their
// hands are, so everyone near them sees them look about and reach. Nothing else about VR goes over
// the wire, and the office keeps none of it: whoever arrives on the floor late has the next pose
// within a second (it's sent at least that often), and cleanPose (shared/vr-pose.ts) is what the
// office lets through.

/** A point (metres) in someone's body frame: x to their left, y up, z the way their body faces. */
export interface VrPoint {
  x: number;
  y: number;
  z: number;
}

/**
 * Where someone in a headset is looking and reaching, relative to their body: the way it faces is
 * their PeerInfo's rotY, so a head turned while the body stays put is a head turn to everyone else.
 */
export interface VrPose {
  /** How far their head is turned from the way their body faces (radians, + to their left). */
  yaw: number;
  /** How far up they look (radians, + up), as the office's own look pitch. */
  pitch: number;
  /** How far their head tilts (radians, + toward their left shoulder). */
  roll: number;
  /** Their left hand, from between their eyes, in their body frame; missing while it isn't tracked. */
  left?: VrPoint;
  /** Their right hand, the same way. */
  right?: VrPoint;
}

import type { HeadLook } from '../head-look.js';
export type VrClientMsg =
  | { t: 'head.look'; look: HeadLook }
  /** Your head and hands: at most ten times a second, at least once a second in VR, and null as you leave it. */
  | { t: 'vr.pose'; pose: VrPose | null };

export type VrServerMsg =
  | { t: 'peer.head'; id: string; look: HeadLook }
  /** `id`'s head and hands (see VrPose), to everyone else on their floor; null: they've left VR. */
  | { t: 'peer.vr'; id: string; pose: VrPose | null };
