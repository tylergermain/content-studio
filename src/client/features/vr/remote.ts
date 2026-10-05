/**
 * Other people in VR, as you see them (protocol/vr.ts): a headset on their character's face, their
 * head turned and tilted the way they turn and tilt theirs, and their arms reaching for where their
 * hands are. Loaded the first time someone on your floor sends a pose (see features/vr/index.ts), so
 * on a desktop too, and nowhere before that.
 *
 * It never edits a character: Person.wear puts the headset on the head and an empty marker in each
 * hand, so the head and the arms are those things' parents, and an 'others' tick (after the people's
 * own, which pose them for walking, sitting and the rest) turns them. A pose that stops coming is let
 * go of after a couple of seconds, and the character is as it was.
 */
import * as THREE from 'three';
import type { ServerMsg, VrPoint, VrPose } from '../../../shared/protocol';
import { POSE_STALE_MS, SHOULDER, armAim, headEuler } from '../../../shared/vr-pose';
import type { Ctx } from '../../core/context';
import { noOutline } from '../../core/outline';
import type { Parts } from '../../core/parts';
import type { Person } from '../../world/character';
import { toon } from '../../world/toon';

type PeerVr = Extract<ServerMsg, { t: 'peer.vr' }>;

/** How quickly a head or an arm catches up with the last pose (per second): poses come ten times a second, frames many more. */
const FOLLOW = 18;

/** What someone in VR has on, and where their head and arms are turned to. */
interface Worn {
  person: Person;
  visor: THREE.Object3D;
  /** In their right hand (Person.wear's 'hand'): its parent is that arm. */
  right: THREE.Object3D;
  /** In their left hand ('offhand'). */
  left: THREE.Object3D;
  /** The head's turn and each arm's, as drawn: following the pose. */
  head: THREE.Quaternion;
  arms: { left: THREE.Quaternion | null; right: THREE.Quaternion | null };
}

let state: { worn: Map<string, Worn>; poses: Map<string, { pose: VrPose; at: number }> } | null = null;

/** A pose from someone on your floor (or null: they've left VR). The first one starts the tick that shows them all. */
export function peerPose(ctx: Ctx, parts: Pick<Parts, 'peers'>, m: PeerVr): void {
  if (!state) state = start(ctx, parts);
  if (m.pose) state.poses.set(m.id, { pose: m.pose, at: performance.now() });
  else state.poses.delete(m.id);
}

function start(ctx: Ctx, parts: Pick<Parts, 'peers'>) {
  const worn = new Map<string, Worn>();
  const poses = new Map<string, { pose: VrPose; at: number }>();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const want = new THREE.Quaternion();

  function takeOff(id: string) {
    const w = worn.get(id);
    if (!w) return;
    for (const o of [w.visor, w.left, w.right]) o.removeFromParent();
    worn.delete(id);
  }

  function putOn(id: string, person: Person): Worn {
    takeOff(id);
    const w: Worn = { person, visor: visor(), right: new THREE.Object3D(), left: new THREE.Object3D(), head: new THREE.Quaternion(), arms: { left: null, right: null } };
    person.wear(w.visor, 'head');
    person.wear(w.right, 'hand');
    person.wear(w.left, 'offhand');
    noOutline(w.visor);
    worn.set(id, w);
    return w;
  }

  /** Turns `arm` toward `hand` (or lets it be: no hand, or holding on to the ladder or a pole). */
  function aim(w: Worn, side: 'left' | 'right', hand: VrPoint | undefined, free: boolean, k: number) {
    const arm = w[side].parent;
    if (!arm || !hand || !free) {
      w.arms[side] = null;
      return;
    }
    const q = armAim(SHOULDER[side], hand);
    want.set(q.x, q.y, q.z, q.w);
    const now = w.arms[side];
    if (now) now.slerp(want, k);
    else w.arms[side] = want.clone();
    arm.quaternion.copy(w.arms[side]!);
  }

  // After the people's own tick (features/peers), which poses everyone for the frame.
  ctx.ticks.add('others', ({ dt, now }) => {
    const { remotes } = parts.peers;
    const k = 1 - Math.exp(-FOLLOW * dt);
    for (const [id, p] of poses) {
      if (now - p.at > POSE_STALE_MS) {
        poses.delete(id);
        continue;
      }
      // Not in the room (yet): on another floor, or about to be put in it.
      const r = remotes.get(id);
      if (!r) continue;
      const had = worn.get(id);
      // Someone new, the same person seen afresh (they left the floor and came back), or a headset that fell off.
      const fresh = !had || had.person !== r.person || !had.visor.parent || !had.left.parent || !had.right.parent;
      const w = fresh ? putOn(id, r.person) : had;
      const e = headEuler(p.pose);
      want.setFromEuler(euler.set(e.x, e.y, e.z, 'YXZ'));
      if (fresh) w.head.copy(want);
      else w.head.slerp(want, k);
      // On top of the little nod the character gives as it talks or reads.
      w.visor.parent!.quaternion.premultiply(w.head);
      const free = !r.grip;
      aim(w, 'left', p.pose.left, free, k);
      aim(w, 'right', p.pose.right, free, k);
    }
    for (const id of [...worn.keys()]) if (!poses.has(id) || !remotes.has(id)) takeOff(id);
  });
  return { worn, poses };
}

/** The headset's parts, made once and shared by everyone's. */
let kit: { shell: THREE.BoxGeometry; glass: THREE.BoxGeometry; strap: THREE.TorusGeometry } | null = null;

/** A headset for a character's head (whose ball is 0.34 across, its front +z): over the eyes, with a strap round the back. */
function visor(): THREE.Group {
  kit ??= { shell: new THREE.BoxGeometry(0.46, 0.2, 0.16), glass: new THREE.BoxGeometry(0.4, 0.14, 0.012), strap: new THREE.TorusGeometry(0.345, 0.022, 6, 28) };
  const g = new THREE.Group();
  g.name = 'vr-visor';
  const shell = new THREE.Mesh(kit.shell, toon('#2b2d42'));
  shell.position.set(0, 0.04, 0.3);
  const glass = new THREE.Mesh(kit.glass, toon('#11131c', { emissive: '#1b2a4a' }));
  glass.position.set(0, 0.04, 0.383);
  const strap = new THREE.Mesh(kit.strap, toon('#2b2d42'));
  strap.rotation.x = Math.PI / 2;
  strap.position.y = 0.06;
  g.add(shell, glass, strap);
  return g;
}
