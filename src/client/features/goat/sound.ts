import type { AudioCore } from '../../sound/core';
import { biquad, rand } from '../../sound/dsp';

// ---- The goat ---------------------------------------------------------------------------------

/**
 * "Maaa", from where Marc is: someone petted him. A nasal, buzzy voice that opens from an "m" into a
 * long "aa" and quavers the way a bleat does, faster and wider as it goes, with a little breath in it.
 */
export function bleat(a: AudioCore, x: number, z: number) {
  const ctx = a.ctx;
  if (!ctx) return;
  a.count('bleat');
  const out = a.panner({ x, y: 0.7, z }, 2, 1);
  out.connect(a.ambience);
  const t = ctx.currentTime + 0.03;
  const len = rand(0.75, 0.95);
  const f = rand(330, 390);

  const voice = ctx.createOscillator();
  voice.type = 'sawtooth';
  voice.frequency.setValueAtTime(f * 0.86, t);
  voice.frequency.linearRampToValueAtTime(f * 1.06, t + 0.14);
  voice.frequency.linearRampToValueAtTime(f * 0.94, t + len);
  // The quaver: its pitch shakes, and its loudness with it.
  const shake = ctx.createOscillator();
  shake.frequency.setValueAtTime(8.5, t);
  shake.frequency.linearRampToValueAtTime(12, t + len);
  const bend = ctx.createGain();
  bend.gain.setValueAtTime(0, t);
  bend.gain.linearRampToValueAtTime(f * 0.05, t + 0.25);
  bend.gain.linearRampToValueAtTime(f * 0.075, t + len);
  shake.connect(bend).connect(voice.frequency);

  // The mouth: shut on the "m", then open and nasal.
  const low = biquad(ctx, 'bandpass', 320, 3);
  low.frequency.setValueAtTime(300, t);
  low.frequency.linearRampToValueAtTime(880, t + 0.13);
  low.frequency.linearRampToValueAtTime(760, t + len);
  const nose = biquad(ctx, 'bandpass', 2100, 5);
  nose.frequency.setValueAtTime(1500, t);
  nose.frequency.linearRampToValueAtTime(2350, t + 0.16);
  const nasal = ctx.createGain();
  nasal.gain.value = 0.55;

  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.22, t + 0.05);
  g.gain.exponentialRampToValueAtTime(0.5, t + 0.16);
  g.gain.setValueAtTime(0.5, t + len * 0.7);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  const tremble = ctx.createGain();
  tremble.gain.value = 1;
  const depth = ctx.createGain();
  depth.gain.setValueAtTime(0, t);
  depth.gain.linearRampToValueAtTime(0.3, t + 0.3);
  shake.connect(depth).connect(tremble.gain);

  voice.connect(low).connect(g);
  voice.connect(nose).connect(nasal).connect(g);
  const breath = a.noise(a.buf.white);
  const rasp = ctx.createGain();
  rasp.gain.value = 0.12;
  breath.connect(biquad(ctx, 'bandpass', 2600, 1.2)).connect(rasp).connect(g);
  g.connect(tremble).connect(out);

  for (const node of [voice, shake]) {
    node.start(t);
    node.stop(t + len + 0.05);
  }
  breath.start(t, rand(0, 4));
  breath.stop(t + len + 0.05);
}
