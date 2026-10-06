import { SURFACES, groundAt, type Surface } from './car-ground.js';
import { FLOOR, ROAD, WALL_T } from './layout.js';
import { STREET_END, onLoop } from './scenic.js';

// The Lambos and Ferraris in the garage, which anyone can drive: where they're parked, where the road
// is (the garage, the lots round it, the street and the scenic loop off either end of it) and where
// else they go (off it, across the grass, see shared/car-ground.ts), and the arcade physics a driver's
// own page runs: flat out at well over 200 km/h, sliding when it turns harder than the tyres hold, and
// drifting on the handbrake. Everyone else on the floor sees the car where its driver says it is.

export type CarKind = 'lambo' | 'ferrari';

/** A car's footprint (nose to tail along its length), and how high its body and its roof come up. */
export const CAR = { length: 4.6, width: 2, body: 0.82, roof: 1.12 } as const;

/** The building's footprint, walls included: the garage is under it. */
const B = { minX: FLOOR.minX - WALL_T, maxX: FLOOR.maxX + WALL_T, minZ: FLOOR.minZ - WALL_T, maxZ: FLOOR.maxZ + WALL_T } as const;

/** Somewhere flat on the ground, x and z. */
export interface Box {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** The paved lot in front of the garage, out to the sidewalk, and the one down its east side. */
export const LOT: Box = { minX: -30, maxX: 30, minZ: B.maxZ, maxZ: 21 };
export const SIDE_LOT: Box = { minX: B.maxX, maxX: B.maxX + 12, minZ: B.minZ - 2, maxZ: B.maxZ + 4 };

/**
 * Where a car can go, besides the scenic loop (see shared/scenic.ts), which takes over from either
 * end of the street: the garage (inside its back and west walls, open to the south and east), the
 * lots round it, across the sidewalk and along the street. What stands on them (columns, lamps,
 * trees, the other cars) is the driver's page to bump into.
 */
export const PAVEMENT: Box[] = [
  { minX: FLOOR.minX, maxX: B.maxX, minZ: FLOOR.minZ, maxZ: B.maxZ },
  { ...LOT, maxZ: ROAD.minZ },
  SIDE_LOT,
  { minX: -STREET_END, maxX: STREET_END, minZ: ROAD.minZ, maxZ: ROAD.maxZ },
];

export interface CarDef {
  kind: CarKind;
  color: string;
  /** What the hint calls it: "Orange Lambo". */
  name: string;
  /** Its spot: where it's parked when the office starts, and which way its nose points (0 is +z). */
  x: number;
  z: number;
  rotY: number;
}

// Lambos nose-in along the back wall, Ferraris backed in facing the street, and one out front.
const BACK = B.minZ + WALL_T + 0.4 + CAR.length / 2;
const FRONT = B.maxZ - 0.5 - CAR.length / 2;
export const CARS: readonly CarDef[] = [
  { kind: 'lambo', color: '#8ac926', name: 'Lime Lambo', x: -14.4, z: BACK, rotY: Math.PI },
  { kind: 'lambo', color: '#ff7b00', name: 'Orange Lambo', x: -8, z: BACK, rotY: Math.PI },
  { kind: 'lambo', color: '#ffd000', name: 'Yellow Lambo', x: 1.6, z: BACK, rotY: Math.PI },
  { kind: 'lambo', color: '#7b2cbf', name: 'Purple Lambo', x: 11.2, z: BACK, rotY: Math.PI },
  { kind: 'ferrari', color: '#d90429', name: 'Red Ferrari', x: -14.4, z: FRONT, rotY: 0 },
  { kind: 'ferrari', color: '#d90429', name: 'Rosso Ferrari', x: -4.8, z: FRONT, rotY: 0 },
  { kind: 'ferrari', color: '#ffc300', name: 'Giallo Ferrari', x: 4.8, z: FRONT, rotY: 0 },
  { kind: 'ferrari', color: '#e5383b', name: 'Scarlet Ferrari', x: 14.4, z: FRONT, rotY: 0 },
  // Left out front, for everyone upstairs to look at.
  { kind: 'lambo', color: '#00b4d8', name: 'Blue Lambo', x: 9, z: 18.2, rotY: Math.PI / 2 },
];

export type CarSeat = 'driver' | 'passenger';

/**
 * Where the two of you sit, in the car's own frame (x across, +x on the driver's left side; z toward
 * the nose), and how high your hips are off the ground. Your head's up out of the top: with anyone
 * in it, the roof comes off.
 */
export const SEATS: Record<CarSeat, { x: number; z: number }> = { driver: { x: 0.42, z: -0.5 }, passenger: { x: -0.42, z: -0.5 } };
export const SEAT_HIPS = 0.45;

/** A car where it is and how it's going: `speed` in m/s along its nose (negative in reverse), `steer` the front wheels' angle (+ is left). */
export interface CarPose {
  x: number;
  z: number;
  rotY: number;
  speed: number;
  steer: number;
  /** How fast it's sliding sideways (m/s, + toward its left): in a drift, or knocked from the side. */
  slip?: number;
  /** How fast it's turning (radians a second, + to the left): its own steering, or spun round in a crash. */
  spin?: number;
}

/** A car as the office has it: where it is, and who's in it (PeerInfo ids). */
export interface CarState extends CarPose {
  driver?: string;
  passenger?: string;
  /** Whose page drives it when nobody's in it (a PeerInfo id): a racer it's put on the grid (see shared/race.ts). */
  bot?: string;
}

/** Every car in its spot, as the office starts. */
export function parked(): CarState[] {
  return CARS.map((c) => ({ x: c.x, z: c.z, rotY: c.rotY, speed: 0, steer: 0 }));
}

/**
 * The pedals and the wheel: `gas` 1 forward, -1 back (braking first if you're going the other way),
 * `turn` +1 hard left, `brake` the handbrake (it slows the car, and with the wheel turned the back
 * comes round in a drift), and `boost` the nitro, for a higher top speed while the gas is down.
 */
export interface Pedals {
  gas: number;
  turn: number;
  brake: boolean;
  boost?: boolean;
}

export const DRIVE = {
  /** Flat out on the road, and with the boost (m/s): 223 and 310 km/h. Off the road it's less (see Surface.top). */
  top: 62,
  boostTop: 86,
  reverse: 12,
  /** Off the line on the gas, and with the boost (m/s²): less and less as it nears its top speed. */
  accel: 15,
  boostAccel: 24,
  reverseAccel: 7,
  /** The brakes (S going forward), the handbrake, and rolling with nothing pressed (m/s²). */
  brake: 32,
  handbrake: 11,
  coast: 3,
  /** Between the axles (m): how tight it turns. */
  wheelbase: 2.8,
  /** How far the front wheels turn at a crawl (radians): less the faster you go. */
  steer: 0.6,
  /** How fast they turn (radians a second). */
  steerRate: 3.2,
  /** The most the tyres hold sideways on the road (m/s²): turn harder than that and the car runs wide. */
  grip: 28,
  /** How fast a slide sideways dies away while the tyres hold (m/s²), and on the handbrake. */
  hold: 45,
  drift: 6,
  /** How quickly its turning follows the wheel (1/s). */
  yawRate: 9,
  /** The fastest it spins on the handbrake (radians a second). */
  driftSpin: 2.4,
} as const;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** How far the front wheels can turn at `speed`. */
export function steerLimit(speed: number): number {
  return DRIVE.steer / (1 + Math.abs(speed) / 14);
}

/** The tightest a car corners at `speed` on `ground` without sliding (m): the tyres' grip, or the wheel's lock. */
export function turnRadius(speed: number, ground: Surface = SURFACES.road): number {
  const v = Math.max(0.1, Math.abs(speed));
  return Math.max(DRIVE.wheelbase / Math.tan(steerLimit(v)), (v * v) / (DRIVE.grip * ground.grip));
}

/**
 * The car `dt` seconds on, with these pedals, on `ground`: a bicycle model whose turning is as much as
 * the tyres hold. The way the car's going in the world doesn't turn with it by itself, so what it turns
 * out from under becomes a slide sideways, which the tyres then pull back into line: quickly when they
 * grip, hardly at all on the handbrake. A knock (slip and spin from a crash) dies away the same way.
 */
export function drive(p: CarPose, pedals: Pedals, dt: number, ground: Surface = SURFACES.road): CarPose {
  const want = clamp(pedals.turn, -1, 1) * steerLimit(p.speed);
  const steer = p.steer + clamp(want - p.steer, -DRIVE.steerRate * dt, DRIVE.steerRate * dt);
  let v = p.speed;
  let slip = p.slip ?? 0;
  let spin = p.spin ?? 0;
  const toward = (target: number, rate: number) => (v += clamp(target - v, -rate * dt, rate * dt));
  const gas = clamp(pedals.gas, -1, 1);
  const boost = !!pedals.boost && gas > 0;
  const top = (boost ? DRIVE.boostTop : DRIVE.top) * ground.top;
  const back = DRIVE.reverse * ground.top;
  const roll = DRIVE.coast + ground.drag;
  if (gas > 0) {
    if (v < 0) toward(0, DRIVE.brake * ground.grip);
    else if (v < top) v = Math.min(top, v + (boost ? DRIVE.boostAccel : DRIVE.accel) * gas * (1 - 0.65 * (v / top)) * dt);
    // Faster than it can go here (run off the road, the boost let go): it eases down to it.
    else toward(top, roll + 4);
  } else if (gas < 0) {
    if (v > 0) toward(0, DRIVE.brake * ground.grip);
    else if (v > -back) v = Math.max(-back, v + DRIVE.reverseAccel * gas * dt);
    else toward(-back, roll + 4);
  } else toward(0, roll);
  const sliding = pedals.brake && Math.abs(v) > 4;
  if (pedals.brake) toward(0, DRIVE.handbrake * Math.max(0.5, ground.grip));
  // Turning: as the wheel says, as far as the tyres hold; on the handbrake the back comes round past that.
  const bike = (v * Math.tan(steer)) / DRIVE.wheelbase;
  const most = (DRIVE.grip * ground.grip) / Math.max(4, Math.abs(v));
  const target = sliding ? clamp(bike * 1.3, -DRIVE.driftSpin, DRIVE.driftSpin) : clamp(bike, -most, most);
  spin += (target - spin) * Math.min(1, DRIVE.yawRate * ground.grip * dt);
  if (Math.abs(spin) < 1e-4 && !target) spin = 0;
  const heading = p.rotY + spin * dt;
  // Its velocity in the world (along its nose, and sideways to its left), seen from where its nose points now.
  const s0 = Math.sin(p.rotY), c0 = Math.cos(p.rotY);
  const vx = s0 * v + c0 * slip;
  const vz = c0 * v - s0 * slip;
  const s1 = Math.sin(heading), c1 = Math.cos(heading);
  v = vx * s1 + vz * c1;
  slip = vx * c1 - vz * s1;
  const hold = (sliding ? DRIVE.drift : DRIVE.hold) * ground.grip;
  slip -= clamp(slip, -hold * dt, hold * dt);
  if (Math.abs(slip) < 1e-3) slip = 0;
  if (Math.abs(v) < 1e-3 && gas === 0) v = 0;
  return {
    x: p.x + (s1 * v + c1 * slip) * dt,
    z: p.z + (c1 * v - s1 * slip) * dt,
    rotY: wrap(heading),
    speed: v,
    steer,
    slip,
    spin,
  };
}

/** A point in the car's own frame (x across, +x left; z toward the nose), out in the world. */
export function carPoint(p: { x: number; z: number; rotY: number }, lx: number, lz: number): { x: number; z: number } {
  const s = Math.sin(p.rotY);
  const c = Math.cos(p.rotY);
  return { x: p.x + lx * c + lz * s, z: p.z - lx * s + lz * c };
}

/** Whether (x, z) is somewhere a car can be: the garage, the lots, the street or the loop. */
export function paved(x: number, z: number): boolean {
  return PAVEMENT.some((b) => x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) || onLoop(x, z);
}

/** Whether the whole car is on the pavement: its corners, and halfway along each side. */
export function onPavement(p: { x: number; z: number; rotY: number }): boolean {
  const w = CAR.width / 2;
  const l = CAR.length / 2;
  for (const [lx, lz] of [
    [w, l],
    [-w, l],
    [w, -l],
    [-w, -l],
    [w, 0],
    [-w, 0],
    [0, l],
    [0, -l],
  ]) {
    const at = carPoint(p, lx, lz);
    if (!paved(at.x, at.z)) return false;
  }
  return true;
}

/** Whether (x, z) is somewhere a car can be at all: the road, or the ground off it (not the sea, the lake, or off the map). */
export function drivable(x: number, z: number): boolean {
  return groundAt(x, z, paved(x, z)) !== null;
}

/** Whether the whole car is somewhere it can be: its corners, and halfway along each side, on the road or the ground. */
export function onGround(p: { x: number; z: number; rotY: number }): boolean {
  const w = CAR.width / 2;
  const l = CAR.length / 2;
  for (const [lx, lz] of [
    [w, l],
    [-w, l],
    [w, -l],
    [-w, -l],
    [w, 0],
    [-w, 0],
  ]) {
    const at = carPoint(p, lx, lz);
    if (!drivable(at.x, at.z)) return false;
  }
  return true;
}

/** What's under the car's wheels, between them: half off the road, it has half the road's grip. Null where it can't be. */
export function groundUnder(p: { x: number; z: number; rotY: number }): Surface | null {
  let grip = 0, top = 0, drag = 0;
  let worst: Surface | null = null;
  for (const [lx, lz] of [
    [0.8, 1.4],
    [-0.8, 1.4],
    [0.8, -1.4],
    [-0.8, -1.4],
  ]) {
    const at = carPoint(p, lx, lz);
    const g = groundAt(at.x, at.z, paved(at.x, at.z));
    if (!g) return null;
    grip += g.grip / 4;
    top += g.top / 4;
    drag += g.drag / 4;
    if (!worst || g.grip < worst.grip) worst = g;
  }
  return { name: worst!.name, grip, top, drag };
}

/** Whether the car's footprint (a rectangle turned by rotY) overlaps box `b` (separating axes). */
export function overlaps(p: { x: number; z: number; rotY: number }, b: Box): boolean {
  const hx = CAR.width / 2;
  const hz = CAR.length / 2;
  const ex = (b.maxX - b.minX) / 2;
  const ez = (b.maxZ - b.minZ) / 2;
  const dx = (b.minX + b.maxX) / 2 - p.x;
  const dz = (b.minZ + b.maxZ) / 2 - p.z;
  const s = Math.abs(Math.sin(p.rotY));
  const c = Math.abs(Math.cos(p.rotY));
  if (Math.abs(dx) >= c * hx + s * hz + ex) return false;
  if (Math.abs(dz) >= s * hx + c * hz + ez) return false;
  const sn = Math.sin(p.rotY);
  const cs = Math.cos(p.rotY);
  // Across the car, and along it.
  if (Math.abs(dx * cs - dz * sn) >= hx + ex * c + ez * s) return false;
  if (Math.abs(dx * sn + dz * cs) >= hz + ex * s + ez * c) return false;
  return true;
}

/** Whether the car can be at `p`: on the road or the ground off it, clear of all of `solids`. */
export function carFits(p: { x: number; z: number; rotY: number }, solids: Iterable<Box>): boolean {
  if (!onGround(p)) return false;
  for (const b of solids) if (overlaps(p, b)) return false;
  return true;
}
