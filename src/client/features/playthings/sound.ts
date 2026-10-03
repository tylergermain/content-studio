import type { AudioCore } from '../../sound/core';
import { biquad, envelope, pick, rand } from '../../sound/dsp';
import type { Pos } from '../../sound/places';

// ---- The things to play with ----------------------------------------------------------------------

export type PlaySound = 'boing' | 'thud' | 'clunk' | 'tick' | 'prize' | 'whack' | 'bell' | 'note' | 'party' | 'pock' | 'tap' | 'clack' | 'goal';

/**
 * A plaything's sound, heard from `at`. `amount` is how much of it there is, each in its own way:
 *
 * - boing: the trampoline throwing you, 1 for its own bounce and more for a bigger one
 * - thud: a punch landing on the bag, 1 for a plain one and more as a combo builds
 * - clunk: a can dropping into the vending machine's tray
 * - tick: one of the prize wheel's pegs under its flapper, 0 to 1 for how fast it's still going
 * - prize: the wheel has stopped
 * - whack: the mallet on the high striker's pad, 0 to 1 for how hard
 * - bell: the puck ringing the bell
 * - note: a dance mat's tile, `amount` its pitch in Hz
 * - party: every tile lit at once
 * - pock: a paddle on the ball; tap: the ball on the table
 * - clack: a foosball knocked on by a rod; goal: one going in
 */
export function plaything(a: AudioCore, kind: PlaySound, at: Pos, amount = 1) {
  a.unlock();
  const ctx = a.ctx;
  if (!ctx) return;
  a.count(`play-${kind}`);
  const out = a.panner(at, 2.2, 1.1);
  out.connect(a.ambience);
  const t0 = ctx.currentTime + 0.005;
  /** A burst of noise through a filter: the soft part of a knock. */
  const puff = (type: BiquadFilterType, freq: number, len: number, level: number, when = t0) => {
    const n = a.noise(a.buf.white);
    const g = ctx.createGain();
    envelope(g.gain, when, [
      [0.004, level],
      [len, 0],
    ]);
    n.connect(biquad(ctx, type, freq, 0.9)).connect(g).connect(out);
    n.start(when);
    n.stop(when + len + 0.05);
  };
  /** A note that rings a while: a struck bell or a chime. */
  const ring = (freq: number, len: number, level: number, when = t0, type: OscillatorType = 'sine') => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(level, when + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, when + len);
    o.connect(g).connect(out);
    o.start(when);
    o.stop(when + len + 0.05);
  };
  switch (kind) {
    case 'boing': {
      // The springs: a note that bends up as they let go, wobbling as it goes, over the mat's own thump.
      const big = Math.max(0.6, Math.min(1.6, amount));
      const len = 0.42;
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(95 * big, t0);
      o.frequency.exponentialRampToValueAtTime(300 * big, t0 + len * 0.7);
      o.frequency.exponentialRampToValueAtTime(240 * big, t0 + len);
      const wobble = ctx.createOscillator();
      wobble.frequency.value = 26;
      const depth = ctx.createGain();
      depth.gain.setValueAtTime(34, t0);
      depth.gain.linearRampToValueAtTime(4, t0 + len);
      wobble.connect(depth).connect(o.frequency);
      const g = ctx.createGain();
      envelope(g.gain, t0, [
        [0.012, 0.3],
        [len * 0.5, 0.16],
        [len, 0],
      ]);
      o.connect(g).connect(out);
      for (const n of [o, wobble]) {
        n.start(t0);
        n.stop(t0 + len + 0.05);
      }
      puff('lowpass', 260, 0.14, 0.4);
      break;
    }
    case 'thud': {
      // A glove into a heavy bag: a dull thump, the leather's slap, and its chains.
      const hard = Math.min(1.5, amount);
      a.blip(out, t0, 105, 0.45, 0.2, 0.5 * hard);
      puff('lowpass', 520, 0.1, 0.5 * hard);
      puff('bandpass', 1900, 0.035, 0.12 * hard);
      a.clink(out, t0 + 0.03, rand(2500, 3100), 0.02);
      a.clink(out, t0 + 0.11, rand(2300, 2900), 0.012);
      break;
    }
    case 'clunk':
      // The machine's works turning over, then the can dropping into the tray.
      a.blip(out, t0, 150, 0.6, 0.12, 0.25);
      puff('lowpass', 700, 0.12, 0.35);
      a.play(pick(a.buf.steps), { gain: 0.7, rate: 0.7, dest: out, when: t0 + 0.32 });
      a.blip(out, t0 + 0.32, 210, 0.5, 0.1, 0.3);
      a.clink(out, t0 + 0.34, rand(1500, 1800), 0.05);
      a.clink(out, t0 + 0.47, rand(1700, 2000), 0.025);
      break;
    case 'tick':
      a.blip(out, t0, rand(1500, 1750), 0.6, 0.022, 0.05 + 0.07 * Math.min(1, amount));
      puff('highpass', 2600, 0.012, 0.05);
      break;
    case 'prize':
      [659, 784, 1047].forEach((f, i) => ring(f, i === 2 ? 0.7 : 0.22, 0.09, t0 + i * 0.11, 'triangle'));
      break;
    case 'whack':
      a.play(pick(a.buf.steps), { gain: 0.5 + 0.5 * amount, rate: 0.8, dest: out });
      a.blip(out, t0, 150, 0.4, 0.14, 0.3 + 0.3 * amount);
      puff('lowpass', 900, 0.06, 0.3);
      break;
    case 'bell':
      // Brass, struck from underneath: a few partials that don't quite line up.
      for (const [mul, level, len] of [
        [1, 0.2, 1.5],
        [2.4, 0.11, 1.1],
        [3.9, 0.06, 0.7],
        [5.3, 0.035, 0.4],
      ])
        ring(1320 * mul, len, level);
      break;
    case 'note':
      ring(amount, 0.5, 0.12, t0, 'triangle');
      ring(amount * 2, 0.3, 0.035);
      puff('lowpass', 500, 0.04, 0.12);
      break;
    case 'party':
      [523, 587, 659, 784, 880, 1047].forEach((f, i) => ring(f, i === 5 ? 0.8 : 0.16, 0.08, t0 + i * 0.07, 'triangle'));
      break;
    case 'pock':
      a.blip(out, t0, rand(1150, 1300), 0.7, 0.05, 0.2);
      puff('bandpass', 2400, 0.02, 0.1);
      break;
    case 'tap':
      a.blip(out, t0, rand(1750, 1950), 0.8, 0.03, 0.09);
      break;
    case 'clack':
      a.blip(out, t0, rand(620, 760), 0.6, 0.04, 0.13);
      puff('bandpass', 1600, 0.02, 0.08);
      break;
    case 'goal':
      // The ball dropping into the goal, and a little ta-da.
      a.play(pick(a.buf.steps), { gain: 0.5, rate: 1.3, dest: out });
      [523, 659, 784, 1047].forEach((f, i) => ring(f, i === 3 ? 0.6 : 0.16, 0.08, t0 + 0.12 + i * 0.1, 'triangle'));
      break;
  }
}
