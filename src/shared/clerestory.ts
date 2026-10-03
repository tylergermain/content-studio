// The upper windows: a second row straight over the low ones on the south and west walls, and a row
// high on the north and east walls, over the boards' labels and the TV. From outside the building has
// glass on every face, at twice the rhythm of its storeys; inside, the room has daylight from all four
// sides. They're part of WINDOWS (shared/layout.ts), so the walls, the tower, the panelling and the
// pictures all go round them.

import type { Opening, Side } from './layout.js';

const row = (wall: Side, us: readonly number[], y0: number, y1: number): Opening[] => us.map((u) => ({ wall, u, width: 3, y0, y1 }));

/** Twelve upper windows, 3 m wide: south and west over the low ones, north and east clear of what hangs under them. */
export const CLERESTORY: Opening[] = [
  ...row('south', [-14, -9, 1], 4.0, 6.2),
  ...row('west', [-9, -3, 3], 4.0, 6.2),
  ...row('north', [-11.7, -3.9, 3.9], 4.8, 6.2),
  ...row('east', [-9, -3, 3], 4.8, 6.2),
];

/** Holes in a wall one over another, `u0`..`u1` along it: from the lowest up. */
export interface Column {
  u0: number;
  u1: number;
  holes: Opening[];
}

/**
 * One wall's holes as columns along it, from the lowest u: holes with the same span go in one column,
 * from the bottom up, so the wall's built under the lowest, between each and the next and over the
 * top one. Two that overlap along the wall without the same span aren't a column, and the windows
 * never do (tests/clerestory.test.ts).
 */
export function columnsOf(holes: readonly Opening[]): Column[] {
  const out: Column[] = [];
  for (const o of [...holes].sort((a, b) => a.u - b.u || a.y0 - b.y0)) {
    const u0 = o.u - o.width / 2;
    const u1 = o.u + o.width / 2;
    const last = out[out.length - 1];
    if (last && Math.abs(last.u0 - u0) < 1e-6 && Math.abs(last.u1 - u1) < 1e-6) last.holes.push(o);
    else out.push({ u0, u1, holes: [o] });
  }
  return out;
}
