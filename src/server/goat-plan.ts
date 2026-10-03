// Where Marc goes: the half of the office goat that's only arithmetic (server/goat.ts is the half with
// the timers). What he picks to do next, where he stands to graze on a plant, nibble a rug or butt the
// punching bag, how he tags along after someone, how he and the dog keep out of each other's way, and
// which floor of the building he lives on. tests/goat.test.ts holds each to what it says here.

import { dogAt, type DogState } from '../shared/dog.js';
import type { RoomOptions } from '../shared/floorplan.js';
import { isRound, kindDef, pieceAway, pieceBox, pieceRadius, type Piece } from '../shared/furniture.js';
import { NavGrid, type Pt } from '../shared/nav.js';
import { keepClearIn } from '../shared/office-fixed.js';

export const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
/** Which way `to` is from `from` (rotation around y; 0 looks down +z). */
export const toward = (from: Pt, to: Pt) => Math.atan2(to[0] - from[0], to[1] - from[1]);

// ---- The floor as he walks it -----------------------------------------------------------------------

/** How near their middles he and the dog get: each is most of a meter long. */
export const APART = 0.85;
/** How far he keeps off a doorway's floor. */
const DOOR_GAP = 0.15;
const NOTHING = { rects: [], circles: [] };

/**
 * The floor's grid as Marc has it: `base` (what the dog walks, round the furniture and the stairs) less
 * the doorways and the floor in front of them (see keepClearIn: the elevator's doors, the exit, the
 * balcony doors, the foot of the stairs, the meeting room's door), so he neither stands in one nor cuts
 * through, and less a circle round each of `avoid`: where the dog is lying, or is headed.
 */
export function goatNav(base: NavGrid, room?: RoomOptions, avoid: readonly Pt[] = []): NavGrid {
  const doors = keepClearIn(room).map((k) => k.rect);
  const shut = (x: number, z: number) =>
    doors.some(([x0, x1, z0, z1]) => x > x0 - DOOR_GAP && x < x1 + DOOR_GAP && z > z0 - DOOR_GAP && z < z1 + DOOR_GAP) || avoid.some(([ax, az]) => Math.hypot(x - ax, z - az) < APART);
  return new NavGrid(base.bounds, NOTHING, (x, z) => base.walkable(x, z) && !shut(x, z));
}

/**
 * The way round the furniture from `from` to `to`, or none when there isn't one: `route` answers with a
 * straight line through whatever's in the way then (a room walled off, the meeting room behind its
 * door), which is no way for a goat. From somewhere he can't stand (in at a plant, in the elevator) the
 * first step is out to the nearest place he can.
 */
export function wayTo(nav: NavGrid, from: Pt, to: Pt): Pt[] | undefined {
  const pts = nav.route(from, to);
  const first = nav.walkable(from[0], from[1]) ? 1 : 2;
  for (let i = first; i < pts.length; i++) if (!openLine(nav, pts[i - 1], pts[i])) return undefined;
  return pts;
}

/**
 * Whether he can walk straight from a to b: open floor every tenth of a meter of it. (The grid's own
 * clearLine gives up on a line that ends exactly on a corner between cells, which a spot given in
 * round numbers does.)
 */
export function openLine(nav: NavGrid, a: Pt, b: Pt): boolean {
  const n = Math.max(1, Math.ceil(dist(a, b) / 0.1));
  for (let k = 0; k <= n; k++) if (!nav.walkable(a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n)) return false;
  return true;
}

/** Somewhere to amble to: the way to a spot at least `min` away that he can get to, picked with `rnd` (0 to 1). */
export function ambleWay(nav: NavGrid, from: Pt, rnd: () => number, min = 4): Pt[] | undefined {
  const b = nav.bounds;
  for (let i = 0; i < 40; i++) {
    const p: Pt = [b.minX + 1 + rnd() * (b.maxX - b.minX - 2), b.minZ + 1 + rnd() * (b.maxZ - b.minZ - 2)];
    if (!nav.walkable(p[0], p[1]) || dist(p, from) < min) continue;
    const way = wayTo(nav, from, p);
    if (way) return way;
  }
  return undefined;
}

// ---- What he does next ------------------------------------------------------------------------------

/** What Marc sets about: each ends in one of GoatAct's poses (see shared/protocol/goat.ts). */
export type GoatPlan = 'amble' | 'graze' | 'look' | 'zoom' | 'lie' | 'nibble' | 'butt';

/** What the floor has for him just now. */
export interface GoatChoices {
  plants: boolean;
  /** Someone's near enough to look at. */
  people: boolean;
  rugs: boolean;
  bags: boolean;
}

/**
 * How likely each thing is, next to the others: mostly he ambles and grazes; he looks at whoever's
 * about, nibbles a rug or butts the bag now and then, lies down sometimes, and once in a while gets
 * the zoomies. What he just did is less likely again, and he never dashes twice running.
 */
export function planOdds(was: GoatPlan | undefined, has: GoatChoices): [GoatPlan, number][] {
  const odds: [GoatPlan, number][] = [['amble', was === 'amble' ? 1.5 : 3]];
  if (has.plants) odds.push(['graze', was === 'graze' ? 1 : 3]);
  if (has.people) odds.push(['look', was === 'look' ? 0.4 : 2]);
  if (has.rugs) odds.push(['nibble', was === 'nibble' ? 0.2 : 0.9]);
  if (has.bags) odds.push(['butt', was === 'butt' ? 0.2 : 0.9]);
  odds.push(['lie', was === 'lie' ? 0.2 : 0.9]);
  if (was !== 'zoom') odds.push(['zoom', 0.7]);
  return odds;
}

/** What he does next, by `roll` (0 to 1) over planOdds. */
export function choose(was: GoatPlan | undefined, has: GoatChoices, roll: number): GoatPlan {
  const odds = planOdds(was, has);
  let left = roll * odds.reduce((n, [, w]) => n + w, 0);
  for (const [plan, w] of odds) {
    left -= w;
    if (left < 0) return plan;
  }
  return odds[odds.length - 1][0];
}

// ---- Where he stands to graze, nibble and butt --------------------------------------------------------

/** Somewhere to stand, and which way to face there. */
export interface Spot {
  at: Pt;
  face: number;
}

/** How far ahead of his middle his mouth is, head down. */
const MUZZLE = 0.5;

/** The floor's plants, the ones not put away for the back office. */
export const plantsOf = (furniture: readonly Piece[], wing: number) => furniture.filter((p) => kindDef(p.kind).group === 'Plants' && !pieceAway(p, wing));
export const rugsOf = (furniture: readonly Piece[], wing: number) => furniture.filter((p) => p.kind.startsWith('rug') && !pieceAway(p, wing));
export const bagsOf = (furniture: readonly Piece[], wing: number) => furniture.filter((p) => p.kind === 'punching-bag' && !pieceAway(p, wing));

/** How far out from its middle a piece reaches, the narrow way for one that isn't round. */
function reachOf(p: Piece): number {
  if (isRound(p)) return pieceRadius(p);
  const b = pieceBox(p);
  return Math.min(b.maxX - b.minX, b.maxZ - b.minZ) / 2;
}

/**
 * The nearest place to `from` he can stand `reach` from `middle` (or a little further, where that's too
 * near the thing itself), facing it. `ok` rules places out.
 */
export function spotBy(nav: NavGrid, middle: Pt, reach: number, from: Pt, ok: (p: Pt) => boolean = () => true): Spot | undefined {
  for (const more of [0, 0.25, 0.5]) {
    let best: Spot | undefined;
    let bestD = Infinity;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const at: Pt = [middle[0] + Math.sin(a) * (reach + more), middle[1] + Math.cos(a) * (reach + more)];
      if (!nav.walkable(at[0], at[1]) || !ok(at)) continue;
      const d = dist(at, from);
      if (d < bestD) {
        bestD = d;
        best = { at, face: toward(at, middle) };
      }
    }
    if (best) return best;
  }
  return undefined;
}

/** `gap` out from `middle`, on the line to `spot`: the last step in, from where the grid lets him stand. */
function closeIn(spot: Pt, middle: Pt, gap: number): Pt {
  const far = dist(spot, middle) || 1;
  return [middle[0] + ((spot[0] - middle[0]) / far) * gap, middle[1] + ((spot[1] - middle[1]) / far) * gap];
}

/** A way to somewhere, and what he does at the end of it. */
export interface Errand {
  /** The corners of his walk, from where he is: the last is where he ends up. */
  path: Pt[];
  face: number;
  /** The piece of furniture it's about. */
  piece: string;
}

/** `spot`, with the way there and the last step in to `gap` from `middle`. */
function errand(nav: NavGrid, from: Pt, spot: Spot | undefined, middle: Pt, gap: number, piece: string): Errand | undefined {
  const way = spot && wayTo(nav, from, spot.at);
  if (!spot || !way) return undefined;
  const last = closeIn(spot.at, middle, gap);
  return { path: dist(last, spot.at) > 0.05 ? [...way, last] : way, face: spot.face, piece };
}

/**
 * Up to a plant to graze on it: the way to the nearest side of it he can reach, then in until his mouth
 * is over the rim of its pot.
 */
export function grazeAt(nav: NavGrid, plant: Piece, from: Pt): Errand | undefined {
  const middle: Pt = [plant.x, plant.z];
  const reach = reachOf(plant);
  return errand(nav, from, spotBy(nav, middle, reach + 0.5, from), middle, reach + MUZZLE - 0.1, plant.id);
}

/** A rug's corners (four places round its edge, for a round one). */
export function rugCorners(rug: Piece): Pt[] {
  if (isRound(rug)) {
    const r = pieceRadius(rug) * Math.SQRT1_2;
    return [-1, 1].flatMap((sx) => [-1, 1].map((sz): Pt => [rug.x + sx * r, rug.z + sz * r]));
  }
  const b = pieceBox(rug);
  return [
    [b.minX, b.minZ],
    [b.maxX, b.minZ],
    [b.minX, b.maxZ],
    [b.maxX, b.maxZ],
  ];
}

/** Whether (x, z) is on a rug. */
function onRug(rug: Piece, [x, z]: Pt): boolean {
  if (isRound(rug)) return Math.hypot(x - rug.x, z - rug.z) < pieceRadius(rug);
  const b = pieceBox(rug);
  return x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ;
}

/** Up to a corner of a rug to nibble it: the nearest corner he can stand at, off the rug, his mouth on the corner. */
export function nibbleAt(nav: NavGrid, rug: Piece, from: Pt): Errand | undefined {
  let best: Errand | undefined;
  let bestD = Infinity;
  for (const corner of rugCorners(rug)) {
    const spot = spotBy(nav, corner, MUZZLE, from, (p) => !onRug(rug, p));
    if (!spot || dist(spot.at, from) >= bestD) continue;
    const found = errand(nav, from, spot, corner, MUZZLE, rug.id);
    if (!found) continue;
    best = found;
    bestD = dist(spot.at, from);
  }
  return best;
}

/** How far from the middle of the punching bag's frame he stands to butt it: his nose just short of the bag. */
const BUTT_GAP = 0.8;

/** Up to the punching bag to butt it: at its front or its back, whichever's nearer (its frame's uprights are either side). */
export function buttAt(nav: NavGrid, bag: Piece, from: Pt): Errand | undefined {
  const middle: Pt = [bag.x, bag.z];
  const ends = [1, -1]
    .map((s): Pt => [bag.x + Math.sin(bag.rotY) * s * (BUTT_GAP + 0.3), bag.z + Math.cos(bag.rotY) * s * (BUTT_GAP + 0.3)])
    .filter((p) => nav.walkable(p[0], p[1]))
    .sort((a, b) => dist(a, from) - dist(b, from));
  for (const at of ends) {
    const found = errand(nav, from, { at, face: toward(at, middle) }, middle, BUTT_GAP, bag.id);
    if (found) return found;
  }
  return undefined;
}

// ---- Tagging along ------------------------------------------------------------------------------------

/** How far behind whoever he's following he keeps: a polite distance. */
export const FOLLOW_GAP = 1.7;

/** Someone to follow: where they stand and which way they face. */
export interface Followed {
  x: number;
  z: number;
  rotY: number;
  moving: boolean;
}

/**
 * Where he goes to be with `p`: FOLLOW_GAP behind them, or off to one side of that where the dog is
 * (`dog`, which sits at their heel) or something's in the way. The nearest place he can stand, failing all those.
 */
export function followSpot(nav: NavGrid, p: Followed, dog?: Pt): Pt {
  const back = p.rotY + Math.PI;
  for (const turn of [0, 0.8, -0.8, 1.5, -1.5]) {
    const at: Pt = [p.x + Math.sin(back + turn) * FOLLOW_GAP, p.z + Math.cos(back + turn) * FOLLOW_GAP];
    if (nav.walkable(at[0], at[1]) && (!dog || dist(at, dog) >= APART + 0.3)) return at;
  }
  return nav.nearestWalkable([p.x + Math.sin(back) * FOLLOW_GAP, p.z + Math.cos(back) * FOLLOW_GAP]);
}

/**
 * Whether he's fine where he is (`end`, where he stands or is headed) while he follows `p`: they've
 * stopped and he's near them without crowding them, or he's as good as at `spot` (see followSpot).
 * Someone standing still who turns round doesn't need him circling behind them.
 */
export function staysPut(end: Pt, p: Followed, spot: Pt): boolean {
  const far = dist(end, [p.x, p.z]);
  return (!p.moving && far > 1.1 && far < FOLLOW_GAP + 0.7) || dist(end, spot) < 0.7;
}

// ---- He and the dog -----------------------------------------------------------------------------------

/** A walk under way: the dog's leg or his own (see dogAt). */
export type Walk = Pick<DogState, 'path' | 'speed' | 'face'>;

/** Where the walk has got to `t` seconds in. */
export function walkAt(w: Walk, t: number): Pt {
  const p = dogAt(w, t);
  return [p.x, p.z];
}

/** Where a walk ends. */
export const walkEnd = (w: Walk): Pt => w.path[w.path.length - 1];

/**
 * How many seconds from now Marc and the dog would be within `gap` of each other, if both carry on
 * (`goatT` and `dogT` seconds into their walks), looking `horizon` seconds ahead; none if they wouldn't.
 * With `closing`, being that near already only counts while they're still getting nearer: he's let
 * walk away from a dog he's beside.
 */
export function dogMeets(goat: Walk, goatT: number, dog: Walk, dogT: number, horizon: number, closing = false, gap = APART): number | undefined {
  const between = (t: number) => dist(walkAt(goat, goatT + t), walkAt(dog, dogT + t));
  const now = between(0);
  if (now < gap && !closing) return 0;
  for (let t = 0.1; t <= horizon + 1e-9; t += 0.1) {
    const d = between(t);
    if (d < gap && d < now - 0.01) return t;
  }
  return undefined;
}

/**
 * Out of the dog's way: the nearest place to `at` he can stand that the dog doesn't come within
 * APART (and a bit) of over the next `horizon` seconds, nor ends up at.
 */
export function asideFrom(nav: NavGrid, at: Pt, dog: Walk, dogT: number, horizon: number): Pt | undefined {
  const where: Pt[] = [walkEnd(dog)];
  for (let t = 0; t <= horizon + 1e-9; t += 0.2) where.push(walkAt(dog, dogT + t));
  const clear = (p: Pt) => where.every((d) => dist(p, d) >= APART + 0.35);
  const from = nav.nearestWalkable(at);
  for (const r of [1, 1.5, 2, 2.6]) {
    const spot = spotBy(nav, at, r, at, (p) => clear(p) && openLine(nav, from, p));
    if (spot) return spot.at;
  }
  return undefined;
}

// ---- Where he lives -----------------------------------------------------------------------------------

/**
 * The floor Marc lives on: the one he last rode the elevator to (`saved`), while the building still has
 * it; otherwise its bottom floor, the first in `floors`. None in a building without floors.
 */
export function homeFloor(floors: readonly string[], saved?: string): string | undefined {
  return saved !== undefined && floors.includes(saved) ? saved : floors[0];
}
