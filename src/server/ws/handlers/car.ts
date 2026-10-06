// The cars in every floor's garage.
import type { Floor } from '../../floor.js';
import type { CarClientMsg } from '../../../shared/protocol.js';
import type { Ctx } from '../../office/context.js';
import type { Client } from '../../office/client.js';
import { num } from '../../office/input.js';
import type { FeatureHooks, HandlerMap, ViewPieces } from './types.js';
import { raceHandlers, raceLeft, raceMoved } from './race.js';

export const carsView: ViewPieces['cars'] = (_ctx, floor) => floor?.garage.state() ?? [];
export const carsChanged = (ctx: Ctx, floor: Floor) => ctx.toFloor(floor, { t: 'cars', cars: floor.garage.state() });

/** Getting into a car, or out of one. */
function seat(ctx: Ctx, c: Client, msg: Extract<CarClientMsg, { t: 'car.enter' | 'car.leave' }>) {
  const floor = ctx.floorOf(c);
  if (!floor) return;
  // Out of a car (or into another): out of a race in it.
  raceLeft(ctx, floor, c.id);
  const changed = msg.t === 'car.enter' ? floor.garage.enter(c.id, Math.trunc(num(msg.car)), msg.seat) : floor.garage.leave(c.id);
  // They hear back either way: someone who didn't get in (someone beat them to the seat) learns who did.
  if (changed) ctx.toNeighbors(c, { t: 'cars', cars: floor.garage.state() });
  ctx.sendTo(c, { t: 'cars', cars: floor.garage.state(), answer: true });
}

/** A pose from a message, every number checked (num), its slide and spin only if it says. */
const poseOf = (m: { x: unknown; z: unknown; rotY: unknown; speed: unknown; steer: unknown; slip?: unknown; spin?: unknown }) => ({
  x: num(m.x),
  z: num(m.z),
  rotY: num(m.rotY),
  speed: num(m.speed),
  steer: num(m.steer),
  ...(m.slip === undefined ? {} : { slip: num(m.slip) }),
  ...(m.spin === undefined ? {} : { spin: num(m.spin) }),
});

/** The most a knock passed on from one car to another changes it: velocity (m/s) and spin (radians a second). */
const MAX_KNOCK = 60;
const MAX_KNOCK_SPIN = 8;
const clampKnock = (v: unknown, most: number) => Math.min(most, Math.max(-most, num(v)));

export const carHandlers = {
  'car.enter': seat,
  'car.leave': seat,
  'car.drive'(ctx, c, msg) {
    const floor = ctx.floorOf(c);
    const car = Math.trunc(num(msg.car));
    const now = floor?.garage.drive(c.id, car, poseOf(msg));
    if (!floor || !now) return;
    ctx.toNeighbors(c, { t: 'car.move', car, ...now }, true);
    raceMoved(ctx, floor, car, now.x, now.z);
  },
  'car.push'(ctx, c, msg) {
    const floor = ctx.floorOf(c);
    const car = Math.trunc(num(msg.car));
    const now = floor?.garage.push(c.id, car, poseOf(msg));
    if (now) ctx.toNeighbors(c, { t: 'car.move', car, ...now }, true);
  },
  'car.hit'(ctx, c, msg) {
    const floor = ctx.floorOf(c);
    const car = Math.trunc(num(msg.car));
    const by = Math.trunc(num(msg.by));
    const to = floor?.garage.hit(c.id, car, by);
    const them = to ? ctx.clients.get(to) : undefined;
    if (them) ctx.sendTo(them, { t: 'car.hit', car, by, dvx: clampKnock(msg.dvx, MAX_KNOCK), dvz: clampKnock(msg.dvz, MAX_KNOCK), dspin: clampKnock(msg.dspin, MAX_KNOCK_SPIN) });
  },
  'car.honk'(ctx, c) {
    const car = ctx.floorOf(c)?.garage.honk(c.id);
    if (car !== undefined) ctx.toNeighbors(c, { t: 'car.honk', car });
  },
  ...raceHandlers,
} satisfies HandlerMap<CarClientMsg>;

export const carHooks: FeatureHooks = {
  leaving(ctx, c, was) {
    // So does a car they were in, parked where they left it, and a race they were in (or started).
    if (was) raceLeft(ctx, was, c.id);
    const carLeft = !!was?.garage.leave(c.id);
    if (carLeft && was) return () => carsChanged(ctx, was);
  },
  closedOn(ctx, c, floor) {
    raceLeft(ctx, floor, c.id);
    if (floor.garage.leave(c.id)) carsChanged(ctx, floor);
  },
};
