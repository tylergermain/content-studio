// What the page shows of Putt Street's rounds while a putt is still rolling on screen. The office
// sends the putt and straight after it the round as it stands once the ball's at rest (the strokes,
// whose turn it is), so the scorecards would give away where a ball's going before it gets there: until
// it does, the HUD's card and the kiosk's board show the round as it was when the putt was struck.

import type { PuttRound } from '../../../shared/protocol';
import { store } from '../../state';
import { rollSeconds } from './play';

/** Each round as it was before its latest putt, kept while that putt plays out. */
const before = new Map<string, PuttRound>();
const seen = new WeakSet<object>();
/** After the path, the ball hops a club length or comes back from the water: the card waits for that too (s). */
const SETTLE = 1.2;

// The putt comes before the round's news, so the round is still as it was when the putt's topic fires.
store.on('puttRolled', () => {
  for (const roll of store.puttRolls.values()) {
    if (seen.has(roll)) continue;
    seen.add(roll);
    const r = store.puttRounds.find((x) => x.id === roll.round);
    if (r) before.set(r.id, structuredClone(r));
  }
});

/** Round `r` as the page should show it at office time `now`: as it was before its latest putt, while that's still rolling. */
export function shownRound<R extends PuttRound | undefined>(r: R, now: number): R {
  if (!r) return r;
  const held = before.get(r.id);
  const roll = store.puttRolls.get(r.id);
  if (!held || !roll) return r;
  if (now < roll.startAt + (rollSeconds(roll.path) + SETTLE) * 1000) return held as R;
  before.delete(r.id);
  return r;
}
