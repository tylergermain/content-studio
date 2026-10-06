import { SURFACES } from '../../../shared/car-ground';
import { bounceOff, crash, hitsBox, hitsCar, standOff, type Contact, type Kick } from '../../../shared/car-crash';
import { CAR, carFits, carPoint, drive, groundUnder, onGround, type Box, type CarPose, type Pedals } from '../../../shared/garage';

// A car this page moves (yours, a bot you're racing, a car you knocked rolling) driven a frame on: the
// physics (shared/garage.ts) in short steps, and at each one what it's run into (shared/car-crash.ts):
// the edge of where cars go, whatever stands on the ground, and the other cars. Car into car, both get
// the knock, and the other's new pose goes to whoever moves it (traffic.ts).

/** The longest step a car takes in one go (m), so it never goes through a lamp post between two frames. */
const STEP = 0.25;

/** Another car, as this page sees it now. */
export interface OtherCar {
  index: number;
  pose: CarPose;
  /** Its page (or this one) knocked the two of them a moment ago: only stop going into it, no second knock. */
  soft: boolean;
}

export interface StepWorld {
  /** What stands on the ground within `r` of (x, z), the cars apart. */
  solids(x: number, z: number, r: number): Box[];
  /** The other cars near (x, z). */
  cars(x: number, z: number, r: number): OtherCar[];
}

export interface StepEvents {
  /** It ran into something at `speed` m/s, at (x, z). */
  bump(at: { x: number; z: number }, speed: number): void;
  /** It ran into car `other` closing at `speed` m/s: the other car's pose after, and the knock that gave it. */
  hitCar(other: OtherCar, after: CarPose, kick: Kick, speed: number): void;
}

/** Car `index` `dt` seconds on from `from`, with these pedals. */
export function stepCar(index: number, from: CarPose, pedals: Pedals, dt: number, world: StepWorld, events: StepEvents): CarPose {
  const pace = Math.abs(from.speed) + Math.abs(from.slip ?? 0);
  const n = Math.max(1, Math.ceil((pace * dt) / STEP));
  const h = dt / n;
  const reach = CAR.length + pace * dt + 2;
  const near = world.solids(from.x, from.z, reach);
  const others = world.cars(from.x, from.z, reach + CAR.length).filter((o) => o.index !== index);
  // Already in something (parked on top of, set down over): it drives out of it any way it likes.
  const stuck = !carFits(from, near);
  let pose = from;
  for (let i = 0; i < n; i++) {
    let next = drive(pose, pedals, h, groundUnder(pose) ?? SURFACES.grass);
    if (!onGround(next)) {
      // The sea, the lake, the edge of the map: it stops at it, bouncing back a little.
      const speed = Math.hypot(next.speed, next.slip ?? 0);
      if (speed > 1.5) events.bump(carPoint(pose, 0, (Math.sign(next.speed || 1) * CAR.length) / 2), speed);
      pose = { ...pose, steer: next.steer, speed: -next.speed * 0.2, slip: -(next.slip ?? 0) * 0.2, spin: 0 };
      break;
    }
    if (!stuck) {
      // What's in the way: out of the deepest of it, bounced off, a few times over (a corner can be in two things).
      for (let pass = 0; pass < 3; pass++) {
        let worst: Contact | null = null;
        for (const b of near) {
          const c = hitsBox(next, b);
          if (c && (!worst || c.depth > worst.depth)) worst = c;
        }
        if (!worst) break;
        const r = bounceOff(next, worst);
        if (r.hit > 1.5) events.bump({ x: worst.x, z: worst.z }, r.hit);
        next = r.pose;
      }
    }
    for (const o of others) {
      const c = hitsCar(next, o.pose);
      if (!c) continue;
      if (o.soft) {
        next = standOff(next, c);
        continue;
      }
      const r = crash(next, o.pose, c);
      next = r.a;
      o.pose = r.b;
      o.soft = true;
      events.hitCar(o, r.b, r.kick, r.hit);
    }
    // Pushed out of one thing into another: it stays where it was, stopped.
    if (!stuck && !carFits(next, near)) {
      pose = { ...pose, steer: next.steer, speed: 0, slip: 0, spin: 0 };
      break;
    }
    pose = next;
  }
  return pose;
}
