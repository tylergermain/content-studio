import type { AudioCore } from '../../sound/core';
import { biquad, envelope, pick, rand } from '../../sound/dsp';
import type { Pos } from '../../sound/places';

// ---- Putt Street --------------------------------------------------------------------------------

/**
 * What a putt sounds like as it goes: the putter's tock, a wall's clack, a bumper's boing, the windmill
 * creaking, the whoosh round the loop, rolling hollow through a tunnel, a splash, the cup's rattle and
 * plink, a lip-out, and a short fanfare for a hole in one. `off` is a ball thrown off the felt, landing
 * on the gravel.
 */
export type PuttSound = 'tock' | 'wall' | 'bumper' | 'mill' | 'loop' | 'tunnel' | 'splash' | 'cup' | 'lip' | 'ace' | 'off';

/** A burst of noise from `buffer` through a `type` filter at `freq`, shaped by `points` (see envelope), into `out`. */
function noiseBurst(a: AudioCore, out: AudioNode, t0: number, buffer: AudioBuffer, type: BiquadFilterType, freq: number, q: number, points: [number, number][]) {
  const ctx = a.ctx!;
  const src = a.noise(buffer);
  const filter = biquad(ctx, type, freq, q);
  const g = ctx.createGain();
  envelope(g.gain, t0, points);
  src.connect(filter).connect(g).connect(out);
  src.start(t0, rand(0, 3));
  src.stop(t0 + points[points.length - 1][0] + 0.05);
  return filter;
}

/** A Putt Street sound from `at`; `amount` is how hard (the putter's power 0..1, or how fast the ball hit, m/s). */
export function putt(a: AudioCore, kind: PuttSound, at: Pos, amount = 1) {
  const ctx = a.ctx;
  a.count(`putt.${kind}`);
  if (!ctx) return;
  const out = a.panner(at, 2.5, 1.1);
  out.connect(a.ambience);
  const t0 = ctx.currentTime + 0.005;
  // How hard a hit was, 0..1, from the ball's speed.
  const hard = Math.min(1, amount / 5);
  switch (kind) {
    case 'tock': {
      // The putter's face on the ball: a soft, woody tock, louder the harder it's hit.
      const level = 0.08 + Math.min(1, amount) * 0.3;
      a.blip(out, t0, rand(1050, 1150), 0.62, 0.06, level, 'triangle');
      a.play(pick(a.buf.steps), { gain: level * 0.8, rate: 2.9, dest: out });
      break;
    }
    case 'wall':
      // Off a kerb or a rail: a wooden clack.
      a.play(pick(a.buf.steps), { gain: 0.1 + hard * 0.35, rate: rand(2.1, 2.5), dest: out });
      a.blip(out, t0, rand(760, 860), 0.8, 0.035, 0.03 + hard * 0.08, 'square');
      break;
    case 'off':
      // Over the wall and down on the gravel.
      a.play(pick(a.buf.steps), { gain: 0.25, rate: rand(1.2, 1.4), dest: out });
      noiseBurst(a, out, t0, a.buf.white, 'bandpass', 2600, 0.8, [
        [0.01, 0.05],
        [0.18, 0],
      ]);
      break;
    case 'bumper':
      // A rubber post: boing.
      a.blip(out, t0, rand(150, 170), 2.4, 0.26, 0.12 + hard * 0.18, 'sine');
      a.blip(out, t0 + 0.02, rand(300, 330), 1.6, 0.18, 0.05 + hard * 0.06, 'triangle');
      break;
    case 'mill': {
      // Knocked back by a sail: a wooden knock, and the windmill's creak.
      a.play(pick(a.buf.steps), { gain: 0.3 + hard * 0.2, rate: 1.5, dest: out });
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(140, t0 + 0.05);
      o.frequency.linearRampToValueAtTime(95, t0 + 0.25);
      o.frequency.linearRampToValueAtTime(120, t0 + 0.45);
      const g = ctx.createGain();
      envelope(g.gain, t0 + 0.05, [
        [0.06, 0.05],
        [0.3, 0.04],
        [0.45, 0],
      ]);
      o.connect(biquad(ctx, 'bandpass', 900, 3)).connect(g).connect(out);
      o.start(t0 + 0.05);
      o.stop(t0 + 0.55);
      break;
    }
    case 'loop': {
      // Round the loop-the-loop: a whoosh that rises over the top and falls away.
      const f = noiseBurst(a, out, t0, a.buf.white, 'bandpass', 500, 1.4, [
        [0.08, 0.12],
        [0.35, 0.16],
        [0.7, 0],
      ]);
      f.frequency.setValueAtTime(500, t0);
      f.frequency.exponentialRampToValueAtTime(2600, t0 + 0.32);
      f.frequency.exponentialRampToValueAtTime(700, t0 + 0.7);
      break;
    }
    case 'tunnel':
      // Rolling through the hill: hollow and low, dying away inside it.
      noiseBurst(a, out, t0, a.buf.brown, 'lowpass', 320, 0.7, [
        [0.06, 0.3],
        [0.6, 0.2],
        [0.95, 0],
      ]);
      noiseBurst(a, out, t0, a.buf.brown, 'bandpass', 180, 9, [
        [0.08, 0.5],
        [0.9, 0],
      ]);
      break;
    case 'splash':
      // Into the water: a splash, and a few drops after it.
      noiseBurst(a, out, t0, a.buf.white, 'lowpass', 1900, 0.8, [
        [0.015, 0.4],
        [0.12, 0.18],
        [0.45, 0],
      ]);
      for (let i = 0; i < 4; i++) a.blip(out, t0 + 0.08 + i * rand(0.05, 0.09), rand(1300, 2200), 1.6, 0.05, 0.03, 'sine');
      break;
    case 'cup':
      // Plunk, a rattle round the bottom, and the plink of it settling.
      a.blip(out, t0, 520, 0.6, 0.12, 0.16, 'triangle');
      for (let i = 1; i <= 3; i++) a.blip(out, t0 + 0.07 + i * 0.055, 900 - i * 80, 0.8, 0.04, 0.05 / i);
      a.clink(out, t0 + 0.3, rand(1700, 1850), 0.05);
      break;
    case 'lip':
      // Round the rim and out again.
      a.clink(out, t0, rand(1500, 1650), 0.05);
      a.clink(out, t0 + 0.07, rand(1350, 1450), 0.035);
      a.blip(out, t0 + 0.02, 640, 1.25, 0.12, 0.04, 'triangle');
      break;
    case 'ace':
      // Ta-da-da-DAAA, a little higher than golf's.
      [659, 784, 988, 1319].forEach((f, i) => {
        const when = t0 + 0.35 + i * 0.12;
        const len = i === 3 ? 0.85 : 0.18;
        a.blip(out, when, f, 1, len, 0.1, 'triangle');
        a.blip(out, when, f * 2, 1, len * 0.6, 0.03);
      });
      break;
  }
}
