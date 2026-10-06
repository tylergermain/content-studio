import { randomBytes } from 'node:crypto';
import { gridSlot } from '../shared/circuit.js';
import { CARS } from '../shared/garage.js';
import { RACE, advance, progressOf, type Racer, type RaceView } from '../shared/race.js';
import type { Garage } from './garage.js';

// A floor's race (shared/race.ts), kept by its garage: who's in it, on which car, where on the grid,
// and each racer's standing from where its car says it's got to. Bots race in cars nobody's in, from
// the starter's page; when the race is over (or the starter leaves) the bots park their cars back in
// their spots. The ws handlers (ws/handlers/race.ts) tell the floor how it stands.

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)));

/** A racer as the office keeps it: with how far round the circuit its car last was. */
type Entry = Racer & { s?: number };

export class Race {
  readonly id = randomBytes(6).toString('hex');
  readonly racers: Entry[] = [];
  /** When the first racer finished, and when it was over. */
  firstAt?: number;
  overAt?: number;

  constructor(
    readonly host: string,
    readonly laps: number,
    readonly startAt: number,
    private now: () => number,
  ) {}

  /** The race as everyone on the floor sees it. */
  view(): RaceView {
    return {
      id: this.id,
      host: this.host,
      laps: this.laps,
      startsIn: this.startAt - this.now(),
      racers: this.racers.map(({ s: _s, ...r }) => r),
      ...(this.overAt ? { over: true as const } : {}),
    };
  }

  /** Before the lights go out: lining up, and anyone at a wheel can join. */
  get lining(): boolean {
    return !this.overAt && this.now() < this.startAt;
  }

  get underway(): boolean {
    return !this.overAt && this.now() >= this.startAt;
  }

  /** Who's racing car `car`, if it's in the race. */
  racerIn(car: number): Entry | undefined {
    return this.racers.find((r) => r.car === car);
  }

  /**
   * Car `car` has got to (x, z): its racer's standing. 'lap' when that's news for everyone at once (a lap
   * done, a finish), 'move' when it only moved up the order, undefined when it's not racing.
   */
  moved(car: number, x: number, z: number): 'lap' | 'move' | undefined {
    if (!this.underway) return undefined;
    const r = this.racers.find((e) => e.car === car && !e.out && e.time === undefined);
    if (!r) return undefined;
    const next = advance(r, x, z);
    const was = r.lap;
    Object.assign(r, { lap: next.lap, gate: next.gate, s: next.s });
    r.progress = progressOf(r);
    if (next.lapped && r.lap >= this.laps) {
      const now = this.now();
      r.time = now - this.startAt;
      r.place = this.racers.filter((e) => e.time !== undefined).length;
      this.firstAt ??= now;
      return 'lap';
    }
    return r.lap !== was ? 'lap' : 'move';
  }

  /** Everyone on the grid in order: the people first, as they joined, then the bots behind. */
  lineUp(g: Garage) {
    const order = [...this.racers.filter((r) => !r.bot), ...this.racers.filter((r) => r.bot)];
    order.forEach((r, i) => {
      r.slot = i;
      r.s = undefined;
      r.progress = progressOf({ lap: -1, gate: 0, s: undefined });
      if (r.bot) g.place(r.car, gridSlot(i));
    });
  }
}

/** `id`, at the wheel of a car, starts a race of `laps` laps with `bots` bots: the race, or why not. */
export function startRace(g: Garage, id: string, name: string, laps: number | undefined, bots: number | undefined, clock: () => number = Date.now): Race | string {
  const at = g.seatOf(id);
  if (at?.seat !== 'driver') return 'Get behind the wheel of a car to start a race';
  if (g.race && !g.race.overAt) return g.race.lining ? 'A race is lining up: R joins it' : 'There’s a race on: wait for the next one';
  const race = new Race(id, clamp(laps ?? RACE.laps, 1, RACE.maxLaps), clock() + RACE.lobby, clock);
  race.racers.push({ car: at.car, who: id, name, slot: 0, lap: -1, gate: 0, progress: 0 });
  const free = CARS.map((_, i) => i).filter((i) => g.free(i)).slice(0, clamp(bots ?? RACE.bots, 0, RACE.maxBots));
  for (const car of free) {
    race.racers.push({ car, name: `\u{1f916} ${CARS[car].name}`, bot: true, slot: 0, lap: -1, gate: 0, progress: 0 });
    g.setBot(car, id);
  }
  race.lineUp(g);
  g.race = race;
  return race;
}

/** `id`, at the wheel of a car, joins the race lining up: why not, if they can't. */
export function joinRace(g: Garage, id: string, name: string): string | undefined {
  const race = g.race;
  const at = g.seatOf(id);
  if (!race?.lining) return 'No race is lining up: R starts one';
  if (at?.seat !== 'driver') return 'Get behind the wheel of a car to race';
  if (race.racers.some((r) => r.who === id || r.car === at.car)) return undefined;
  race.racers.push({ car: at.car, who: id, name, slot: 0, lap: -1, gate: 0, progress: 0 });
  race.lineUp(g);
  return undefined;
}

/**
 * `id` got out of their car, or left the floor: out of the race (lining up, off the grid altogether).
 * The starter gone, so are the bots their page was driving. Says whether the race changed.
 */
export function leftRace(g: Garage, id: string): boolean {
  const race = g.race;
  if (!race || race.overAt) return false;
  let changed = false;
  for (const r of [...race.racers]) {
    const gone = r.who === id || (r.bot && race.host === id);
    if (!gone || r.out) continue;
    changed = true;
    if (r.bot) g.setBot(r.car, undefined);
    if (race.lining) race.racers.splice(race.racers.indexOf(r), 1);
    else r.out = true;
  }
  if (changed && race.lining) {
    if (!race.racers.some((r) => !r.bot)) {
      for (const r of race.racers) g.setBot(r.car, undefined);
      g.race = undefined;
    } else race.lineUp(g);
  }
  return changed;
}

/**
 * The race's clock: over once every person in it has finished or is out, a while after the first
 * finished, or when it's run too long (the bots then park their cars); cleared away a while after
 * that. What changed, if anything.
 */
export function raceTick(g: Garage, now = Date.now()): 'over' | 'gone' | undefined {
  const race = g.race;
  if (!race) return undefined;
  if (race.overAt) {
    if (now - race.overAt < RACE.keepOver) return undefined;
    g.race = undefined;
    return 'gone';
  }
  if (now < race.startAt) return undefined;
  const done = race.racers.filter((r) => !r.bot).every((r) => r.out || r.time !== undefined);
  if (!done && !(race.firstAt && now - race.firstAt > RACE.afterFirst) && now - race.startAt < RACE.longest) return undefined;
  race.overAt = now;
  for (const r of race.racers) if (r.bot) g.setBot(r.car, undefined);
  return 'over';
}
