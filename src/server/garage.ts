import { CARS, DRIVE, drivable, parked, type CarPose, type CarSeat, type CarState } from '../shared/garage.js';
import type { Race } from './race.js';

/** How often one person can honk, at most (ms). */
const HONK_EVERY = 250;
/** How far a car rolling from a knock can go between two words from the page rolling it (m). */
const PUSH_REACH = 30;
/** How near a car has to be to another to have run into it (m). */
const HIT_REACH = 14;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * A floor's cars: who's in each one, and where its driver last said it is. Each driver's page drives
 * its own car (see shared/garage.ts) and the office passes it on. Nothing is saved: when the office
 * restarts, every car is back in its spot.
 */
export class Garage {
  private cars = parked();
  private honked = new Map<string, number>();
  /** The race on the floor, lining up, under way or just over (see server/race.ts). */
  race?: Race;

  constructor(private now = () => Date.now()) {}

  /** Every car as it is now, for the floor's pages. */
  state(): CarState[] {
    return this.cars.map((c) => ({ ...c }));
  }

  /** The car `id` is in, and which seat. */
  seatOf(id: string): { car: number; seat: CarSeat } | undefined {
    for (let i = 0; i < this.cars.length; i++) {
      if (this.cars[i].driver === id) return { car: i, seat: 'driver' };
      if (this.cars[i].passenger === id) return { car: i, seat: 'passenger' };
    }
    return undefined;
  }

  /** `id` gets into `seat` of car `car`, out of wherever they were: only if it's free, and no bot's racing it. Says whether anything changed. */
  enter(id: string, car: number, seat: CarSeat): boolean {
    const c = this.cars[car];
    if (!c || (seat !== 'driver' && seat !== 'passenger') || c[seat] || c.bot) return false;
    this.leave(id);
    c[seat] = id;
    return true;
  }

  /** `id` gets out (or left the floor, or the office). A car nobody's driving stops where it is. Says whether they were in one. */
  leave(id: string): boolean {
    this.honked.delete(id);
    const at = this.seatOf(id);
    if (!at) return false;
    const c = this.cars[at.car];
    delete c[at.seat];
    if (at.seat === 'driver') Object.assign(c, { speed: 0, steer: 0, slip: 0, spin: 0 });
    return true;
  }

  /**
   * The driver of car `car` (or the page running its bot) says where it's got to: where the office has
   * it now, to pass on. Nothing from anyone else, or from anywhere a car can't be.
   */
  drive(id: string, car: number, pose: CarPose): CarPose | undefined {
    const c = this.cars[car];
    if (!c || (c.driver ? c.driver !== id : c.bot !== id)) return undefined;
    return this.put(c, pose);
  }

  /**
   * Car `car`, which nobody's in, rolling from a knock, as the page that knocked it says (one with a car
   * of its own going, at the wheel or racing a bot): only so far from where it was.
   */
  push(id: string, car: number, pose: CarPose): CarPose | undefined {
    const c = this.cars[car];
    if (!c || c.driver || (c.bot && c.bot !== id) || !this.drives(id)) return undefined;
    if (!(Math.hypot(pose.x - c.x, pose.z - c.z) <= PUSH_REACH)) return undefined;
    return this.put(c, pose);
  }

  /** Whose page drives car `car`: whoever's at its wheel, else whoever's racing a bot in it. */
  controller(car: number): string | undefined {
    const c = this.cars[car];
    return c?.driver ?? c?.bot;
  }

  /** `id`'s car `by` ran into car `car`: the page to tell (its driver's, or its bot's), if it's somebody else's and near enough. */
  hit(id: string, car: number, by: number): string | undefined {
    const a = this.cars[by];
    const b = this.cars[car];
    if (!a || !b || car === by || this.controller(by) !== id) return undefined;
    const to = this.controller(car);
    return to && to !== id && Math.hypot(a.x - b.x, a.z - b.z) <= HIT_REACH ? to : undefined;
  }

  /** Whether `id` has a car going: at a wheel, or racing a bot. */
  drives(id: string): boolean {
    return this.cars.some((c) => c.driver === id || c.bot === id);
  }

  /** Whether nobody's in car `car` and no bot's racing it. */
  free(car: number): boolean {
    const c = this.cars[car];
    return !!c && !c.driver && !c.passenger && !c.bot;
  }

  /** Car `car` raced by a bot from `id`'s page, lined up at `at`; or (no `id`) its bot's done, and it's back in its spot. */
  setBot(car: number, id: string | undefined, at?: { x: number; z: number; rotY: number }) {
    const c = this.cars[car];
    if (!c) return;
    if (id) c.bot = id;
    else {
      delete c.bot;
      const home = CARS[car];
      if (!c.driver && !c.passenger) Object.assign(c, { x: home.x, z: home.z, rotY: home.rotY });
    }
    if (at) Object.assign(c, at);
    Object.assign(c, { speed: 0, steer: 0, slip: 0, spin: 0 });
  }

  /** Puts car `car` at `at`, stopped (lining up on the grid). */
  place(car: number, at: { x: number; z: number; rotY: number }) {
    const c = this.cars[car];
    if (c) Object.assign(c, at, { speed: 0, steer: 0, slip: 0, spin: 0 });
  }

  private put(c: CarState, pose: CarPose): CarPose | undefined {
    const { x, z, rotY, speed, steer } = pose;
    const slip = pose.slip ?? 0;
    const spin = pose.spin ?? 0;
    if (![x, z, rotY, speed, steer, slip, spin].every(Number.isFinite) || !drivable(x, z)) return undefined;
    Object.assign(c, {
      x,
      z,
      rotY: Math.atan2(Math.sin(rotY), Math.cos(rotY)),
      speed: clamp(speed, -DRIVE.reverse, DRIVE.boostTop),
      steer: clamp(steer, -DRIVE.steer, DRIVE.steer),
      slip: clamp(slip, -DRIVE.boostTop, DRIVE.boostTop),
      spin: clamp(spin, -8, 8),
    });
    return { x: c.x, z: c.z, rotY: c.rotY, speed: c.speed, steer: c.steer, slip: c.slip, spin: c.spin };
  }

  /** `id` leans on the horn: the car they're in, unless they only just did. */
  honk(id: string): number | undefined {
    const at = this.seatOf(id);
    if (!at) return undefined;
    const now = this.now();
    if (now - (this.honked.get(id) ?? -Infinity) < HONK_EVERY) return undefined;
    this.honked.set(id, now);
    return at.car;
  }
}
