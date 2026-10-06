import { CAR, SEATS, carPoint, groundUnder, type CarPose, type CarSeat, type Pedals } from '../../../shared/garage';
import type { PlayerController } from '../../player';
import { stepCar, type StepEvents, type StepWorld } from './physics';
import type { Fleet } from './world';

// Driving the cars in the garage: E at one gets you in (behind the wheel, or beside whoever's
// there), and it takes hold of you (PlayerController.rig) until you get out. The driver's page runs
// the car (shared/garage.ts, features/cars/physics.ts) and tells the office where it's got to;
// everyone else's follows it. Shift is the boost while there's any left in it, Space the handbrake.

export interface DriveHooks {
  /** The car you're driving has got to `pose`: tell the office, for everyone else on the floor. */
  moved(car: number, pose: CarPose): void;
  /** What it runs into, and what happens when it does (traffic.ts). */
  world(): StepWorld;
  events(car: number): StepEvents;
  /** Held where it is, brakes on, till a race's lights go out. */
  held(): boolean;
}

/** How often the office hears where your car is, at most (seconds). */
const SEND_EVERY = 0.066;
/** How long a full boost lasts (seconds), and how long it takes to fill up again off it. */
const BOOST_LASTS = 4;
const BOOST_FILLS = 12;

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class Driver {
  /** The car you're in (its place in CARS), and your seat; null on your feet. */
  car: number | null = null;
  seat: CarSeat | null = null;
  /** How hard you're on the gas (-1 in reverse), for the engine. */
  gas = 0;
  /** How much boost is left (0 to 1), whether it's on now, and what's under the wheels. */
  nitro = 1;
  boosting = false;
  ground = 'road';
  /** Seconds behind the wheel (or beside it), for how often things happen. */
  private clock = 0;
  private sent = { at: -Infinity, x: 0, z: 0, rotY: 0, speed: 0, steer: 0 };
  /** The way the car pointed last frame, to turn a first-person view along with it. */
  private yaw = 0;
  /** How the third-person camera was before you got in: it pulls back to see the car. */
  private camWas: { dist: number; pitch: number } | null = null;

  constructor(
    private player: PlayerController,
    private fleet: Fleet,
    private hooks: DriveHooks,
  ) {}

  get active(): boolean {
    return this.car !== null;
  }

  /** Behind the wheel, rather than beside it. */
  get driving(): boolean {
    return this.seat === 'driver';
  }

  /** The car you're in, as it's drawn. */
  get pose(): CarPose | null {
    return this.car === null ? null : this.fleet.cars[this.car].pose;
  }

  /** Gets into `seat` of car `car`, looking out over its hood. */
  enter(car: number, seat: CarSeat) {
    const v = this.fleet.cars[car];
    if (this.active || !v) return;
    this.car = car;
    this.seat = seat;
    this.gas = 0;
    const p = this.player;
    p.stopWalking();
    p.moving = false;
    p.vy = 0;
    this.yaw = v.pose.rotY;
    if (p.view === 'first') {
      p.camYaw = v.pose.rotY + Math.PI;
      p.lookPitch = -0.12;
    } else {
      this.camWas = { dist: p.camDist, pitch: p.camPitch };
      p.camDist = Math.max(p.camDist, 9);
      p.camPitch = Math.min(p.camPitch, 0.32);
      p.camYaw = v.pose.rotY + Math.PI;
    }
    p.rig = (dt) => this.step(dt);
    p.riding = true;
    this.sit(0);
  }

  /**
   * Where you'd be getting out: by your own door, else the other one, else behind the car or in
   * front of it. Null if there's no room anywhere (or you're not in a car).
   */
  wayOut(): { x: number; y: number; z: number } | null {
    const car = this.car;
    const seat = this.seat;
    if (car === null || seat === null) return null;
    const pose = this.fleet.cars[car].pose;
    const y = this.fleet.seatAt(car, seat)!.y;
    const s = SEATS[seat];
    // Far enough out to clear the car's boxes at any angle (turned, they stick out past its sides).
    const out = CAR.width / 2 + 0.8;
    const side = Math.sign(s.x);
    for (const [lx, lz] of [
      [side * out, s.z],
      [side * out, 0.9],
      [-side * out, s.z],
      [0, -CAR.length / 2 - 0.6],
      [0, CAR.length / 2 + 0.6],
    ]) {
      const q = carPoint(pose, lx, lz);
      if (this.player.fits(q.x, q.z, y)) return { x: q.x, y, z: q.z };
    }
    return null;
  }

  /** Out onto your feet beside the car (see wayOut). False if there's no room, unless `anyway` (you stand up where you sat). */
  leave(anyway = false): boolean {
    const pose = this.pose;
    if (!pose) return true;
    const at = this.wayOut();
    if (!at && !anyway) return false;
    this.drop();
    const p = this.player;
    if (at) p.pos.set(at.x, at.y, at.z);
    p.facing = pose.rotY;
    p.camYaw = pose.rotY + Math.PI;
    p.lookPitch = -0.08;
    return true;
  }

  /** Lets go of the car where you are (something else is moving you: another floor, a desk): driving, it stops there. */
  drop() {
    const car = this.car;
    if (car === null) return;
    if (this.driving) {
      const pose = { ...this.fleet.cars[car].pose, speed: 0 };
      this.fleet.place(car, pose);
      this.hooks.moved(car, pose);
    }
    const p = this.player;
    p.rig = null;
    p.riding = false;
    if (this.camWas) {
      p.camDist = this.camWas.dist;
      p.camPitch = this.camWas.pitch;
      this.camWas = null;
    }
    this.car = null;
    this.seat = null;
    this.gas = 0;
  }

  /** Each frame in the car: drive it (behind the wheel), and sit in your seat wherever it's got to. */
  private step(dt: number) {
    const car = this.car!;
    this.clock += dt;
    if (this.driving) {
      const p = this.player;
      const held = this.hooks.held();
      const gas = held ? 0 : (p.holding('KeyW', 'ArrowUp') ? 1 : 0) - (p.holding('KeyS', 'ArrowDown') ? 1 : 0);
      this.boosting = gas > 0 && this.nitro > 0 && p.holding('ShiftLeft', 'ShiftRight');
      this.nitro = Math.min(1, Math.max(0, this.nitro + (this.boosting ? -dt / BOOST_LASTS : dt / BOOST_FILLS)));
      const pedals: Pedals = {
        gas,
        turn: (p.holding('KeyA', 'ArrowLeft') ? 1 : 0) - (p.holding('KeyD', 'ArrowRight') ? 1 : 0),
        brake: held || p.holding('Space'),
        boost: this.boosting,
      };
      this.gas = gas;
      const from = this.fleet.cars[car].pose;
      const pose = stepCar(car, from, pedals, dt, this.hooks.world(), this.hooks.events(car));
      this.ground = groundUnder(pose)?.name ?? 'grass';
      this.fleet.place(car, pose);
      this.send(car, pose);
    }
    this.sit(dt);
  }

  /** The car you're driving knocked (by another car) to `pose`. */
  knocked(pose: CarPose) {
    if (this.car === null || !this.driving) return;
    this.fleet.place(this.car, pose);
    this.send(this.car, pose, true);
  }

  /** The car you're driving set down at `at`, stopped: lined up on a race's grid. */
  teleport(at: { x: number; z: number; rotY: number }) {
    if (this.car === null || !this.driving) return;
    const pose: CarPose = { ...at, speed: 0, steer: 0, slip: 0, spin: 0 };
    this.fleet.place(this.car, pose);
    this.send(this.car, pose, true);
  }

  /** Tells the office where the car is, every so often while it's going (and once more when it stops); `now`, straight away. */
  private send(car: number, pose: CarPose, now = false) {
    const s = this.sent;
    const changed = Math.abs(pose.x - s.x) + Math.abs(pose.z - s.z) > 0.01 || Math.abs(wrap(pose.rotY - s.rotY)) > 0.004 || pose.speed !== s.speed || Math.abs(pose.steer - s.steer) > 0.02;
    if (!now && (!changed || this.clock - s.at < SEND_EVERY)) return;
    this.sent = { at: this.clock, x: pose.x, z: pose.z, rotY: pose.rotY, speed: pose.speed, steer: pose.steer };
    this.hooks.moved(car, pose);
  }

  /**
   * You in your seat, wherever the car's got to. In first person you look round from it, turning as
   * it turns; in third, the camera swings round behind it as it goes.
   */
  private sit(dt: number) {
    const p = this.player;
    const at = this.fleet.seatAt(this.car!, this.seat!)!;
    p.pos.set(at.x, at.y, at.z);
    p.facing = at.rotY;
    p.moving = false;
    const turned = wrap(at.rotY - this.yaw);
    this.yaw = at.rotY;
    if (p.view === 'first') p.camYaw += turned;
    else {
      const speed = Math.abs(this.fleet.cars[this.car!].pose.speed);
      const k = Math.min(1, dt * 2.5 * Math.min(1, speed / 4));
      p.camYaw += wrap(at.rotY + Math.PI - p.camYaw) * k;
    }
  }
}
