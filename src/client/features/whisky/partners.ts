/**
 * Who you'd clink glasses with right now (shared/whisky.ts's clinkWith, as the office goes by it):
 * whoever else on your floor holds a dram near enough, nearest first, a handful at most. Found again
 * every frame, so it makes nothing new unless who it is changed. Pure: no three.js, no DOM.
 */
import { CLINK_MOST, clinkDistance, type Stood } from '../../../shared/whisky';

/** Someone holding a dram, as the page sees them. */
export interface Holder extends Stood {
  name: string;
}

export class Partners {
  /** Their names, nearest first: the hint and the dram's bar say who K clinks with. */
  names: readonly string[] = [];
  /** Changes whenever `names` does (their ids, in order), for whatever shows them to tell. */
  key = '';
  private found: Holder[] = [];
  private dist: number[] = [];
  private was: string[] = [];

  /** Nobody: you've no glass in hand. */
  clear() {
    this.found.length = 0;
    this.settle();
  }

  /** Looks through `ids` (everyone holding a dram), `at` saying where each is when they're someone you could see. */
  find(me: Stood, ids: Iterable<string>, at: (id: string) => Holder | undefined) {
    const { found, dist } = this;
    found.length = 0;
    dist.length = 0;
    for (const id of ids) {
      const o = at(id);
      if (!o) continue;
      const d = clinkDistance(me, o);
      if (d < 0) continue;
      // Into its place, nearest first, keeping only the nearest few.
      let i = found.length;
      while (i > 0 && dist[i - 1] > d) i--;
      if (i >= CLINK_MOST) continue;
      found.splice(i, 0, o);
      dist.splice(i, 0, d);
      if (found.length > CLINK_MOST) {
        found.length = CLINK_MOST;
        dist.length = CLINK_MOST;
      }
    }
    this.settle();
  }

  /** Takes in who was found, if it's not who it was. */
  private settle() {
    const { found, was } = this;
    let same = found.length === was.length;
    for (let i = 0; same && i < found.length; i++) same = found[i].id === was[i];
    if (same) return;
    this.was = found.map((o) => o.id);
    this.names = found.map((o) => o.name);
    this.key = this.was.join(',');
  }
}
