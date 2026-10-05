import type { AudioCore } from '../../sound/core';
import { biquad, place } from '../../sound/dsp';
import type { Pos } from '../../sound/places';

// ---- Friday One ---------------------------------------------------------------------------------

/**
 * The helicopter as you hear it: where it is, how fast its rotor turns (0..1) and how fast it flies
 * (m/s), and whether you're aboard (a low-passed cabin mix rather than the blades from outside).
 */
export interface RotorState {
  at: Pos;
  spin: number;
  speed: number;
  aboard: boolean;
}

/** Blade passes a second at full spin: two blades at 6.5 turns a second (see ROTOR_TURNS in model.ts). */
const SLAP_HZ = 13;

/** The sound's running parts: its sources, the gates and levels each frame sets, and its two ways out. */
interface Running {
  sources: AudioScheduledSourceNode[];
  lfo: OscillatorNode;
  slap: GainNode;
  thump: GainNode;
  whine: OscillatorNode;
  whineLevel: GainNode;
  wind: BiquadFilterNode;
  windLevel: GainNode;
  tone: BiquadFilterNode;
  out: GainNode;
  inside: GainNode;
  pan: PannerNode;
}

/** A pulse each period of a rising sawtooth: up at once as the period starts, dying away by its end. */
function pulseCurve(): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(256);
  for (let i = 0; i < curve.length; i++) curve[i] = (1 - i / (curve.length - 1)) ** 5;
  return curve;
}

/**
 * One helicopter's sound: the blades' slap (noise band-passed near 110 Hz, gated SLAP_HZ times a second
 * at full spin) over a low thump, a quiet turbine whine that rises as the rotor spools up, and wind that
 * grows with speed. From outside it comes from where it is, carrying across Main Street (a panner whose
 * level starts falling 20 m out); aboard, it's the muffled cabin mix. null fades it out.
 */
export class Rotor {
  private run: Running | null = null;
  /** The last spin heard, and when (the audio clock): how fast it's spooling up, for the whine. */
  private lastSpin = 0;
  private lastAt = 0;
  private spooling = 0;

  constructor(private readonly a: AudioCore) {}

  set(state: RotorState | null) {
    const ctx = this.a.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    if (!state) {
      this.stop(now);
      return;
    }
    const r = (this.run ??= this.start(ctx, state.at));
    const spin = Math.max(0, Math.min(1, state.spin));
    const dt = Math.max(1e-3, now - this.lastAt);
    const rising = Math.max(0, (spin - this.lastSpin) / dt);
    this.spooling += (Math.min(1, rising * 3) - this.spooling) * Math.min(1, dt * 4);
    this.lastSpin = spin;
    this.lastAt = now;
    place(r.pan, state.at.x, state.at.y, state.at.z);
    r.lfo.frequency.setTargetAtTime(SLAP_HZ * spin, now, 0.08);
    r.slap.gain.setTargetAtTime(5 * spin ** 1.5, now, 0.08);
    r.thump.gain.setTargetAtTime((state.aboard ? 1.6 : 1.1) * spin ** 1.5, now, 0.08);
    r.whine.frequency.setTargetAtTime(700 + 1900 * spin, now, 0.1);
    r.whineLevel.gain.setTargetAtTime(spin > 0.01 ? 0.004 + 0.008 * spin + 0.03 * this.spooling : 0, now, 0.1);
    const speed = Math.min(1, state.speed / 30);
    r.wind.frequency.setTargetAtTime(300 + 1400 * speed, now, 0.2);
    r.windLevel.gain.setTargetAtTime(0.35 * speed * speed, now, 0.2);
    // Aboard, the cabin's mix; inside the office, through the glass; out on the street (or the roof), all of it.
    const where = state.aboard ? 'aboard' : this.a.outdoors ? 'out' : this.a.where();
    r.tone.frequency.setTargetAtTime(where === 'aboard' ? 650 : where === 'office' ? 900 : where === 'garage' ? 1600 : 6500, now, 0.15);
    r.out.gain.setTargetAtTime(where === 'aboard' ? 0 : where === 'office' ? 0.45 : where === 'garage' ? 0.7 : 1, now, 0.15);
    r.inside.gain.setTargetAtTime(where === 'aboard' ? 0.55 : 0, now, 0.15);
  }

  /** Builds the sound at `at`, silent until set() turns it up. */
  private start(ctx: AudioContext, at: Pos): Running {
    const a = this.a;
    a.count('rotor');
    const now = ctx.currentTime;
    this.lastAt = now;
    const tone = biquad(ctx, 'lowpass', 6500, 0.7);
    const pan = a.panner(at, 20, 1);
    const out = ctx.createGain();
    const inside = ctx.createGain();
    out.gain.value = inside.gain.value = 0;
    tone.connect(out).connect(pan).connect(a.ambience);
    tone.connect(inside).connect(a.ambience);
    // The beat every gate opens on: a sawtooth shaped into a pulse a blade pass.
    const lfo = ctx.createOscillator();
    lfo.type = 'sawtooth';
    lfo.frequency.value = 0;
    const shape = ctx.createWaveShaper();
    shape.curve = pulseCurve();
    lfo.connect(shape);
    const gated = (src: AudioNode, level: GainNode) => {
      const gate = ctx.createGain();
      gate.gain.value = 0;
      shape.connect(gate.gain);
      src.connect(gate).connect(level).connect(tone);
    };
    const noise = a.noise(a.buf.white, true);
    const slap = ctx.createGain();
    gated(noise.connect(biquad(ctx, 'bandpass', 110, 1.4)), slap);
    const brown = a.noise(a.buf.brown, true);
    const thump = ctx.createGain();
    gated(brown.connect(biquad(ctx, 'lowpass', 140, 0.8)), thump);
    const whine = ctx.createOscillator();
    whine.type = 'triangle';
    const whineLevel = ctx.createGain();
    whine.connect(whineLevel).connect(tone);
    const air = a.noise(a.buf.white, true);
    const wind = biquad(ctx, 'lowpass', 300, 0.6);
    const windLevel = ctx.createGain();
    air.connect(wind).connect(windLevel).connect(tone);
    for (const g of [slap, thump, whineLevel, windLevel]) g.gain.value = 0;
    lfo.start(now);
    whine.start(now);
    // Each noise loop from somewhere else in it, so they don't line up.
    for (const s of [noise, brown, air]) s.start(now, Math.random() * 3);
    return { sources: [lfo, noise, brown, whine, air], lfo, slap, thump, whine, whineLevel, wind, windLevel, tone, out, inside, pan };
  }

  /** Fades it out and lets it go: nothing aboard, and the rotor's still. */
  private stop(now: number) {
    const r = this.run;
    if (!r) return;
    this.run = null;
    this.spooling = this.lastSpin = 0;
    for (const g of [r.out, r.inside]) {
      g.gain.cancelScheduledValues(now);
      g.gain.setTargetAtTime(0, now, 0.2);
    }
    for (const s of r.sources) s.stop(now + 1.2);
  }
}
