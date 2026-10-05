import * as THREE from 'three';
import { HELI } from '../../../shared/heli';
import type { StreetPoint } from '../../../shared/mainstreet';
import type { HeliPose } from '../../../shared/protocol';
import { noOutline } from '../../core/outline';
import { mergeByMaterial, mesh, roundedBox, textPlane, toon, toonUnique } from '../../world/toon';

// Friday One as it's drawn: a toon four-seat helicopter in Friday's ink with a signal-green stripe,
// built in code like the cars (cars/world.ts). In its own frame the origin is on the ground between
// the skids under the rotor's hub, y is up from the skids and the nose points down +z (shared/heli.ts).
// It leans (pitch and roll) about a point PIVOT up its middle, so the skids don't swing out under it.

/** How high up its middle it leans about, over the skids. */
export const PIVOT = 1.4;
/** The cabin bubble: an ellipsoid its size (HELI.cabin), its middle `y` over the skids and `z` ahead of the hub. */
const CAB = { a: HELI.cabin.width / 2, b: HELI.cabin.height / 2, c: HELI.cabin.length / 2, y: 0.35 + HELI.cabin.height / 2, z: HELI.cabin.z };
/** Where the canopy's glass gives way to paint: a little under the bubble's middle (radians down from its top). */
const BELT = 1.75;
/** The tail boom's axis, its end, and the tail rotor's hub on the left of the fin. */
const BOOM = { y: 1.72, from: -1.1, to: -6.45 };
const TAIL_HUB = { x: 0.16, y: 2.25, z: -6.62 };
/** Turns of the main rotor a second at full spin: two blades, so 13 blade passes a second (see sound.ts). */
export const ROTOR_TURNS = 6.5;
/** The tail rotor turns this many times faster. */
export const TAIL_GEAR = 4.6;

const INK = '#2b2d42';
const GREEN = '#2fbf71';

/** Friday One's model, in the parts that move. */
export interface HeliModel {
  /** At the pose's spot, PIVOT up, turned by its yaw and leaning by its pitch and roll (see poseHeli). */
  root: THREE.Group;
  /** The main rotor at its hub, turning about y; its two blades, and the blur they make at speed. */
  rotor: THREE.Group;
  blades: THREE.Object3D;
  disc: THREE.Mesh;
  /** The tail rotor, turning about x, and its blur. */
  tail: THREE.Group;
  tailBlades: THREE.Object3D;
  tailDisc: THREE.Mesh;
  /** The white strobe on the fin and the red beacon on the cowling, which flash while it's running. */
  strobe: THREE.MeshToonMaterial;
  beacon: THREE.MeshToonMaterial;
  discMat: THREE.MeshBasicMaterial;
  tailDiscMat: THREE.MeshBasicMaterial;
}

const UP = new THREE.Vector3(0, 1, 0);

/** A round tube from `a` to `b` (its own frame), `r` thick. */
function tube(a: readonly [number, number, number], b: readonly [number, number, number], r: number, mat: THREE.Material): THREE.Mesh {
  const from = new THREE.Vector3(...a);
  const d = new THREE.Vector3(...b).sub(from);
  const m = mesh(new THREE.CylinderGeometry(r, r, d.length(), 8), mat);
  m.position.copy(from).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(UP, d.normalize());
  return m;
}

/** A piece of the cabin's bubble: `phi` round it (0 is -x, π/2 the nose), `theta` down from its top; `grow` sits it just outside. */
function bubble(phi0: number, phiLen: number, theta0: number, thetaLen: number, grow = 1): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 40, 22, phi0, phiLen, theta0, thetaLen);
  g.scale(CAB.a * grow, CAB.b * grow, CAB.c * grow);
  g.translate(0, CAB.y, CAB.z);
  return g;
}

/** A frame round the bubble where it's `dz` ahead of its middle, up over the top from one side to the other (a pillar of the canopy). */
function pillar(dz: number, mat: THREE.Material): THREE.Mesh {
  const k = Math.sqrt(Math.max(0, 1 - (dz / CAB.c) ** 2)) * 1.004;
  const ring = new THREE.TorusGeometry(1, 0.035 / Math.max(k, 0.4), 6, 40, Math.PI + 0.5);
  ring.rotateZ(-0.25);
  ring.scale(CAB.a * k, CAB.b * k, 1);
  return mesh(ring, mat, 0, CAB.y, CAB.z + dz);
}

/** The flat side of a fin or a stabilizer: a polygon (z, y) in its own frame, `t` thick, across x. */
function fin(points: readonly (readonly [number, number])[], t: number, mat: THREE.Material): THREE.Mesh {
  const s = new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(z, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false });
  g.translate(0, 0, -t / 2);
  // The shape is drawn in (z, y): turn its x over to z.
  g.rotateY(-Math.PI / 2);
  return mesh(g, mat);
}

/** Friday One, its nose down +z and its skids on y = 0 (see HeliModel; poseHeli puts it somewhere). */
export function buildHeli(): HeliModel {
  const still = new THREE.Group();
  const ink = toon(INK);
  const green = toon(GREEN);
  const steel = toon('#4a4e69');
  const glass = toon('#30496b', { opacity: 0.42 });
  const seatMat = toon('#3d405b');
  const dash = toon('#1d1e2c');

  // The skids, upturned at the front, on two bent cross tubes.
  for (const sx of [-1, 1]) {
    const x = (sx * HELI.skids) / 2;
    still.add(tube([x, 0.06, -1.45], [x, 0.06, 1.75], 0.055, steel));
    still.add(tube([x, 0.06, 1.75], [x, 0.3, 2.08], 0.055, steel));
    for (const z of [1.05, -0.75]) still.add(tube([x, 0.06, z], [sx * 0.72, 0.5, z], 0.05, steel));
  }
  for (const z of [1.05, -0.75]) still.add(tube([-0.72, 0.5, z], [0.72, 0.5, z], 0.05, steel));

  // The bubble: tinted glass over the front and the sides, painted underneath and at the back (seen from
  // inside too, the tub you sit in, while the glass is clear from in there), and the green stripe round
  // it where the two meet.
  const shell = toonUnique(INK);
  shell.side = THREE.DoubleSide;
  still.add(mesh(bubble(-0.45, Math.PI + 0.9, 0, BELT), glass));
  still.add(mesh(bubble(Math.PI + 0.45, Math.PI - 0.9, 0, BELT), shell));
  still.add(mesh(bubble(0, Math.PI * 2, BELT, Math.PI - BELT), shell));
  still.add(mesh(bubble(0, Math.PI * 2, BELT + 0.02, 0.15, 1.012), green));
  // The canopy's frame between the doors.
  still.add(pillar(0.05, ink));
  // Door handles, front and back on both sides.
  for (const sx of [-1, 1]) for (const z of [0.95, -0.2]) still.add(mesh(new THREE.BoxGeometry(0.05, 0.05, 0.22), steel, sx * (CAB.a - 0.08), 1.18, z));

  // Inside, through the glass: the instrument panel and four seats.
  still.add(mesh(roundedBox(1.05, 0.3, 0.36, 0.08), dash, 0, 1.24, 1.66));
  for (const s of HELI.seats) {
    still.add(mesh(new THREE.BoxGeometry(0.52, 0.12, 0.5), seatMat, s.x, s.y - 0.06, s.z));
    const back = mesh(new THREE.BoxGeometry(0.52, 0.68, 0.1), seatMat, s.x, s.y + 0.32, s.z - 0.3);
    back.rotation.x = -0.12;
    still.add(back);
  }

  // The engine's cowling on the cabin's back, and the mast up to the hub.
  still.add(mesh(roundedBox(1.05, 0.5, 1.7, 0.2), ink, 0, CAB.y + CAB.b - 0.12, -0.4));
  still.add(mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.42, 10), steel, 0, HELI.hub - 0.2, 0));

  // The tail boom, tapering to the fin, with its fin above and below and a stabilizer across it.
  const boomLen = BOOM.from - BOOM.to;
  const boom = new THREE.CylinderGeometry(0.13, 0.3, boomLen, 14).rotateX(Math.PI / 2);
  still.add(mesh(boom, ink, 0, BOOM.y, (BOOM.from + BOOM.to) / 2));
  still.add(fin([[-5.95, 1.8], [-6.55, 3.05], [-7.05, 3.05], [-6.8, 1.8]], 0.07, ink));
  still.add(fin([[-6.25, 1.65], [-6.75, 1.05], [-6.98, 1.1], [-6.8, 1.65]], 0.06, ink));
  still.add(fin([[-6.55, 3.05], [-7.05, 3.05], [-7.0, 2.9], [-6.6, 2.9]], 0.08, green));
  still.add(mesh(new THREE.BoxGeometry(1.7, 0.05, 0.42), ink, 0, BOOM.y, -5.75));
  // The tail rotor's gearbox.
  still.add(mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.2, 8).rotateZ(Math.PI / 2), steel, TAIL_HUB.x - 0.08, TAIL_HUB.y, TAIL_HUB.z));

  // Nav lights: red on the left (port) end of the stabilizer, green on the right, glowing day and night
  // without a lamp of their own; and the white strobe on the fin and the red beacon on the cowling.
  still.add(mesh(new THREE.SphereGeometry(0.07, 8, 6), toon('#ff3b30', { emissive: '#d0021b' }), 0.88, BOOM.y, -5.75, false));
  still.add(mesh(new THREE.SphereGeometry(0.07, 8, 6), toon('#34c759', { emissive: '#1d9e46' }), -0.88, BOOM.y, -5.75, false));
  const strobe = toonUnique('#ffffff');
  strobe.emissive.set('#ffffff');
  const beacon = toonUnique('#ff3b30');
  beacon.emissive.set('#ff2d20');
  const flashers = new THREE.Group();
  flashers.add(mesh(new THREE.SphereGeometry(0.07, 8, 6), strobe, 0, 3.1, -6.85, false));
  flashers.add(mesh(new THREE.SphereGeometry(0.09, 8, 6), beacon, 0, CAB.y + CAB.b + 0.15, -0.95, false));

  // FRIDAY ONE down both sides of the boom, by the cabin.
  const name = textPlane('FRIDAY ONE', { color: '#ffffff', bg: GREEN, border: INK, size: 48 });
  name.scale.setScalar(0.62);
  const names = new THREE.Group();
  for (const sx of [-1, 1]) {
    const n = sx > 0 ? name : new THREE.Mesh(name.geometry, name.material);
    n.scale.setScalar(0.62);
    n.position.set(sx * 0.27, BOOM.y + 0.02, -2.35);
    n.rotation.y = (sx * Math.PI) / 2;
    names.add(n);
  }

  // The main rotor: two long blades on the hub, and the blur disc they become at speed.
  const rotor = new THREE.Group();
  rotor.position.y = HELI.hub;
  const blades = new THREE.Group();
  const blade = mesh(new THREE.BoxGeometry(HELI.rotor * 2 - 0.1, 0.04, 0.26), ink);
  blades.add(blade, mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.14, 12), steel), mesh(new THREE.BoxGeometry(0.5, 0.06, 0.3), green, HELI.rotor - 0.3, 0.005, 0, false), mesh(new THREE.BoxGeometry(0.5, 0.06, 0.3), green, -HELI.rotor + 0.3, 0.005, 0, false));
  const discMat = new THREE.MeshBasicMaterial({ color: '#3a3d55', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(HELI.rotor, 48).rotateX(-Math.PI / 2), discMat);
  disc.renderOrder = 2;
  rotor.add(blades, disc);

  // The tail rotor, on the fin's left side, turning about x.
  const tail = new THREE.Group();
  tail.position.set(TAIL_HUB.x, TAIL_HUB.y, TAIL_HUB.z);
  const tailBlades = new THREE.Group();
  tailBlades.add(mesh(new THREE.BoxGeometry(0.03, HELI.tailRotor * 2, 0.11), ink), mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.06, 8).rotateZ(Math.PI / 2), steel));
  const tailDiscMat = discMat.clone();
  const tailDisc = new THREE.Mesh(new THREE.CircleGeometry(HELI.tailRotor, 24).rotateY(Math.PI / 2), tailDiscMat);
  tailDisc.renderOrder = 2;
  tail.add(tailBlades, tailDisc);

  const body = new THREE.Group();
  body.position.y = -PIVOT;
  body.add(mergeByMaterial(still), flashers, names, rotor, tail);
  const root = new THREE.Group();
  root.rotation.order = 'YXZ';
  root.add(body);
  noOutline(root);
  return { root, rotor, blades, disc, tail, tailBlades, tailDisc, strobe, beacon, discMat, tailDiscMat };
}

/** Where its blades blur into a disc, by spin: none below `from`, all of it from `to`. */
const BLUR = { from: 0.6, to: 0.8 } as const;

/**
 * Puts the model at `pose`, its skids `base` up the frame it's drawn in (the street's height there),
 * with the rotor turned to `angle` (radians round) at `spin`; `t` (seconds) flashes the lights.
 */
export function poseHeli(m: HeliModel, pose: HeliPose, base: number, angle: number, spin: number, t: number) {
  m.root.position.set(pose.x, base + pose.h + PIVOT, pose.z);
  m.root.rotation.set(pose.pitch, pose.yaw, pose.roll);
  m.rotor.rotation.y = angle;
  m.tail.rotation.x = angle * TAIL_GEAR;
  const blur = THREE.MathUtils.smoothstep(spin, BLUR.from, BLUR.to);
  m.blades.visible = m.tailBlades.visible = blur < 0.97;
  m.disc.visible = m.tailDisc.visible = blur > 0.02;
  m.discMat.opacity = 0.3 * blur;
  m.tailDiscMat.opacity = 0.38 * blur;
  // Running, the strobe flashes twice a second or so and the beacon once; still, they're off.
  const on = spin > 0.04;
  m.strobe.emissiveIntensity = on && t % 1.1 < 0.07 ? 3 : 0;
  m.beacon.emissiveIntensity = on && (t + 0.4) % 1.6 < 0.5 ? 1.6 : 0.05;
}

const euler = new THREE.Euler(0, 0, 0, 'YXZ');
const turn = new THREE.Quaternion();
const v = new THREE.Vector3();

/**
 * A point in its own frame (x, y up from the skids, z) in the street frame, leaning with it as the
 * model does (poseHeli); into `out`, so asking makes nothing new.
 */
export function heliPoint(pose: HeliPose, x: number, y: number, z: number, out: StreetPoint): StreetPoint {
  euler.set(pose.pitch, pose.yaw, pose.roll);
  turn.setFromEuler(euler);
  v.set(x, y - PIVOT, z).applyQuaternion(turn);
  out.x = pose.x + v.x;
  out.h = pose.h + PIVOT + v.y;
  out.z = pose.z + v.z;
  return out;
}

/** The way it's turned and leaning, as a rotation (into `out`): what the cockpit's view turns with. */
export function heliTurn(pose: HeliPose, out: THREE.Quaternion): THREE.Quaternion {
  euler.set(pose.pitch, pose.yaw, pose.roll);
  return out.setFromEuler(euler);
}
