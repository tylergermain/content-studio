import { knock, type Kick } from '../../../shared/car-crash';
import type { CarPose } from '../../../shared/garage';
import { store } from '../../state';
import { botMind, botPedals, type BotMind } from './bots';
import type { OtherCar, StepEvents, StepWorld } from './physics';
import { stepCar } from './physics';
import type { Fleet } from './world';

// The cars this page moves besides the one you're driving: the bots in a race you started, and the cars
// nobody's in that you knocked rolling (till they stop). And what happens when any of them, yours
// included, runs into another car: a car this page moves gets its knock at once, one somebody else
// drives gets it from their page (the office passes it on, car.hit), and one nobody's in starts rolling
// here. After a knock, the two only stop going into each other for a moment, so the same crash isn't
// felt twice when both pages see it.

/** How often the office hears where a bot or a rolling car is, at most (seconds). */
const SEND_EVERY = 0.066;
/** How long after a knock the two cars only push apart (ms). */
const SOFT_MS = 350;
/** The longest a knocked car rolls here before it's left where it is (ms). */
const ROLL_MS = 5000;

export interface TrafficHooks {
  /** Tell the office: a bot's or a rolling car's pose, and a knock for someone else's car. */
  drive(car: number, pose: CarPose): void;
  push(car: number, pose: CarPose): void;
  hit(car: number, by: number, kick: Kick): void;
  /** Car `car` (one of this page's) ran into something at `speed`, at (x, z). */
  crunch(car: number, at: { x: number; z: number }, speed: number): void;
  /** The car you're driving got knocked to `pose`. */
  knocked(pose: CarPose): void;
  /** The car you're driving, if you are. */
  mine(): number | null;
  /** Whether the bots may go (the lights are out), and whether car `car`'s bot has finished. */
  go(): boolean;
  finished(car: number): boolean;
}

export class Traffic {
  private rolling = new Map<number, { until: number }>();
  private minds = new Map<number, BotMind>();
  private soft = new Map<number, number>();
  private sentAt = new Map<number, number>();
  private clock = 0;

  constructor(
    private fleet: Fleet,
    private hooks: TrafficHooks,
  ) {}

  /** The bots this page races: cars nobody's in whose bot is yours. */
  private bots(): number[] {
    return store.cars.flatMap((c, i) => (c.bot === store.you && !c.driver ? [i] : []));
  }

  /** Every car this page moves: yours (driving), your bots, and the cars you knocked rolling. */
  local(): Set<number> {
    const out = new Set<number>([...this.bots(), ...this.rolling.keys()]);
    const mine = this.hooks.mine();
    if (mine !== null) out.add(mine);
    return out;
  }

  /** What car `self` runs into: the ground's solids, and the other cars as they're drawn. */
  world(): StepWorld {
    const now = performance.now();
    return {
      solids: (x, z, r) => this.fleet.solids(x, z, r),
      cars: (x, z, r) =>
        this.fleet.cars
          .filter((v) => Math.abs(v.pose.x - x) < r && Math.abs(v.pose.z - z) < r)
          .map((v): OtherCar => ({ index: v.index, pose: { ...v.pose }, soft: (this.soft.get(v.index) ?? 0) > now })),
    };
  }

  /** What happens when car `self` runs into things. */
  events(self: number): StepEvents {
    return {
      bump: (at, speed) => this.hooks.crunch(self, at, speed),
      hitCar: (other, after, kick, speed) => this.hitCar(self, other, after, kick, speed),
    };
  }

  private hitCar(self: number, other: OtherCar, after: CarPose, kick: Kick, speed: number) {
    const now = performance.now();
    this.hooks.crunch(self, { x: (after.x + other.pose.x) / 2, z: (after.z + other.pose.z) / 2 }, speed);
    const o = other.index;
    const c = store.cars[o];
    if (!c) return;
    if (o === this.hooks.mine()) this.hooks.knocked(after);
    else if (this.local().has(o)) this.fleet.place(o, after);
    else if (c.driver || c.bot) {
      // Somebody else moves it: their page gives it the knock.
      this.hooks.hit(o, self, kick);
      this.soft.set(o, now + SOFT_MS);
    } else {
      // Nobody's in it: it rolls from here, this page moving it till it stops.
      this.rolling.set(o, { until: now + ROLL_MS });
      this.fleet.place(o, after);
      this.hooks.push(o, after);
    }
  }

  /** Someone's car `by` ran into car `car`, which this page moves: its knock. */
  kicked(car: number, by: number, k: Kick) {
    this.soft.set(by, performance.now() + SOFT_MS);
    const v = this.fleet.cars[car];
    if (!v) return;
    const pose = knock(v.pose, k);
    if (car === this.hooks.mine()) this.hooks.knocked(pose);
    else if (this.local().has(car)) this.fleet.place(car, pose);
  }

  /** Each frame: the bots drive on, and the rolling cars roll on, and the office hears where they are. */
  update(dt: number) {
    this.clock += dt;
    const now = performance.now();
    const go = this.hooks.go();
    const world = this.world();
    for (const car of this.bots()) {
      let mind = this.minds.get(car);
      if (!mind) this.minds.set(car, (mind = botMind(car)));
      const from = this.fleet.cars[car]?.pose;
      if (!from) continue;
      const pose = stepCar(car, from, botPedals(from, mind, dt, go, this.hooks.finished(car)), dt, world, this.events(car));
      this.fleet.place(car, pose);
      this.send(car, pose, false);
    }
    for (const [car, roll] of this.rolling) {
      const c = store.cars[car];
      const from = this.fleet.cars[car]?.pose;
      // Someone got in, a bot took it, or it's rolled long enough: left where it is.
      if (!c || !from || c.driver || c.bot || now > roll.until) {
        this.rolling.delete(car);
        if (from && c && !c.driver && !c.bot) this.hooks.push(car, { ...from, speed: 0, slip: 0, spin: 0 });
        continue;
      }
      const pose = stepCar(car, from, { gas: 0, turn: 0, brake: true }, dt, world, this.events(car));
      this.fleet.place(car, pose);
      const still = Math.abs(pose.speed) < 0.2 && Math.abs(pose.slip ?? 0) < 0.2 && Math.abs(pose.spin ?? 0) < 0.05;
      this.send(car, still ? { ...pose, speed: 0, slip: 0, spin: 0 } : pose, true);
      if (still) this.rolling.delete(car);
    }
  }

  private send(car: number, pose: CarPose, rolling: boolean) {
    const at = this.sentAt.get(car) ?? -Infinity;
    if (this.clock - at < SEND_EVERY && (rolling ? pose.speed !== 0 : true)) return;
    this.sentAt.set(car, this.clock);
    if (rolling) this.hooks.push(car, pose);
    else this.hooks.drive(car, pose);
  }

  /** Off the floor: nothing rolls here any more. */
  clear() {
    this.rolling.clear();
    this.minds.clear();
    this.soft.clear();
  }
}
