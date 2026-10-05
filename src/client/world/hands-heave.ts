import * as THREE from 'three';

/**
 * A one-armed heave from way out, in first person (see Hands, and shared/hoop-range.ts): the ball up in
 * your right hand by your ear, drawn further back as the meter winds, the left hand dropped out of the
 * way; then the arm comes over and through toward the hoop. Camera space: -z is forward.
 */
const COCKED = { at: new THREE.Vector3(0.34, 0.01, -0.48), turn: new THREE.Euler(1.05, 0.35, -0.6) };
/** As far back as the wind-up draws it, at the top of the meter. */
const DRAWN = new THREE.Vector3(0.4, 0.05, -0.41);
const THROWN = { at: new THREE.Vector3(0.04, -0.04, -0.62), turn: new THREE.Euler(0.35, 0.05, 0.15) };
const LEFT_AWAY = { at: new THREE.Vector3(-0.34, -0.38, -0.42), turn: new THREE.Euler(0.1, -0.3, 0.7) };
/** Where the ball sits, from the right hand: on its palm, the fingers behind it. */
const ON_PALM = new THREE.Vector3(-0.025, 0.115, -0.02);

const at = new THREE.Vector3();
const turn = new THREE.Euler();

/** Turns `g` `k` of the way from how it's turned to `to`. */
function turnTo(g: THREE.Object3D, to: THREE.Euler, k: number) {
  const r = g.rotation;
  r.set(r.x + (to.x - r.x) * k, r.y + (to.y - r.y) * k, r.z + (to.z - r.z) * k);
}

/**
 * Poses your hands (already placed for the frame) `k` of the way into a heave (0 to 1): wound up
 * `wind` of the way (0 to 1) and `out` through the throw (0 to 1 and back), the ball on the right palm.
 */
export function heavePose(right: THREE.Object3D, left: THREE.Object3D, ball: THREE.Object3D, k: number, wind: number, out: number) {
  if (k < 0.001) return;
  at.copy(COCKED.at).lerp(DRAWN, wind).lerp(THROWN.at, out);
  right.position.lerp(at, k);
  const c = COCKED.turn;
  const t = THROWN.turn;
  turn.set(THREE.MathUtils.lerp(c.x + 0.2 * wind, t.x, out), THREE.MathUtils.lerp(c.y, t.y, out), THREE.MathUtils.lerp(c.z, t.z, out));
  turnTo(right, turn, k);
  left.position.lerp(LEFT_AWAY.at, k);
  turnTo(left, LEFT_AWAY.turn, k);
  ball.position.lerp(at.copy(right.position).add(ON_PALM), k);
}
