// Where in a video everyone on the floor is: the pure part of keeping the lounge TV's player in step
// with the office's clock (see video.ts), with no browser in it.

/** How far a player may be from where everyone else is, in seconds, before it's moved there. */
export const MAX_DRIFT = 2;
/** The least time between two jumps, in ms: a player that's just been moved buffers before its time runs again. */
export const SEEK_EVERY = 4000;
/** This close to the end, in seconds, a player is left to run out, and starts again from the top when it has. */
const TAIL = MAX_DRIFT + 1;

/**
 * How far into a video of `duration` seconds everyone is, `elapsedMs` after it was put on: it starts
 * again from the top each time it ends, as the tunes do. Until the player knows how long the video is
 * (`duration` 0), it's taken to be on its first time through.
 */
export function videoAt(elapsedMs: number, duration: number): number {
  const s = Math.max(0, elapsedMs) / 1000;
  return duration > 0 ? s % duration : s;
}

/** How far `at` is from `want` in a video that loops, going the short way round its end: positive when the player is ahead. */
export function driftOf(at: number, want: number, duration: number): number {
  const d = at - want;
  if (!(duration > 0)) return d;
  const half = duration / 2;
  return ((((d + half) % duration) + duration) % duration) - half;
}

/**
 * Where to move a player that says it's `at`, or undefined to leave it be: it's moved once it's more
 * than MAX_DRIFT from where everyone is, but not onto the last moments of the video (it runs out and
 * comes round by itself), and not while it hasn't said how long the video is.
 */
export function seekTo(at: number, elapsedMs: number, duration: number): number | undefined {
  if (!(duration > 0)) return undefined;
  const want = videoAt(elapsedMs, duration);
  if (Math.abs(driftOf(at, want, duration)) <= MAX_DRIFT) return undefined;
  return want > duration - TAIL ? undefined : want;
}

/**
 * Where a player starts: where everyone is, or the top when that's the last moments of a time through
 * (a player that ran a touch ahead ends first, and would only end again).
 */
export function startAt(elapsedMs: number, duration: number): number {
  const want = videoAt(elapsedMs, duration);
  return duration > 0 && want > duration - TAIL ? 0 : want;
}
