import type { AudioCore } from '../../sound/core';
import { biquad, envelope } from '../../sound/dsp';

// ---- The parachute (see features/parachute) ----------------------------------------------------

/**
 * A chute: 'open' is the whump of the canopy catching air over you, a gust of low cloth noise with a
 * flutter after it; 'land' is your feet hitting the ground under it, a soft thud.
 */
export function chute(a: AudioCore, kind: 'open' | 'land') {
  const ctx = a.ctx;
  if (!ctx) return;
  a.count(`chute.${kind}`);
  const t0 = ctx.currentTime + 0.01;
  if (kind === 'open') {
    const air = a.noise(a.buf.white, true);
    const body = biquad(ctx, 'lowpass', 900, 0.8);
    body.frequency.setValueAtTime(1400, t0);
    body.frequency.exponentialRampToValueAtTime(260, t0 + 0.5);
    const g = ctx.createGain();
    envelope(g.gain, t0, [
      [0.02, 0.5],
      [0.12, 0.32],
      [0.7, 0.06],
      [1.1, 0],
    ]);
    // The fabric fluttering as it fills.
    const flutter = ctx.createOscillator();
    flutter.frequency.value = 17;
    const depth = ctx.createGain();
    depth.gain.value = 0.12;
    flutter.connect(depth).connect(g.gain);
    air.connect(body).connect(g).connect(a.ambience);
    air.start(t0);
    air.stop(t0 + 1.2);
    flutter.start(t0);
    flutter.stop(t0 + 1.2);
    return;
  }
  const thud = ctx.createOscillator();
  thud.type = 'sine';
  thud.frequency.setValueAtTime(120, t0);
  thud.frequency.exponentialRampToValueAtTime(48, t0 + 0.18);
  const g = ctx.createGain();
  envelope(g.gain, t0, [
    [0.01, 0.55],
    [0.25, 0],
  ]);
  thud.connect(g).connect(a.ambience);
  thud.start(t0);
  thud.stop(t0 + 0.3);
}
