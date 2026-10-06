// Races round the circuit on every floor (server/race.ts): starting one, joining one, and telling the
// floor how it stands. While one's on, the office looks at it a few times a second: to send the
// standings when they've changed, to call it over, and to clear it away after.
import type { Floor } from '../../floor.js';
import type { CarClientMsg } from '../../../shared/protocol.js';
import type { Ctx } from '../../office/context.js';
import { num } from '../../office/input.js';
import { joinRace, leftRace, raceTick, startRace } from '../../race.js';
import type { HandlerMap, ViewPieces } from './types.js';

const LOOK_MS = 400;

export const raceView: ViewPieces['race'] = (_ctx, floor) => floor?.garage.race?.view() ?? null;

/** Each floor's race watch: its timer, and whether the standings changed since they were last sent. */
const watches = new WeakMap<Floor, { timer: NodeJS.Timeout; dirty: boolean }>();

const sendRace = (ctx: Ctx, floor: Floor) => ctx.toFloor(floor, { t: 'race', race: floor.garage.race?.view() ?? null });
const sendCars = (ctx: Ctx, floor: Floor) => ctx.toFloor(floor, { t: 'cars', cars: floor.garage.state() });

/** Looks at the floor's race a few times a second while there is one. */
function watch(ctx: Ctx, floor: Floor) {
  if (watches.has(floor)) return;
  const timer = setInterval(() => {
    const w = watches.get(floor);
    if (!ctx.floors.has(floor.id) || !w) return void stop(floor);
    const news = raceTick(floor.garage);
    if (news === 'over') sendCars(ctx, floor);
    if (news || w.dirty) {
      w.dirty = false;
      sendRace(ctx, floor);
    }
    if (news === 'gone' || !floor.garage.race) stop(floor);
  }, LOOK_MS);
  timer.unref();
  watches.set(floor, { timer, dirty: false });
}

function stop(floor: Floor) {
  const w = watches.get(floor);
  if (w) clearInterval(w.timer);
  watches.delete(floor);
}

/** Car `car` on `floor` has got to (x, z): its racer's standing, sent at once for a lap or a finish, else with the next look. */
export function raceMoved(ctx: Ctx, floor: Floor, car: number, x: number, z: number) {
  const news = floor.garage.race?.moved(car, x, z);
  if (news === 'lap') sendRace(ctx, floor);
  else if (news === 'move') {
    const w = watches.get(floor);
    if (w) w.dirty = true;
  }
}

/** `id` got out of their car or left `floor`: out of its race, and the floor told. */
export function raceLeft(ctx: Ctx, floor: Floor, id: string) {
  if (!leftRace(floor.garage, id)) return;
  sendCars(ctx, floor);
  sendRace(ctx, floor);
}

export const raceHandlers = {
  'race.start'(ctx, c, msg) {
    const floor = ctx.floorOf(c);
    if (!floor) return;
    const race = startRace(floor.garage, c.id, c.peer.name || 'Someone', msg.laps === undefined ? undefined : num(msg.laps), msg.bots === undefined ? undefined : num(msg.bots));
    if (typeof race === 'string') return ctx.warn(c, race);
    sendCars(ctx, floor);
    sendRace(ctx, floor);
    ctx.toastFloor(floor, `\u{1f3c1} ${c.peer.name || 'Someone'} started a race: get behind a wheel and press R to join`);
    watch(ctx, floor);
  },
  'race.join'(ctx, c) {
    const floor = ctx.floorOf(c);
    if (!floor) return;
    const why = joinRace(floor.garage, c.id, c.peer.name || 'Someone');
    if (why) return ctx.warn(c, why);
    sendCars(ctx, floor);
    sendRace(ctx, floor);
  },
} satisfies HandlerMap<Extract<CarClientMsg, { t: 'race.start' | 'race.join' }>>;
