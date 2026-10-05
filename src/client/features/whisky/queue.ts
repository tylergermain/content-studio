/**
 * Whose turn it is at a whisky cabinet's decanter: two people pouring at once take turns, the second
 * pour starting when the first is done, and only a couple may wait (any more and the pour plays for
 * nobody: the glass is simply in its pourer's hand). Pure: no three.js. Times are seconds, on whatever
 * clock the caller passes in as `now`.
 */
import { GLASSES, POUR_SECONDS } from '../../../shared/whisky';

/** A pour: when it starts (seconds), and which glass on the tray it fills. */
export interface Pour {
  from: number;
  glass: number;
}

/** How many pours may wait their turn behind the one under way. */
export const MOST_WAITING = 2;

export class PourQueue {
  /** The pour under way (or about to be), then the ones waiting their turn. */
  readonly pours: Pour[] = [];

  /**
   * A pour into glass `glass` on the tray, asked for at `now`: when it starts (now, or once the ones
   * before it are done), or null when too many are waiting already and it's dropped.
   */
  add(glass: number, now: number): number | null {
    this.prune(now);
    if (this.pours.length > MOST_WAITING) return null;
    const last = this.pours[this.pours.length - 1];
    const from = last ? Math.max(now, last.from + POUR_SECONDS) : now;
    this.pours.push({ from, glass: Math.max(0, Math.min(GLASSES - 1, glass)) });
    return from;
  }

  /** The pour under way at `now`, once the ones done are dropped (none, between pours or with none to do). */
  current(now: number): Pour | undefined {
    this.prune(now);
    const p = this.pours[0];
    return p && p.from <= now ? p : undefined;
  }

  /** Whether glass `i` is still on the tray for a pour that hasn't filled it by `now` (`filled`: when in a pour it's full). */
  waiting(i: number, now: number, filled: number): boolean {
    for (const p of this.pours) if (p.glass === i && now - p.from < filled) return true;
    return false;
  }

  private prune(now: number) {
    while (this.pours.length && now - this.pours[0].from > POUR_SECONDS) this.pours.shift();
  }
}
