/**
 * How hard VR works the headset: one profile per kind of headset, picked by the browser's user agent.
 * Pure (no three.js), so tests/vr-quality.test.ts reads it as it is. quality.ts applies a profile and
 * lets each knob be flipped live from the perf overlay (perf.ts), for A/B tests in the headset.
 *
 * The Quest 2 numbers are where measuring starts (see docs/vr.md): three's WebGL renderer draws every
 * eye as a pass of its own, so VR doubles the draw calls, and the Quest 2's budget is about 13.7 ms a
 * frame at 72 Hz. Each value stays or changes on measured numbers only.
 */
import type { VrQuality } from './types';

export const VR_PROFILES: Readonly<Record<VrQuality['name'], Readonly<VrQuality>>> = {
  quest2: {
    name: 'quest2',
    // The toon outline draws the whole scene again: four passes a frame in VR instead of two.
    outline: false,
    framebufferScale: 0.8,
    foveation: 1,
    // A 13.7 ms frame rather than 90 Hz's 11.1 ms.
    frameRate: 72,
    // The sun's shadow map drawn four times a second at half the size, rather than every frame
    // (switching shadows off outright recompiles every material).
    shadows: 'throttled',
    shadowMapSize: 1024,
    shadowEveryMs: 250,
    halos: false,
    maxLamps: 24,
    // Video, the TV, the screens' canvases, the arcade: uploaded ten times a second at most.
    hotTextureEveryMs: 100,
    sceneryReach: 0.6,
    panelScale: 1.5,
  },
  // Quest 3 and Quest Pro: about two and a half times the Quest 2's GPU.
  quest3: {
    name: 'quest3',
    outline: true,
    framebufferScale: 1,
    foveation: 0.5,
    frameRate: 72,
    shadows: 'throttled',
    shadowMapSize: 2048,
    shadowEveryMs: 100,
    halos: true,
    maxLamps: 24,
    hotTextureEveryMs: 66,
    sceneryReach: 0.8,
    panelScale: 1.5,
  },
  // Anything else (a PC headset through Quest Link or SteamVR, another standalone): the headset's own
  // frame rate, and the middle of the road.
  other: {
    name: 'other',
    outline: false,
    framebufferScale: 1,
    foveation: 0.5,
    frameRate: null,
    shadows: 'throttled',
    shadowMapSize: 2048,
    shadowEveryMs: 100,
    halos: true,
    maxLamps: 24,
    hotTextureEveryMs: 66,
    sceneryReach: 0.8,
    panelScale: 1.5,
  },
};

/** Which profile a user agent gets: the Quest 2 (and the first Quest, and any Quest it can't tell), the Quest 3 or Pro, or anything else. */
export function profileName(ua: string): VrQuality['name'] {
  if (/\bQuest (3|Pro)/i.test(ua)) return 'quest3';
  if (/\bQuest\b|OculusBrowser/i.test(ua)) return 'quest2';
  return 'other';
}

/** A fresh copy of the profile for `ua`, to apply and to change knob by knob (see quality.ts). */
export function profileFor(ua: string): VrQuality {
  return { ...VR_PROFILES[profileName(ua)] };
}

/** The values each knob steps through in the perf overlay, in order (see nextValue). */
export const KNOB_STEPS: { readonly [K in keyof VrQuality]?: readonly VrQuality[K][] } = {
  outline: [false, true],
  framebufferScale: [0.6, 0.7, 0.8, 0.9, 1],
  foveation: [0, 0.5, 1],
  frameRate: [72, 80, 90],
  shadows: ['on', 'throttled', 'off'],
  shadowMapSize: [512, 1024, 2048],
  halos: [false, true],
  maxLamps: [8, 16, 24],
  hotTextureEveryMs: [0, 66, 100, 200],
  sceneryReach: [0.4, 0.6, 0.8, 1],
};

/** The value after `now` among `steps`, round to the first; the first if `now` isn't one of them. */
export function nextValue<T>(steps: readonly T[], now: T): T {
  const i = steps.indexOf(now);
  return steps[(i + 1) % steps.length];
}
