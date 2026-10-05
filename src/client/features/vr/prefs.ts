/**
 * How you like VR, kept by this browser (the headset's): how far a snap turn goes, the comfort
 * vignette, a lift for a floor the headset has wrong (or for playing seated), which hand points, a
 * resolution of your own, and whether the perf overlay comes up. Unreadable storage (a private
 * window, blocked site data) gives the defaults.
 */
import type { VrPrefs } from './types';

const KEY = 'agent-office.vr';

export const VR_DEFAULTS: Readonly<VrPrefs> = { snapDeg: 30, vignette: false, heightOffset: 0, dominant: 'right', scale: null, perf: false };

/** The furthest the height pref lifts (or drops) you, in metres. */
export const MAX_LIFT = 0.8;

/** Prefs from whatever was stored: anything missing or out of range is the default. */
export function cleanVrPrefs(raw: unknown): VrPrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const lift = num(r.heightOffset);
  const scale = num(r.scale);
  return {
    snapDeg: r.snapDeg === 45 ? 45 : 30,
    vignette: r.vignette === true,
    heightOffset: lift === null ? 0 : Math.max(-MAX_LIFT, Math.min(MAX_LIFT, lift)),
    dominant: r.dominant === 'left' ? 'left' : 'right',
    scale: scale === null ? null : Math.max(0.5, Math.min(1, scale)),
    perf: r.perf === true,
  };
}

export function loadVrPrefs(): VrPrefs {
  try {
    return cleanVrPrefs(JSON.parse(localStorage.getItem(KEY) ?? 'null'));
  } catch {
    return { ...VR_DEFAULTS };
  }
}

/** Keeps `p` over what's stored (the rest stays as it was). */
export function saveVrPrefs(p: Partial<VrPrefs>): void {
  const next = cleanVrPrefs({ ...loadVrPrefs(), ...p });
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Not kept this time: the session still has it.
  }
}
