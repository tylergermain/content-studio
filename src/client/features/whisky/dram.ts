/**
 * Your dram from the whisky cabinet: poured, sipped (E, and now and then of your own accord, nursing
 * it), and gone when it's empty, the glass back on the tray. Pure: no three.js, no DOM. Times are
 * seconds, on whichever clock the caller passes in as `now`.
 */
import { SIPS } from '../../../shared/whisky';

/** A sip takes this long, glass up and down again: another waits for it. */
export const SIP_SECONDS = 1.2;
/** Nursing it, you take a sip every so often without being asked: between this and twice this, in seconds. */
export const NURSE_SECONDS = 22;

export class Dram {
  /** Sips left in the glass; 0 is no glass in hand. */
  private sips = 0;
  private lastSip = -Infinity;
  private nextSip = Infinity;

  /** `rand` (0 to 1) spaces out the sips you take of your own accord. */
  constructor(private readonly rand: () => number = Math.random) {}

  /** A dram poured into your glass: a fresh one, or yours topped up. */
  pour(now: number) {
    this.sips = SIPS;
    this.nextSip = now + this.nurse();
  }

  /** Whether you have a glass in hand. */
  get holding(): boolean {
    return this.sips > 0;
  }

  /** How full it is, from 1 (just poured) down to 0 (no glass). */
  get level(): number {
    return this.sips / SIPS;
  }

  /** Whether you're mid-sip (the glass is up at your mouth). */
  sipping(now: number): boolean {
    return now - this.lastSip < SIP_SECONDS;
  }

  /**
   * Takes a sip, when there's a glass in hand and you're not mid-sip already: true when you did. The last
   * sip empties it, and the glass goes back (see holding).
   */
  sip(now: number): boolean {
    if (!this.holding || this.sipping(now)) return false;
    this.sips--;
    this.lastSip = now;
    this.nextSip = this.holding ? now + this.nurse() : Infinity;
    return true;
  }

  /** Whether it's time you took a sip of your own accord. */
  due(now: number): boolean {
    return this.holding && now >= this.nextSip;
  }

  /** The glass goes back with whatever's left in it (you left the floor). */
  putDown() {
    this.sips = 0;
    this.nextSip = Infinity;
  }

  private nurse(): number {
    return NURSE_SECONDS * (1 + this.rand());
  }
}
