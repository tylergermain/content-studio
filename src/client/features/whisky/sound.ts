import type { AudioCore } from '../../sound/core';
import { biquad, envelope, rand } from '../../sound/dsp';
import type { Pos } from '../../sound/places';

// The whisky cabinet: a dram poured from the decanter, and two glasses clinking.

/** How long after the decanter starts to tip the whisky reaches the glass, and how long it runs (see the pour in world.ts). */
const POUR = { from: 0.72, len: 0.62 } as const;

/**
 * A dram from the decanter: the crystal stopper lifted with a faint ring, the whisky glugging into an
 * empty glass (no ice: it's neat), and the stopper set back.
 */
export function decant(a: AudioCore, at: Pos) {
  const ctx = a.ctx;
  if (!ctx) return;
  a.count('decant');
  const out = a.panner(at, 1.2, 1);
  out.connect(a.ambience);
  const t0 = ctx.currentTime + 0.03;
  a.clink(out, t0 + 0.12, rand(2500, 2700), 0.03);
  // The pour: a run of soft glugs, each a little higher than the last as the glass fills.
  const glugs = 6;
  for (let i = 0; i < glugs; i++) {
    const t = t0 + POUR.from + (i / glugs) * POUR.len + rand(-0.01, 0.01);
    const n = a.noise(a.buf.white);
    const tone = biquad(ctx, 'bandpass', 420 + i * 70 + rand(-30, 30), 6);
    const g = ctx.createGain();
    envelope(g.gain, t, [
      [0.012, 0.11],
      [0.07, 0],
    ]);
    n.connect(tone).connect(g).connect(out);
    n.start(t);
    n.stop(t + 0.09);
    a.blip(out, t + 0.01, 300 + i * 45, 1.6, 0.05, 0.03);
  }
  a.clink(out, t0 + 1.95, rand(2500, 2700), 0.025);
}

/**
 * Two crystal glasses meeting: each rings at its own pitch with a few inharmonic partials and a long,
 * bright tail, the second a hair after the first.
 */
export function cheers(a: AudioCore, at: Pos) {
  const ctx = a.ctx;
  if (!ctx) return;
  a.count('cheers');
  const out = a.panner(at, 1.8, 1);
  out.connect(a.ambience);
  const t0 = ctx.currentTime + 0.02;
  for (const [f, delay, level] of [
    [rand(3050, 3250), 0, 0.09],
    [rand(2750, 2900), rand(0.008, 0.016), 0.075],
  ] as const) {
    const t = t0 + delay;
    for (const [mul, part, decay] of [
      [1, 1, 1.4],
      [2.32, 0.45, 0.8],
      [4.25, 0.22, 0.45],
      [5.41, 0.12, 0.3],
    ] as const) {
      const o = ctx.createOscillator();
      o.frequency.value = f * mul * rand(0.998, 1.002);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(level * part, t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + decay + 0.05);
    }
    // The knock of the glass itself, under the ring.
    const n = a.noise(a.buf.white);
    const knock = ctx.createGain();
    envelope(knock.gain, t, [
      [0.002, level * 0.6],
      [0.02, 0],
    ]);
    n.connect(biquad(ctx, 'highpass', 2400, 0.7)).connect(knock).connect(out);
    n.start(t);
    n.stop(t + 0.03);
  }
}
