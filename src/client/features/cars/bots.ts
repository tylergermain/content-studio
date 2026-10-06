import { circuitAt, pointAt, sharpestAhead } from '../../../shared/circuit';
import { DRIVE, type CarPose, type Pedals } from '../../../shared/garage';
import { LOOP_HALF } from '../../../shared/scenic';

// The bots in a race (shared/race.ts), driven by the page of whoever started it: each aims at a point
// a little way up the circuit in a lane of its own, takes each bend no faster than its tyres hold
// (shared/circuit.ts says how sharp what's coming is), and backs out when it's stuck against
// something. Each is a bit quicker or slower than the next.

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** What a bot keeps between frames: how good it is, its lane, and how long it's been stuck. */
export interface BotMind {
  /** How much of what the car and the bends allow it dares (0.86 to 0.98). */
  skill: number;
  /** How far left of the circuit's middle it keeps (m). */
  lane: number;
  stuck: number;
  reversing: number;
  /** How long it's been lost (well off the circuit, or stuck however it backs out), and the last place round it that it was on it. */
  lost: number;
  lastOn?: number;
}

/** How long a bot's lost before it's put back on the circuit where it last was (s). */
export const LOST_FOR = 6;

/** A bot for car `car`: its skill and lane, the same every race for that car. */
export function botMind(car: number): BotMind {
  const k = (Math.sin(car * 12.9898) * 43758.5453) % 1;
  const r = Math.abs(k);
  return { skill: 0.86 + r * 0.12, lane: ((car % 3) - 1) * 1.6, stuck: 0, reversing: 0, lost: 0 };
}

/** The pedals for a bot in `pose`: still, held on the grid, till `go`; `easy` once it's finished, a lap at cruising pace. */
export function botPedals(pose: CarPose, mind: BotMind, dt: number, go: boolean, easy = false): Pedals {
  if (!go) return { gas: 0, turn: 0, brake: true };
  const v = Math.abs(pose.speed);
  const at = circuitAt(pose.x, pose.z);
  // Lost: off the circuit, or going nowhere.
  if (at && at.off < 10 && v > 2) {
    mind.lastOn = at.s;
    mind.lost = 0;
  } else mind.lost += dt;
  if (!at) return { gas: 0.4, turn: 0, brake: false };
  // A point up the circuit, further the faster it's going, in its lane.
  const p = pointAt(at.s + 10 + v * 0.55);
  const tx = p.x + p.tz * mind.lane;
  const tz = p.z - p.tx * mind.lane;
  const ang = wrap(Math.atan2(tx - pose.x, tz - pose.z) - pose.rotY);
  const turn = clamp(ang * 2.4, -1, 1);
  // As fast as the tightest bend coming up allows, and slower on the grass.
  const bend = sharpestAhead(at.s, 30 + v * 2.2);
  let safe = Math.min(DRIVE.top, Math.sqrt(DRIVE.grip * bend) * 0.9) * mind.skill * (easy ? 0.5 : 1);
  if (at.off > LOOP_HALF + 2) safe = Math.min(safe, 26);
  let gas = v < safe - 1 ? 1 : v > safe + 4 ? -1 : 0.25;
  // Facing the wrong way (spun round): round it gently.
  if (Math.abs(ang) > 1.6) gas = 0.5;
  // Stuck against something: back out of it for a moment, the wheel the other way.
  mind.stuck = v < 1.5 ? mind.stuck + dt : 0;
  if (mind.stuck > 1.4) {
    mind.reversing = 1.1;
    mind.stuck = 0;
  }
  if (mind.reversing > 0) {
    mind.reversing -= dt;
    return { gas: -1, turn: -turn, brake: false };
  }
  return { gas, turn, brake: false, boost: !easy && mind.skill > 0.95 && bend > 400 && v > 35 && Math.abs(ang) < 0.08 };
}
