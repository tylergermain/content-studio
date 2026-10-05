/**
 * A toast, as you hear of it (whisky.cheers): who raises a glass, whether it's yours, and the sip you
 * take to your own once the glasses have clinked. Only what you do yourself sips your dram: someone
 * else raising theirs to you puts your glass up for the clink, and that's all. Pure: no three.js, no
 * DOM. Times are seconds, on whatever clock the caller passes in as `now`.
 */
import type { Dram } from './dram';

/** How long after your own toast's clink you take the sip to it (the glasses go up, clink, then you drink). */
export const SIP_AFTER = 1.5;

export interface Toasted {
  /** Your glass goes up with the others: you're in it. */
  raise: boolean;
  /** It's your own toast: you'll sip to it once the glasses have clinked (see due). */
  yours: boolean;
  /** The floor is told who raised a glass (the office tells only some toasts, see shared Toasts). */
  told: boolean;
}

export class Toast {
  private sipAt = Infinity;

  constructor(private readonly dram: Dram) {}

  /** A toast `ids` raised (whoever raised it first) at `now`, as the office tells it: what it means for `you`. */
  heard(m: { ids: readonly string[]; told?: boolean }, you: string, now: number): Toasted {
    const yours = m.ids[0] === you;
    if (yours && this.dram.holding) this.sipAt = now + SIP_AFTER;
    return { raise: m.ids.includes(you), yours, told: !!m.told };
  }

  /** Whether it's time for the sip to your own toast (once: it's taken as this says so). */
  due(now: number): boolean {
    if (now < this.sipAt) return false;
    this.sipAt = Infinity;
    return this.dram.holding;
  }

  /** The glass went back: no sip to come. */
  cancel() {
    this.sipAt = Infinity;
  }
}
