import type { Solid } from '../../../shared/hoop';
import { farShotSteps, finish, type FarAim, type FarShot, type Steps } from '../../../shared/hoop-range';

type At = { x: number; y: number; z: number };

/**
 * How far (m) the ball may be from where a far shot was worked out for it, and that still stand. It's
 * thrown from there (see take), a hair from your hands at most, so it goes exactly as the trial throws
 * that were worked out went: what drops in is sure to.
 */
const STILL = 1e-5;

/** A far shot being worked out: from where, aimed how (its own copy), past what, and what it came to once it's done. */
interface Job {
  from: At;
  aim: FarAim;
  solids: readonly Solid[];
  steps: Steps<FarShot>;
  shot: FarShot | null;
}

/**
 * The far shot you're winding up (see shared/hoop-range.ts), worked out a few trial throws a frame so
 * that letting go doesn't stall the page while they're flown. By the time you let go it's mostly done;
 * if you moved since, or it isn't finished, the rest is done there and then.
 */
export class LongShot {
  private job: Job | null = null;

  /** Works on the shot from `from` aimed `aim` past `solids` for up to `ms` (afresh, if it isn't the one it was working on). */
  work(from: At, aim: FarAim, solids: readonly Solid[], ms: number) {
    const job = this.jobFor(from, aim, solids);
    const until = performance.now() + ms;
    while (!job.shot && performance.now() < until) {
      const r = job.steps.next();
      if (r.done) job.shot = r.value;
    }
  }

  /**
   * The shot from `from` aimed `aim` past `solids`, as you let go: what was worked out for it (finished
   * now if need be), and from exactly where and which way, which is where it's thrown from.
   */
  take(from: At, aim: FarAim, solids: readonly Solid[]): { from: At; heading: number; shot: FarShot } {
    const job = this.jobFor(from, aim, solids);
    this.job = null;
    return { from: job.from, heading: job.aim.heading, shot: job.shot ?? finish(job.steps) };
  }

  /** A new wind-up: nothing worked out before it stands (the room may have changed since). */
  clear() {
    this.job = null;
  }

  private jobFor(from: At, aim: FarAim, solids: readonly Solid[]): Job {
    const j = this.job;
    if (j && near(j.from, from) && j.aim.pitch === aim.pitch && j.aim.heave === aim.heave && sameList(j.solids, solids)) return j;
    // Copies: the page writes its aim over every frame (see shotAim), and the work goes on over several.
    const mine = { from: { x: from.x, y: from.y, z: from.z }, aim: { ...aim } };
    this.job = { ...mine, solids, steps: farShotSteps(mine.from, mine.aim, solids), shot: null };
    return this.job;
  }
}

function near(a: At, b: At): boolean {
  return Math.abs(a.x - b.x) < STILL && Math.abs(a.y - b.y) < STILL && Math.abs(a.z - b.z) < STILL;
}

function sameList(a: readonly Solid[], b: readonly Solid[]): boolean {
  return a === b || (a.length === b.length && a.every((c, i) => c === b[i]));
}
