/**
 * A Quest's own page outside VR (its flat page): the office in a window floating in the headset, drawn
 * once rather than for two eyes, but by the same GPU and CPU as VR. It gets a profile of its own
 * (FLAT_PROFILES in quality-profile.ts), on from the moment the page loads and for as long as it's
 * open, under any VR session's: no toon outline, a canvas pixel for each of the page's, the sun's
 * shadows drawn a few times a second, video uploads capped, the office's still meshes batched and the
 * pictures smaller. Loaded only where the user agent might be a headset's (see index.ts), so a laptop
 * never loads it and draws the office exactly as it always has.
 */
import type { Ctx } from '../../core/context';
import type { Parts } from '../../core/parts';
import { officeBatcher } from '../../core/office-batcher';
import { flatProfileFor } from './quality-profile';
import { applyQuality, type OnQuality } from './quality';
import type { FlatQuality } from './types';

/** What the flat page's profile is put on with. */
export type FlatParts = Pick<Parts, 'stage' | 'rooftop'>;

/** The flat page's profile, on for good, if this browser is a headset's; null if it isn't. */
export function startFlat(ctx: Ctx, parts: FlatParts, ua = navigator.userAgent): OnQuality<FlatQuality> | null {
  const q = flatProfileFor(ua);
  if (!q) return null;
  const { renderer } = ctx;
  renderer.setPixelRatio(q.pixelRatio);
  // The canvas, the camera and your hands fit the window again at that (see fitWindow).
  window.dispatchEvent(new Event('resize'));
  const on = applyQuality(ctx, parts, { tick: (phase, fn) => void ctx.ticks.add(phase, fn), onEnd: () => {} }, q, { batcher: officeBatcher(ctx, parts) });
  // For the console and the headless checks.
  (window as unknown as { __flat?: OnQuality<FlatQuality> }).__flat = on;
  return on;
}
