/**
 * The frame loop: every phase's ticks once a frame (see TICK_PHASES), off the browser's
 * requestAnimationFrame, or off a VR headset's frames while a session has borrowed it (see
 * features/vr/session.ts). Loads nothing of the office, so it runs under node in the tests.
 */
import * as THREE from 'three';
import type { Ctx } from './context';

/**
 * The frame loop as main.ts holds it: hand it to requestAnimationFrame to start it, and it asks for
 * the next frame itself. `xr` is how a VR session borrows it (see features/vr/session.ts): `take()`
 * parks it (the next browser frame runs nothing and asks for no more), `step(ts)` runs one frame from
 * the headset's own frame loop instead, and `give()` hands it back to the browser's.
 */
export type FrameLoop = ((ts?: number) => void) & { readonly xr: { step(ts: number): void; take(): void; give(): void } };

/**
 * The frame loop: each frame, every phase's ticks, in order (see TICK_PHASES, and installLoop). Its
 * clock starts now; hand what it returns to requestAnimationFrame to start it. `raf` is the browser's
 * requestAnimationFrame (the tests pass their own).
 */
export function frameLoop(ctx: Pick<Ctx, 'ticks'>, loading: { drew(): void }, raf: (fn: (ts: number) => void) => unknown = (fn) => requestAnimationFrame(fn)): FrameLoop {
  const timer = new THREE.Timer();
  /** A VR session has the frames (see FrameLoop). */
  let taken = false;
  /** A browser frame came while they were taken, and asked for no next one: give() asks again. */
  let parked = false;
  function run(ts?: number) {
    timer.update(ts);
    const delta = timer.getDelta();
    ctx.ticks.run({ delta, dt: Math.min(delta, 0.1), t: timer.getElapsed(), now: performance.now() });
    loading.drew();
  }
  function frame(ts?: number) {
    if (taken) {
      parked = true;
      return;
    }
    run(ts);
    raf(frame);
  }
  const xr = {
    step(ts: number) {
      if (taken) run(ts);
    },
    take() {
      taken = true;
    },
    give() {
      taken = false;
      if (!parked) return;
      parked = false;
      raf(frame);
    },
  };
  return Object.assign(frame, { xr });
}
