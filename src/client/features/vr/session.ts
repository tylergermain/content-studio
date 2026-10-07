/**
 * A VR session, from putting the headset on to taking it off: the lazy part of VR (installVr loads
 * this once you press Enter VR, so a desktop never does).
 *
 * Starting, in this order (each step needs the one before):
 * 1. The quality profile for this headset, and what has to be set before the session (resolution, foveation).
 * 2. The headset's room: its floor ('local-floor'), else where your head started ('local').
 * 3. Our frame callback on the renderer before the session's set, so three.js never runs a loop of its own beside it.
 * 4. The office's frame loop borrowed (FrameLoop.xr): from now on it runs off the headset's frames.
 * 5. The session handed to three.js.
 * 6. First person, and no pointer lock (there's no mouse to capture).
 * 7. The frame drawn for the headset's two eyes (a ViewEffect takeover: no drunk vision, no hands overlay).
 * 8. VR's parts, in the order their ticks run: the rig, the controllers, the panels, the hands,
 *    the sticks, perf, what the trigger does, presence, the quality knobs, the elevator's lights.
 *
 * Leaving (the headset's menu, Leave VR, or a lost session): three.js tidies its side up first, then
 * everything above is undone in reverse and the browser's frames come back to the office.
 */
import * as THREE from 'three';
import type { Ctx } from '../../core/context';
import type { VrDeps, VrParts } from './index';
import type { VrDebug, VrQuality, VrSession } from './types';
import { loadVrPrefs } from './prefs';
import { startRig } from './rig';
import { startControllers } from './controllers';
import { startPanels } from './panels/host';
import { startHands } from './hands';
import { startLocomotion } from './locomotion';
import { startPerf } from './perf';
import { startInteract } from './interact';
import { startPresence } from './presence';
import { profileFor } from './quality-profile';
import { qualityBefore, startQuality } from './quality';
import { officeBatcher } from '../../core/office-batcher';
import { startFade } from './fade';

/** Where your eyes are over the floor in a 'local' room, whose origin is your head where it started. */
const STANDING_EYES = 1.6;
/** How many failed frames are written to the console before the rest go quietly. */
const LOUD_ERRORS = 5;

/** The room to stand in: the headset's floor if it has one, else where your head started. */
async function roomOf(xr: XRSession): Promise<'local-floor' | 'local'> {
  if (xr.enabledFeatures) return xr.enabledFeatures.includes('local-floor') ? 'local-floor' : 'local';
  // A browser that doesn't say what it granted: ask.
  return xr.requestReferenceSpace('local-floor').then(
    () => 'local-floor' as const,
    () => 'local' as const,
  );
}

/** Puts you in VR in session `xr` (just granted): resolves once you're in, and rejects (with the session ended) if you can't be. */
export async function startSession(ctx: Ctx, parts: VrParts, deps: VrDeps, xr: XRSession): Promise<void> {
  const { renderer, player, canvas, camera } = ctx;
  const { effect, scene } = parts.stage;
  const debug = ((window as unknown as { __vr?: VrDebug }).__vr ??= { presenting: false, frames: 0, profile: '' });

  // 1-2. What has to be set before the session.
  const prefs = loadVrPrefs();
  const quality: VrQuality = profileFor(navigator.userAgent);
  const room = await roomOf(xr);
  qualityBefore(renderer, quality, prefs);
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType(room);

  /** What's undone when you leave, in reverse: ticks, effects, whatever each part put in. */
  const ends: (() => void)[] = [];
  const hooks: { before?(): void; after?(): void }[] = [];
  /** Where the canvas sits in the page: an emulator (IWER) borrows it for the session and puts it back last, over the HUD. */
  const home = { parent: canvas.parentNode, next: canvas.nextSibling };
  let current: XRFrame | null = null;
  let over = false;
  let errors = 0;
  const s: VrSession = {
    xr,
    quality,
    prefs,
    frame: () => current,
    world: () => renderer.xr.getReferenceSpace()!,
    head: { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), yaw: player.camYaw, pitch: player.lookPitch, height: STANDING_EYES },
    tick: (phase, fn) => void ends.push(ctx.ticks.add(phase, fn)),
    onEnd: (fn) => void ends.push(fn),
    around: (h) => void hooks.push(h),
    end: () => void xr.end().catch(() => {}),
  };

  /** One frame of the headset's: the office's whole frame, between the parts' before and after. */
  function step(time: number, frame?: XRFrame) {
    // three.js calls this from the browser's frames too until the session starts: those aren't the headset's.
    if (!frame || over) return;
    current = frame;
    try {
      for (const h of hooks) h.before?.();
      deps.loop.xr.step(time);
      for (const h of hooks) h.after?.();
      debug.frames++;
    } catch (err) {
      // Kept going, so the headset keeps showing something you can leave from.
      if (errors++ < LOUD_ERRORS) console.error('VR: a frame failed', err);
    } finally {
      current = null;
    }
  }

  /** Out of VR: everything put back, in reverse, and the browser's frames back to the office. Once. */
  function finish() {
    if (over) return;
    over = true;
    renderer.xr.removeEventListener('sessionend', finish);
    // three.js starts its own loop again as a session ends: nothing for it to do now.
    renderer.setAnimationLoop(null);
    renderer.xr.enabled = false;
    for (const fn of ends.splice(0).reverse()) {
      try {
        fn();
      } catch (err) {
        console.error('VR: putting something back failed', err);
      }
    }
    Object.assign(debug, { presenting: false, pads: undefined, panels: undefined, perf: undefined, knobs: undefined });
    if (home.parent && (canvas.parentNode !== home.parent || canvas.nextSibling !== home.next)) home.parent.insertBefore(canvas, home.next?.parentNode === home.parent ? home.next : null);
    // The canvas, the camera and your hands fit the window again (see fitWindow).
    window.dispatchEvent(new Event('resize'));
    deps.loop.xr.give();
  }

  // 3-5. The frames, the loop borrowed, the session handed over.
  renderer.xr.addEventListener('sessionend', finish);
  renderer.setAnimationLoop(step);
  deps.loop.xr.take();
  try {
    await renderer.xr.setSession(xr);
  } catch (err) {
    finish();
    // three.js starts its loop again once the session's gone: stopped then too.
    const stop = () => {
      renderer.xr.removeEventListener('sessionend', stop);
      renderer.setAnimationLoop(null);
    };
    renderer.xr.addEventListener('sessionend', stop);
    void xr.end().catch(() => {});
    throw err;
  }
  // From here to the end nothing waits, so no headset frame comes before every part is in.
  const rate = quality.frameRate;
  if (rate && xr.supportedFrameRates?.includes(rate)) void xr.updateTargetFrameRate(rate).catch(() => {});

  // 6. First person, with no mouse to capture: the office doesn't ask for it in VR (closing a window asks,
  // and a lock refused while a click still counts, before the mouse was ever locked, turns mouse-look off
  // for good: see PlayerInput.refused).
  const view = player.view;
  player.unlock();
  player.setView('first');
  player.lock = () => {};
  s.onEnd(() => {
    delete (player as { lock?: unknown }).lock;
    player.setView(view);
  });

  // 7. Both eyes, straight to the headset: no outline unless the profile has one.
  s.onEnd(
    ctx.view.add({
      takeover: () => {
        if (!current) return false;
        if (s.quality.outline) effect.render(scene, camera);
        else renderer.render(scene, camera);
        return true;
      },
    }),
  );

  // 8. The parts, in tick order (see above).
  try {
    const rig = startRig(ctx, s, { floor: room === 'local' ? STANDING_EYES : 0 });
    const pads = startControllers(ctx, s);
    const panels = startPanels(ctx, s);
    startHands(ctx, s, pads);
    startLocomotion(ctx, s, pads, rig);
    const perf = startPerf(ctx, parts, s, panels);
    startInteract(ctx, parts, s, pads, panels, perf);
    startPresence(ctx, s, pads);
    const knobs = startQuality(ctx, parts, s, { batcher: officeBatcher(ctx, parts) });
    startFade(ctx, s);
    // (The panels say what they have themselves: VrDebug.panels.)
    Object.assign(debug, { presenting: true, frames: 0, profile: quality.name, pads, perf, knobs });
  } catch (err) {
    s.end();
    throw err;
  }
}
