// The numbers behind a parachute jump (see index.ts), with no three.js, for the tests.

/** It opens by itself once you're falling at least `speed` m/s with more than `height` m still to fall: never off a stair or a jump in the office. */
export const OPEN = { height: 3, speed: 4 } as const;
/** How fast you sink under it, in m/s: gently near the ground, quicker a long way up (off the roof), `per` m of height for each m/s. */
export const SINK = 2.4;
export const SINK_HIGH = { max: 8, per: 4 } as const;
/** Seconds for it to pop open, and to crumple on the ground once you're down. */
export const POP = 0.45;
export const CRUMPLE = 1.1;
/** Where it's strapped on, up from your feet: your shoulders. */
export const STRAP = 1.38;
/** Someone else is under a chute while they're this far over the ground under them, and down again under `down`. */
export const AIRBORNE = { up: 2.2, down: 0.25 } as const;

/** How fast you sink under an open chute `height` m over the ground. */
export function sinkAt(height: number): number {
  return Math.max(SINK, Math.min(SINK_HIGH.max, height / SINK_HIGH.per));
}

/** Whether a chute opens now, `height` m over the ground and falling at `vy` (negative is down). */
export function shouldOpen(height: number, vy: number): boolean {
  return height > OPEN.height && vy < -OPEN.speed;
}

/** How big it is `t` s after it opened: from a bundle on your back to a little past full, then settling. */
export function popScale(t: number): number {
  if (t >= POP) return 1;
  const u = Math.max(0, t / POP);
  // Overshoots a touch past full near the end, as cloth catching air does.
  return Math.max(0.05, Math.min(1.08, u * u * (3 - 2 * u) * 1.08));
}

/** How far it has crumpled `t` s after landing: 0 just down, 1 gone. */
export function crumpleAt(t: number): number {
  return Math.min(1, Math.max(0, t / CRUMPLE));
}

/**
 * Whether someone else is under a chute: up off the ground under them by more than AIRBORNE.up, and
 * still under it until they're within AIRBORNE.down of it, so it doesn't flicker on and off as they land.
 */
export function airborne(height: number, was: boolean): boolean {
  return was ? height > AIRBORNE.down : height > AIRBORNE.up;
}
