import { CIRCUIT, GATE, GATES, circuitAt } from './circuit.js';

// Races round the circuit (shared/circuit.ts): whoever's at a wheel starts one (R), the office lines
// everyone up on the grid behind the line in front of it with bots in the cars nobody's in (the
// starter's page drives those, client/features/cars/bots.ts), and after the lights it's laps of the
// street and the scenic loop. The office keeps each racer's standing from where its car says it is
// (advance): the gates round the circuit gone through in turn, and the laps done, so cutting across
// the grass is fine but skipping half the loop isn't. Its view of a race goes to everyone on the floor.

export const RACE = {
  /** From R to the lights going out: time to line up and for anyone else to join (ms). */
  lobby: 12_000,
  /** The lights before the start (ms). */
  lights: 3_000,
  laps: 2,
  maxLaps: 5,
  bots: 3,
  maxBots: 6,
  /** How long the rest have to finish once someone has (ms). */
  afterFirst: 45_000,
  /** The longest a race runs (ms). */
  longest: 12 * 60_000,
  /** How long the results stay up once it's over (ms). */
  keepOver: 20_000,
} as const;

/** A racer: a car on the grid, with somebody at its wheel or a bot. */
export interface Racer {
  car: number;
  /** Who's driving (a PeerInfo id); none for a bot. */
  who?: string;
  name: string;
  bot?: true;
  /** Its place on the grid (shared/circuit.ts, gridSlot). */
  slot: number;
  /** Laps done (-1 till it first crosses the line), the next gate it has to go through, and how far round it is altogether (m). */
  lap: number;
  gate: number;
  progress: number;
  /** Its time when it finished (ms from the start), and where it came. */
  time?: number;
  place?: number;
  /** Out of it: it got out of its car, or its page left. */
  out?: true;
}

/** A race as everyone on the floor sees it. */
export interface RaceView {
  id: string;
  /** Who started it: whose page drives its bots. */
  host: string;
  laps: number;
  /** How long till the lights go out (ms) as the office sent it: negative once it's under way. */
  startsIn: number;
  racers: Racer[];
  /** Over: everyone's finished or out, or time ran out. */
  over?: true;
}

/** Where a racer stands: its laps, its next gate, and how far round the circuit it last was. */
export interface Standing {
  lap: number;
  gate: number;
  s?: number;
}

/**
 * A racer's standing once its car's got to (x, z): through its next gate if it's come to it, and over
 * the line (from the last stretch onto the first) a lap begun (the start) or done (every gate behind
 * it). Going back over the line, or too far off the road to say, changes nothing.
 */
export function advance(r: Standing, x: number, z: number): Standing & { lapped: boolean } {
  const at = circuitAt(x, z);
  if (!at || at.off > GATE.off) return { ...r, lapped: false };
  let { lap, gate } = r;
  let lapped = false;
  if (lap >= 0 && gate < GATES.length && Math.abs(at.s - GATES[gate]) < GATE.half) gate++;
  if (r.s !== undefined && r.s > CIRCUIT - 80 && at.s < 80) {
    if (lap < 0) {
      lap = 0;
      gate = 0;
    } else if (gate >= GATES.length) {
      lap++;
      gate = 0;
      lapped = true;
    }
  }
  return { lap, gate, s: at.s, lapped };
}

/** How far round a racer is altogether, for who's ahead: no further than its next gate, so a shortcut doesn't count. */
export function progressOf(r: Standing): number {
  const s = r.s ?? 0;
  if (r.lap < 0) return s - CIRCUIT;
  const upto = r.gate < GATES.length ? GATES[r.gate] + GATE.half : CIRCUIT;
  return r.lap * CIRCUIT + Math.min(s, upto);
}

/** The racers in the order they stand: the finished by their times, then the rest by how far round they are; those out last. */
export function standings(racers: readonly Racer[]): Racer[] {
  return [...racers].sort((a, b) => {
    if (!!a.out !== !!b.out) return a.out ? 1 : -1;
    if (a.time !== undefined || b.time !== undefined) return (a.time ?? Infinity) - (b.time ?? Infinity);
    return b.progress - a.progress;
  });
}

/** A race time as m:ss.t. */
export function raceTime(ms: number): string {
  const tenths = Math.max(0, Math.round(ms / 100));
  const m = Math.floor(tenths / 600);
  const rest = (tenths - m * 600) / 10;
  return `${m}:${rest < 10 ? '0' : ''}${rest.toFixed(1)}`;
}

/** 1st, 2nd, 3rd, 4th… */
export function ordinal(n: number): string {
  const k = n % 100;
  return `${n}${k >= 11 && k <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`;
}
