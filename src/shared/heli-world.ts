// What Friday One flies in, in the street frame (shared/mainstreet.ts): what's solid, how high the
// ground is (heli-terrain.ts), and where it may set down. The pilot's page and the office both ask the
// same, so the office can check every pose it's sent.
//
// Solid is everything it could fly into: Friday Tower as the street sees it (its plate up to the roof,
// bar 2 overhanging its west end, the balconies, the back offices on their posts, the marquee, the
// stairs down its west side, and up on the roof the bar's clutter, the elevator's housing and mast, the
// stage's rig and the parasols); the two neighbours behind it; the farm's barn, silo and windmill
// with its sails; the lighthouse; the windsock by the heliport; the SCENIC LOOP billboard; Putt
// Street's kiosk, fence, gate, record board, windmill and arch; and whatever stands on the claimed
// plots, a crane's whole jib sweep included. Trees and lamps it flies through.
//
// It never sets down on the lot in front of the garage (the parachutes come down there, and the cars
// come and go through the garage's mouth), the tower or the lot down its east side, golf's green round
// the flagstick, the water, Putt Street, a claimed plot, the cows' pasture, the park's benches,
// windsock and boards, uneven ground or past the edge of town; anywhere else that's level it may, and
// on its pad in Friday Park always. Who's standing under it, on any floor, is the office's to say
// (server/heli), and what's in the way on your floor your page's.

import { LOT, SIDE_LOT, type Box } from './garage.js';
import { BALCONY, ELEVATOR, ELEVATOR_FRONT, EXIT_STAIRS, FLOOR, GOLF_HOLE, ROOF_BAR, SLAB, STAGE, WALL_HEIGHT, WALL_T, WING, roofDrop, streetBelow, wingMinZ } from './layout.js';
import { businessBoxes, CLAIMABLE, claimedBox, GROUNDS, isClaimable, PARK, PLATE, PLOTS, PUTT, roundSolid, type Solid } from './mainstreet.js';
import { HOLES } from './minigolf/course.js';
import type { BusinessCard } from './protocol/street.js';
import { BILLBOARD, FARM, LAKE, LIGHTHOUSE, SPURS, shoreX } from './scenic.js';
import { TOWER } from './tower.js';
import { BODY, HELI, tailOf } from './heli.js';
import { discHitsBox, discHitsCircle, turnedHitsBox, turnedHitsCircle } from './heli-shapes.js';
import { heliTerrainOver } from './heli-terrain.js';

export { heliTerrain, heliTerrainOver } from './heli-terrain.js';

/** The building, walls included. */
const B: Box = { minX: -PLATE.halfX, maxX: PLATE.halfX, minZ: -PLATE.halfZ, maxZ: PLATE.halfZ };
/** Storey `k`'s floor, over the street. */
const level = (k: number) => -streetBelow(k);
/** Under the street, so nothing slips under a solid that stands on it. */
const FOOT = -1;

const box = (minX: number, maxX: number, minZ: number, maxZ: number, bottom: number, top: number): Solid => ({ minX, maxX, minZ, maxZ, bottom, top });

/**
 * Friday Tower, `roofFloors` storeys and the roof over them, `real` of them real floors (unknown: as
 * many as there could be, for the balconies and back offices, and as few for the bars' overhangs).
 */
function towerSolids(roofFloors: number, real: number | undefined): Solid[] {
  const deck = roofDrop(roofFloors);
  const floors = real ?? roofFloors;
  const out: Solid[] = [box(B.minX, B.maxX, B.minZ, B.maxZ, FOOT, deck)];
  // A bar of glass past the building's ends (bar 2 reaches 2.4 m west over storeys 7 to 10), wherever its storeys aren't real floors.
  for (const bar of TOWER.bars) {
    const from = Math.max(bar.from, real ?? 0);
    if (from >= bar.to) continue;
    const bottom = level(from) - SLAB;
    const top = level(bar.to) - SLAB;
    if (bar.minX < B.minX) out.push(box(bar.minX, B.minX, B.minZ, B.maxZ, bottom, top));
    if (bar.maxX > B.maxX) out.push(box(B.maxX, bar.maxX, B.minZ, B.maxZ, bottom, top));
  }
  // A balcony off every real floor, and off each storey under the first bar, on posts down to the street.
  const balconies = Math.max(floors, TOWER.bars[0].from);
  out.push(box(BALCONY.minX, BALCONY.maxX, B.maxZ, BALCONY.maxZ, FOOT, level(balconies - 1) + 1.2));
  // The real floors' back offices, built out as far as they can be, on their posts down to the street.
  if (floors > 0) out.push(box(WING.minX - WALL_T, B.maxX, wingMinZ(WING.rows) - WALL_T, B.minZ, FOOT, level(floors)));
  // The marquee over the garage's mouth (world/forecourt.ts), and the bottom floor's stairs down its west side.
  out.push(box(4, 17, B.maxZ, B.maxZ + 4, 2.4, level(0)));
  out.push(box(EXIT_STAIRS.minX, B.minX, EXIT_STAIRS.landingZ0 - 0.2, EXIT_STAIRS.landingZ1 + EXIT_STAIRS.steps * EXIT_STAIRS.run + 0.3, FOOT, level(0) + 1.2));
  // Up on the roof: its railing, loungers, sofas and tables all round; the elevator's housing and the
  // mast on it; the stage, its LED wall and its rig; the bar under its pergola; the two parasols.
  const hz = (B.minZ + ELEVATOR_FRONT) / 2;
  out.push(
    box(B.minX, B.maxX, B.minZ, B.maxZ, deck - 0.1, deck + 1.25),
    box(ELEVATOR.x - ELEVATOR.width / 2, ELEVATOR.x + ELEVATOR.width / 2, B.minZ, ELEVATOR_FRONT, deck, deck + WALL_HEIGHT + 0.3),
    roundSolid(ELEVATOR.x, hz, 0.6, deck + WALL_HEIGHT, deck + WALL_HEIGHT + 14.9),
    box(STAGE.minX - 0.3, STAGE.maxX + 0.3, B.minZ, STAGE.maxZ, deck, deck + 6),
    box(ROOF_BAR.x - ROOF_BAR.depth / 2 - 1, FLOOR.maxX, ROOF_BAR.minZ - 0.9, ROOF_BAR.maxZ + 0.9, deck, deck + 3.6),
    roundSolid(-0.8, FLOOR.maxZ - 1.1, 1.5, deck, deck + 2.9),
    roundSolid(2, FLOOR.maxZ - 1.1, 1.5, deck, deck + 2.9),
  );
  return out;
}

/** The two neighbours left behind the tower, [x, z, width, height, depth] as world/outside.ts has them, in the boxes its neighbourBoxes puts round them. */
const BEHIND: readonly (readonly [number, number, number, number, number])[] = [
  [-20, -42, 18, 14, 10],
  [8, -44, 16, 20, 12],
];

/** The farm's windmill: its sails turn in front of it, on a hub 12 m up and 3.35 m out (world/scenic/farm.ts), 8.9 m round at most. */
const SAILS = { y: 12, out: 3.35, r: 8.9 } as const;

/**
 * Putt Street's kiosk (its PUTT STREET sign and ball reach 4.6 m: world/minigolf/kiosk.ts), its picket
 * fence, the gate's posts (3.4 m with their balls on top) and the record board (3 m) by it, and its
 * holes' windmill and arch (shared/minigolf).
 */
function puttSolids(): Solid[] {
  const f = PUTT.fence;
  const g = PUTT.gate;
  const r = PUTT.record;
  const t = 0.15;
  const top = f.height + 0.1;
  const out: Solid[] = [
    { ...PUTT.kiosk, bottom: FOOT, top: 4.8 },
    box(g.minX - 0.3, g.minX + 0.3, f.minZ - 0.3, f.minZ + 0.3, FOOT, 3.5),
    box(g.maxX - 0.3, g.maxX + 0.3, f.minZ - 0.3, f.minZ + 0.3, FOOT, 3.5),
    box(r.x - 1.7, r.x + 1.7, r.z - 0.3, r.z + 0.3, FOOT, 3.1),
    box(f.minX - t, f.maxX + t, f.minZ - t, f.minZ + t, FOOT, top),
    box(f.minX - t, f.maxX + t, f.maxZ - t, f.maxZ + t, FOOT, top),
    box(f.minX - t, f.minX + t, f.minZ - t, f.maxZ + t, FOOT, top),
    box(f.maxX - t, f.maxX + t, f.minZ - t, f.maxZ + t, FOOT, top),
  ];
  for (const hole of HOLES) {
    // The windmill's house, and its sails turning round in front of it, as far as they could reach.
    const m = hole.mill;
    if (m) out.push(roundSolid(m.x, m.z, Math.max(m.base * 0.75, m.height * 0.6) + 0.3, FOOT, m.height * 1.6));
    // The arch's posts and its bars over the lane, across it either side of its middle.
    const a = hole.arch;
    if (a) {
      const s = Math.abs(Math.sin(a.yaw));
      const c = Math.abs(Math.cos(a.yaw));
      const across = a.width / 2 + 0.6;
      const along = 0.8;
      const hx = across * c + along * s;
      const hz = across * s + along * c;
      out.push(box(a.x - hx, a.x + hx, a.z - hz, a.z + hz, FOOT, a.height + 0.5));
    }
  }
  return out;
}

/** What stands still out there whatever's on the street. */
const FIXED: readonly Solid[] = [
  ...BEHIND.map(([x, z, w, h, d]) => box(x - w / 2 - 0.2, x + w / 2 + 0.2, z - d / 2 - 0.2, z + d / 2 + 0.2, FOOT, h + 0.4)),
  // The barn (its roof's ridge a little over its collider's 9 m), the silo and its dome, and the windmill, its cap and its sails.
  box(FARM.barn.x - 7, FARM.barn.x + 7, FARM.barn.z - 7, FARM.barn.z + 7, FOOT, 9.6),
  roundSolid(FARM.silo.x, FARM.silo.z, 3.1, FOOT, 16.2),
  roundSolid(FARM.windmill.x, FARM.windmill.z, 3.4, FOOT, 15),
  box(FARM.windmill.x - SAILS.r, FARM.windmill.x + SAILS.r, FARM.windmill.z + SAILS.out - 0.45, FARM.windmill.z + SAILS.out + 0.45, SAILS.y - SAILS.r, SAILS.y + SAILS.r),
  // The lighthouse out on its point (its collider in world/scenic/coast.ts), and the windsock by the heliport.
  roundSolid(LIGHTHOUSE.x, LIGHTHOUSE.z, 3.8, FOOT, 30),
  // The rocks either side of the tunnel's ends are ground (heli-terrain.ts), which nothing flies into;
  // their cores are solid too, for the office's checks, well inside what the page draws of them
  // (anywhere within 0.45 of a rock's radius it stands at least 0.3 of its height).
  ...SPURS.map(([x, z, r, h]) => roundSolid(x, z, r * 0.45, FOOT, h * 0.28)),
  roundSolid(PARK.windsock.x, PARK.windsock.z, 1.2, FOOT, PARK.windsock.pole + 0.8),
  // The SCENIC LOOP billboard between Friday Park and Plot 7, its board and posts.
  box(BILLBOARD.x - BILLBOARD.width / 2 - 0.2, BILLBOARD.x + BILLBOARD.width / 2 + 0.2, BILLBOARD.z - 0.4, BILLBOARD.z + 0.4, FOOT, BILLBOARD.height + 0.3),
  ...puttSolids(),
];

/**
 * Everything solid it could fly into, with the tower `roofFloors` storeys tall (see roofFloors in
 * features/rooftop), `realFloors` of them the building's real floors (builtFloors on the page,
 * ctx.floors on the office; left out, as many as there could be), and these businesses on the street.
 */
export function heliSolids(roofFloors: number, cards: readonly BusinessCard[], realFloors?: number): Solid[] {
  return [...towerSolids(roofFloors, realFloors), ...FIXED, ...businessBoxes(cards)];
}

// ---- Where it may set down ------------------------------------------------------------------------

/** Whether (x, z), its hub, is on its pad in Friday Park. */
export const onPad = (x: number, z: number): boolean => Math.hypot(x - PARK.pad.x, z - PARK.pad.z) <= PARK.pad.r;

const TAIL_HL = (BODY.tail.front - BODY.tail.back) / 2;
const TAIL_MID = (BODY.tail.front + BODY.tail.back) / 2;
const TAIL = { x: 0, z: 0, s: 0, c: 1 };
/** Where it's being asked about, for tailOf, so asking makes nothing new. */
const AT = { x: 0, z: 0, yaw: 0 };

/** Its footprint (the disc its rotor sweeps, and its tail, turned) over box `b`, the tail as tailOf last put it. */
const footOver = (b: Box, x: number, z: number) => discHitsBox(b, x, z, HELI.rotor) || turnedHitsBox(b, TAIL.x, TAIL.z, TAIL.s, TAIL.c, BODY.tail.half, TAIL_HL);
/** The same over the circle `r` round (cx, cz). */
const footOverCircle = (cx: number, cz: number, r: number, x: number, z: number) => discHitsCircle(x, z, HELI.rotor, cx, cz, r) || turnedHitsCircle(cx, cz, r, TAIL.x, TAIL.z, TAIL.s, TAIL.c, BODY.tail.half, TAIL_HL);

/** The tower, and the lot down its east side. */
const TOWER_LOTS: readonly Box[] = [B, SIDE_LOT];
/** Each claimable plot's ground, once it's claimed. */
const CLAIMED = Object.fromEntries(CLAIMABLE.map((p) => [p, claimedBox(p)])) as Readonly<Record<(typeof CLAIMABLE)[number], Box>>;
/** The park's benches, its map board, the plots' FOR LEASE boards, and round the windsock: things under it as it sets down. */
const PARK_THINGS: readonly Box[] = [
  ...PARK.benches.map((b) => ({ minX: b.x - 1.2, maxX: b.x + 1.2, minZ: b.z - 1.2, maxZ: b.z + 1.2 })),
  { minX: PARK.board.x - PARK.board.width / 2 - 0.3, maxX: PARK.board.x + PARK.board.width / 2 + 0.3, minZ: PARK.board.z - 0.5, maxZ: PARK.board.z + 0.5 },
  ...CLAIMABLE.map((p) => PLOTS[p].board!).map((b) => ({ minX: b.x - 2.2, maxX: b.x + 2.2, minZ: b.z - 0.5, maxZ: b.z + 0.5 })),
  { minX: PARK.windsock.x - 0.6, maxX: PARK.windsock.x + 0.6, minZ: PARK.windsock.z - 0.6, maxZ: PARK.windsock.z + 0.6 },
];
/** How far from the sea and the lake it keeps its footprint (m). */
const WET = 3;
/** The points of its footprint the water's looked for under: the hub, round the rotor's disc, and along its tail, in its own frame [x, z]. */
const WET_POINTS: readonly (readonly [number, number])[] = [
  [0, 0],
  ...Array.from({ length: 8 }, (_, i) => [Math.sin((i * Math.PI) / 4) * HELI.rotor, Math.cos((i * Math.PI) / 4) * HELI.rotor] as const),
  [-BODY.tail.half, BODY.tail.back],
  [BODY.tail.half, BODY.tail.back],
  [0, TAIL_MID],
];

/** Whether any of its footprint at (x, z), its heading's sine `s` and cosine `c`, is over the sea or the lake. */
function overWater(x: number, z: number, s: number, c: number): boolean {
  for (const [lx, lz] of WET_POINTS) {
    const px = x + lx * c + lz * s;
    const pz = z - lx * s + lz * c;
    if (px < shoreX(pz) + WET) return true;
    if (((px - LAKE.x) / (LAKE.rx + WET)) ** 2 + ((pz - LAKE.z) / (LAKE.rz + WET)) ** 2 < 1) return true;
  }
  return false;
}

/** Why it may not set down at (x, z) turned `yaw`, with these businesses on the street; null where it may. */
export function whyNotLand(x: number, z: number, yaw: number, cards: readonly BusinessCard[]): string | null {
  if (Math.hypot(x, z) > GROUNDS) return "That's the edge of town";
  if (onPad(x, z)) return null;
  AT.x = x;
  AT.z = z;
  AT.yaw = yaw;
  tailOf(AT, TAIL);
  if (footOver(LOT, x, z)) return 'Not on the lot: the parachutes land there';
  for (const b of TOWER_LOTS) if (footOver(b, x, z)) return "Can't land here";
  if (footOverCircle(GOLF_HOLE.x, GOLF_HOLE.z, GOLF_HOLE.green + 0.7, x, z)) return 'Not on the green';
  if (footOver(PUTT.fence, x, z)) return 'Not on Putt Street';
  for (const card of cards) if (isClaimable(card.plot) && footOver(CLAIMED[card.plot], x, z)) return "That plot's taken";
  if (footOver(FARM.pasture, x, z)) return "Not in the cows' field";
  for (const b of PARK_THINGS) if (footOver(b, x, z)) return "Can't land here";
  if (overWater(x, z, TAIL.s, TAIL.c)) return "Can't land on water";
  // Level ground under all of it: the box round the rotor's disc and the tail's end.
  const r = HELI.rotor;
  const tx = x - TAIL.s * HELI.tail;
  const tz = z - TAIL.c * HELI.tail;
  if (heliTerrainOver(Math.min(x - r, tx - 1), Math.max(x + r, tx + 1), Math.min(z - r, tz - 1), Math.max(z + r, tz + 1)) > 0.3) return 'Too steep to land';
  return null;
}
