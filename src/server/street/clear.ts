// Before walls go up on a plot (a claim, or a site becoming a shell), nobody and nothing may stand
// where they'd go: walls a site's hoarding or a shell's tower put up are solid to the top of the sky
// (colliders 99 high), so whoever was inside would be walled in for good, and Friday One parked there
// could never take off. So the office looks first: at Friday One, down or in the air, and at everyone
// out on the street, on every floor.
import { HELI, heliFootprint } from '../../shared/heli.js';
import type { Box } from '../../shared/garage.js';
import { businessBoxes, claimedBox, PLOTS, type Claimable, type Solid, type StreetPoint } from '../../shared/mainstreet.js';
import type { BusinessStage, HeliState } from '../../shared/protocol.js';
import { heliOf } from '../heli/index.js';
import type { Ctx } from '../office/context.js';
import { streetPeople } from './people.js';

/** How far round a plot's walls someone still counts as standing on it: the step they'd take before the wall was there. */
export const STEP_OFF = 0.5;

/** What could be in the way of a plot's walls: Friday One, and everyone out on the street (their feet, in the street frame). */
export interface InTheWay {
  heli: HeliState;
  people: readonly StreetPoint[];
}

/** What's in the way in the office now: Friday One as it is, and everyone at street level on every floor. */
export const inTheWay = (ctx: Ctx): InTheWay => ({ heli: heliOf(ctx).state(), people: streetPeople(ctx).map((p) => p.at) });

/** What would stand on `plot` as `stage` with `planned` storeys, as businessBoxes has it. */
export function wallsOf(plot: Claimable, stage: BusinessStage, planned: number): Solid[] {
  const storeys = Array.from({ length: planned }, () => ({ name: '', accent: '#000000' }));
  return businessBoxes([{ id: '', name: '', plot, accent: '#000000', skin: 'glass', stage, home: 'hosted', storeys }]);
}

const overlaps = (a: Box, b: Box) => a.minX <= b.maxX && a.maxX >= b.minX && a.minZ <= b.maxZ && a.maxZ >= b.minZ;

/** Whether box `b`, from `bottom` to `top` above the street, reaches into solid `s` (a round one's cylinder, for a round one). */
function reaches(b: Box, bottom: number, top: number, s: Solid): boolean {
  if (top < s.bottom || bottom > s.top || !overlaps(b, s)) return false;
  if (!s.round) return true;
  const { x, z, r } = s.round;
  const dx = x - Math.max(b.minX, Math.min(b.maxX, x));
  const dz = z - Math.max(b.minZ, Math.min(b.maxZ, z));
  return dx * dx + dz * dz <= r * r;
}

/**
 * Why `walls` can't go up on `plot` now, if they can't. Friday One parked or landed with any of its
 * footprint (rotor disc and tail) on the plot's ground, or in the air with its body in what's going
 * up (a shell's top storeys, a crane's jib sweeping round), has to fly clear first; anyone standing on
 * the plot, or within a step of its walls, has to step off. Nothing in the way: undefined.
 */
export function whyNotClear(plot: Claimable, walls: readonly Solid[], o: InTheWay): string | undefined {
  const name = PLOTS[plot].name;
  const ground = claimedBox(plot);
  const { pose, landed } = o.heli;
  const foot = heliFootprint(pose);
  if (landed && overlaps(foot, ground)) return `🚁 Friday One is parked on ${name}: it has to fly off first`;
  if (!landed && walls.some((s) => reaches(foot, pose.h, pose.h + HELI.hub + 0.3, s))) return `🚁 Friday One is in the way over ${name}: wait till it's flown clear`;
  const m = STEP_OFF;
  const on = (p: StreetPoint) => p.x >= ground.minX - m && p.x <= ground.maxX + m && p.z >= ground.minZ - m && p.z <= ground.maxZ + m;
  if (o.people.some(on)) return `🏙 Someone's standing on ${name}: they have to step off first`;
  return undefined;
}
