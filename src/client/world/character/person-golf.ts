import * as THREE from 'three';
import { mesh, toon } from '../toon';
import { DOWN, type PersonRig } from './rig';

/** Which club is in hand: a driver at the balcony's golf tee, a putter on Putt Street (features/minigolf). */
export type Club = 'driver' | 'putter';

/**
 * How each club swings. `back` and `follow` are how far round it goes (radians from pointing down at
 * the ball), back over the right shoulder and on through to the finish: a putter's finish is as far
 * through as it was taken back (`followBack`), a pendulum. `lean` is how far the swing's plane leans out
 * from upright, down to the ball in front of the feet (golf's 0.57 m at the tee, Putt Street's STANCE
 * of 0.45 for the putter). `length` is from where the swing turns, high in the chest, down to the
 * club's head, and `turn` how much the shoulders and head turn with it (hardly at all, putting).
 */
const SWINGS: Record<Club, { back: number; follow: number; followBack: number; lean: number; length: number; turn: number }> = {
  driver: { back: 2.4, follow: 2.5, followBack: 0, lean: 0.5, length: 1.04, turn: 1 },
  putter: { back: 1.1, follow: 0.06, followBack: 1.15, lean: 0.41, length: 0.98, turn: 0.15 },
};
/** Where the swing turns, high in the chest; the club's head is its length down from it. */
const SWING_AT = new THREE.Vector3(0, 0.95, 0.06);
/** The grip, down from where the swing turns. */
const GRIP = 0.36;
/** Down through the ball, holding the finish, and back to the ball again, in seconds. */
const DOWNSWING = 0.14;
const FINISH = 1;
const SETTLE = 0.5;
/** A swing all on its own (someone else's) takes the club back for this long first. */
export const BACKSWING_TIME = 0.45;
/** How long after the downswing starts the club meets the ball. */
export const IMPACT = 0.08;

const hands = new THREE.Vector3();
const armDir = new THREE.Vector3();

/** A golf club, hanging down from the hands (its grip at 0): a wrapped grip, a steel shaft and the head at the bottom, its face toward +x. */
function golfClub(club: Club): THREE.Group {
  const len = SWINGS[club].length - GRIP;
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.02, 0.017, 0.2, 8), toon('#2b2d42'), 0, -0.04, 0, false));
  g.add(mesh(new THREE.CylinderGeometry(0.011, 0.009, len - 0.05, 6), toon('#ced4da'), 0, -len / 2 - 0.05, 0, false));
  // A driver's chunky head, or a putter's flat blade, its face toward the hole.
  if (club === 'putter') g.add(mesh(new THREE.BoxGeometry(0.03, 0.028, 0.11), toon('#adb5bd'), 0.004, -len + 0.012, 0.025, false));
  else g.add(mesh(new THREE.BoxGeometry(0.05, 0.05, 0.12), toon('#8d99ae'), 0.005, -len, 0.03, false));
  return g;
}

/** The club in hand at the golf tee or on Putt Street, and the swing it's in (see the Person's `golf`). */
export interface Golf {
  swing: THREE.Group;
  club: Club;
  back: number;
  want: number;
  top: number;
  swingT: number;
  autoT: number;
  power: number;
}

/** The club's swing, turning high in the chest, with the club hanging down from the hands on it. */
export function clubSwing(club: Club = 'driver'): THREE.Group {
  const swing = new THREE.Group();
  swing.position.copy(SWING_AT);
  const g = golfClub(club);
  g.position.y = -GRIP;
  swing.add(g);
  return swing;
}

/** Down through the ball from wherever it was taken back to, up into the finish, and back to the ball. */
export function strike(g: Golf) {
  g.top = g.back;
  g.swingT = 0;
  g.autoT = -1;
}

/** The golf swing, over whatever the arms and legs were doing. */
export function swingStep(rig: PersonRig, g: Golf, dt: number) {
  const c = SWINGS[g.club];
  if (g.autoT >= 0) {
    g.autoT += dt;
    g.want = g.power * Math.min(1, g.autoT / BACKSWING_TIME);
    if (g.autoT >= BACKSWING_TIME) strike(g);
  }
  let phi: number;
  let finish = 0;
  // Through to the finish: as far as a driver goes, or as far through as a putter went back.
  const through = c.follow + c.followBack * g.top * c.back;
  if (g.swingT >= 0) {
    const s = (g.swingT += dt);
    if (s < DOWNSWING) {
      // Faster and faster down through the ball.
      const u = (s / DOWNSWING) ** 2;
      phi = THREE.MathUtils.lerp(-g.top * c.back, through, u);
      finish = Math.max(0, phi / through);
    } else if (s < DOWNSWING + FINISH) {
      phi = through;
      finish = 1;
    } else if (s < DOWNSWING + FINISH + SETTLE) {
      const u = (s - DOWNSWING - FINISH) / SETTLE;
      finish = 1 - u * u * (3 - 2 * u);
      phi = through * finish;
    } else {
      g.swingT = -1;
      g.back = g.want = 0;
      phi = 0;
    }
    if (g.swingT >= 0) g.back = 0;
  } else {
    g.back += (g.want - g.back) * Math.min(1, dt * 12);
    phi = -g.back * c.back;
  }
  g.swing.rotation.set(-c.lean, 0, phi);
  // Both hands on the grip, wherever the swing has it.
  const down = -Math.cos(phi) * GRIP;
  hands.set(SWING_AT.x + Math.sin(phi) * GRIP, SWING_AT.y + down * Math.cos(c.lean), SWING_AT.z - down * Math.sin(c.lean));
  for (const [arm, sx] of [
    [rig.armL, -0.33],
    [rig.armR, 0.33],
  ] as const) {
    armDir.set(hands.x - sx, hands.y - 0.9, hands.z).normalize();
    arm.quaternion.setFromUnitVectors(DOWN, armDir);
  }
  // Shoulders turned away on the way back, round to the hole at the finish; eyes on the ball until it's
  // gone (putting, they hardly turn, and the head stays down).
  const coil = Math.min(0, phi) / c.back;
  rig.body.rotation.y = (coil * 0.45 + finish * 0.5) * c.turn;
  rig.head.rotation.x = 0.4 * (1 - finish * c.turn) + 0.05;
  rig.head.rotation.y = (-coil * 0.35 + finish * 0.6) * c.turn;
  rig.legL.rotation.set(0, 0, -0.1);
  rig.legR.rotation.set(0, 0, 0.1);
}
