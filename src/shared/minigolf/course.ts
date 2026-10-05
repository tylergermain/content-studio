// Putt Street's nine holes (see types.ts), par 26, each in its own 10 m cell, snaking back from the
// kiosk: 1 Opening Putt, 2 The Windmill (front and centre, its sails turning toward Main Street), 3
// Bumper Alley, 4 The Ramp, 5 The Loop, 6 Three Tunnels, 7 The Jump, 8 The Volcano, 9 Friday Finale.
// Each tee is on the side you walk up from the hole before; everything is in the street frame, so a
// hole's numbers are where it is on Main Street (cells in shared/mainstreet.ts PUTT_CELLS).

import { PUTT_CELLS } from '../mainstreet.js';
import { FELT_H, arc, bend, closed, kerb, oval, p, rail, rampZ, rect, stone, twist } from './shapes.js';
import type { Felt, Hole, Tunnel, XZ } from './types.js';

export { FELT_H } from './shapes.js';

const cellOf = (n: number): XZ => ({ x: PUTT_CELLS[n - 1].x, z: PUTT_CELLS[n - 1].z });
/** The corners of the box x0..x1, z0..z1, for a keep-off. */
const box = (x0: number, z0: number, x1: number, z1: number): XZ[] => [p(x0, z0), p(x1, z0), p(x1, z1), p(x0, z1)];
/** The heading (yaw) from `a` toward `b`. */
const toward = (a: XZ, b: XZ) => Math.atan2(b.x - a.x, b.z - a.z);

/** 1. A straight 1.6 m lane south from the kiosk's side, over a 0.12 m hump halfway. */
function openingPutt(): Hole {
  const [x0, x1] = [-43.8, -42.2];
  const top = FELT_H + 0.12;
  return {
    n: 1,
    name: 'Opening Putt',
    par: 2,
    cell: cellOf(1),
    tee: p(-43, 39.4),
    cup: p(-43, 46.6),
    felt: [rect(x0, 38.6, x1, 42), rampZ(x0, x1, 42, 43, FELT_H, top), rampZ(x0, x1, 43, 44, top, FELT_H), rect(x0, 44, x1, 47.4)],
    walls: [kerb(closed([p(x0, 38.6), p(x1, 38.6), p(x1, 42), p(x1, 43), p(x1, 44), p(x1, 47.4), p(x0, 47.4), p(x0, 44), p(x0, 43), p(x0, 42)]))],
  };
}

/**
 * 2. Up to the windmill from the street side, its sails turning on the face toward Main Street, through
 * the 0.5 m tunnel in its house (when a sail isn't across the mouth) and out onto the green behind.
 */
function theWindmill(): Hole {
  const mill = { x: -56, z: 43.2, yaw: 0, base: 2.2, height: 4.2, tunnel: 0.5, blades: 4, period: 4, shut: 0.35 };
  const [hx0, hx1, hz0, hz1] = [mill.x - 1.1, mill.x + 1.1, mill.z - 1.1, mill.z + 1.1];
  return {
    n: 2,
    name: 'The Windmill',
    par: 3,
    cell: cellOf(2),
    tee: p(-56, 39.4),
    cup: p(-56, 46.5),
    felt: [rect(hx0, 38.6, hx1, hz0), rect(mill.x - 0.25, hz0, mill.x + 0.25, hz1), rect(-57.6, hz1, -54.4, 47.4)],
    walls: [kerb([p(hx0, hz0), p(hx0, 38.6), p(hx1, 38.6), p(hx1, hz0)]), kerb([p(hx0, hz1), p(-57.6, hz1), p(-57.6, 47.4), p(-54.4, 47.4), p(-54.4, hz1), p(hx1, hz1)])],
    mill,
    keepOff: [box(hx0, hz0, hx1, hz1)],
  };
}

/** 3. A Z of a dogleg, north, west and north again to the cup, with five bumper posts in the way. */
function bumperAlley(): Hole {
  return {
    n: 3,
    name: 'Bumper Alley',
    par: 3,
    cell: cellOf(3),
    tee: p(-65.7, 46.7),
    cup: p(-72.3, 39.4),
    felt: [rect(-66.8, 44, -64.6, 47.4), rect(-73.4, 41.6, -64.6, 44), rect(-73.4, 38.6, -71.2, 41.6)],
    walls: [kerb(closed([p(-64.6, 47.4), p(-66.8, 47.4), p(-66.8, 44), p(-73.4, 44), p(-73.4, 38.6), p(-71.2, 38.6), p(-71.2, 41.6), p(-64.6, 41.6)]))],
    bumpers: [
      { x: -65.6, z: 45.2, r: 0.2 },
      { x: -67.4, z: 42.4, r: 0.2 },
      { x: -68.8, z: 43.25, r: 0.2 },
      { x: -70.2, z: 42.4, r: 0.2 },
      { x: -71.9, z: 42.95, r: 0.2 },
    ],
  };
}

/** 4. A 1:6 ramp up to a 3 × 3 m green standing 0.45 m up, with a rail along its back. */
function theRamp(): Hole {
  const up = FELT_H + 0.45;
  return {
    n: 4,
    name: 'The Ramp',
    par: 2,
    cell: cellOf(4),
    tee: p(-69, 52.1),
    cup: p(-68.2, 58.6),
    felt: [rect(-69.9, 51.4, -68.1, 54.4), rampZ(-69.9, -68.1, 54.4, 57.1, FELT_H, up), rect(-70.5, 57.1, -67.5, 60.1, up)],
    walls: [
      kerb([p(-69.9, 57.1), p(-69.9, 54.4), p(-69.9, 51.4), p(-68.1, 51.4), p(-68.1, 54.4), p(-68.1, 57.1)]),
      kerb([p(-69.9, 57.1), p(-70.5, 57.1), p(-70.5, 60.1)]),
      kerb([p(-67.5, 60.1), p(-67.5, 57.1), p(-68.1, 57.1)]),
      rail([p(-70.5, 60.1), p(-67.5, 60.1)]),
    ],
    keepOff: [box(-69.9, 54.45, -68.1, 57.05)],
  };
}

/**
 * 5. East down a chute into a loop-the-loop 0.6 m round: it comes out a quarter of a meter to the
 * right and onto the green; too slow at its foot and it rolls back out toward the tee.
 */
function theLoop(): Hole {
  const loop = { entry: p(-55.8, 56), yaw: Math.PI / 2, r: 0.6, offset: 0.25, minSpeed: 5.6, width: 0.5 };
  // The chute's walls run right up to the loop's foot; the way out's inner wall starts a little past it,
  // out of the way of a ball going in down the middle of the chute.
  return {
    n: 5,
    name: 'The Loop',
    par: 3,
    cell: cellOf(5),
    tee: p(-59.8, 56),
    cup: p(-52.6, 55.6),
    felt: [
      rect(-60.4, 55.2, -58, 56.8),
      { poly: [p(-58, 55.2), p(-57, 55.75), p(-57, 56.25), p(-58, 56.8)], h: FELT_H },
      rect(-57, 55.75, -55.8, 56.25),
      rect(-55.8, 56, -55, 56.5),
      { poly: [p(-55, 56), p(-54.2, 54.95), p(-54.2, 57.55), p(-55, 56.5)], h: FELT_H },
      rect(-54.2, 54.95, -51.6, 57.55),
    ],
    walls: [
      kerb([p(-55.8, 55.75), p(-57, 55.75), p(-58, 55.2), p(-60.4, 55.2), p(-60.4, 56.8), p(-58, 56.8), p(-57, 56.25), p(-55.8, 56.25)]),
      kerb([p(-55.74, 56), p(-55, 56), p(-54.2, 54.95), p(-51.6, 54.95), p(-51.6, 57.55), p(-54.2, 57.55), p(-55, 56.5), p(-55.8, 56.5)]),
    ],
    loop,
  };
}

/**
 * 6. A grassy hill 1.2 m high across the lane, with three mouths in its near side: the left one comes
 * out a meter from the cup, the middle one on the green 3 m away, and the right one back by the tee.
 */
function threeTunnels(): Hole {
  const hill = { x: -43, z: 56, rx: 1.4, rz: 2.7, height: 1.2 };
  // The mouths are on the hill's foot, facing the tee: left (north), middle and right (south).
  const mouth = (phi: number): XZ => p(hill.x - hill.rx * Math.cos(phi), hill.z + hill.rz * Math.sin(phi));
  const cup = p(-40.2, 55.2);
  const left = p(-41.15, 54.85);
  const tunnels: Tunnel[] = [
    { mouth: mouth(-0.42), r: 0.16, exit: left, yaw: toward(left, p(-40.2, 55.45)), delay: 1.1 },
    { mouth: mouth(0), r: 0.16, exit: p(-41.3, 57.9), yaw: Math.PI / 2, delay: 0.9 },
    { mouth: mouth(0.42), r: 0.16, exit: p(-47, 58), yaw: Math.PI / 2, delay: 1.5 },
  ];
  return {
    n: 6,
    name: 'Three Tunnels',
    par: 3,
    cell: cellOf(6),
    tee: p(-47, 56),
    cup,
    felt: [rect(-47.6, 53.4, -43, 58.6), rect(-43, 53.4, -38.6, 58.6)],
    hills: [hill],
    walls: [kerb(closed([p(-47.6, 53.4), p(-38.6, 53.4), p(-38.6, 58.6), p(-47.6, 58.6)]))],
    tunnels,
    keepOff: [oval(hill, hill.rx, hill.rz, 16)],
  };
}

/**
 * 7. Up a ramp whose top edge is a 0.35 m lip, over a 1.2 m water channel (a stroke, and back where
 * you putted from) and down onto a green with a rail at its back. The green's edge over the water
 * has no kerb: back off the rail too hard and it rolls in.
 */
function theJump(): Hole {
  const lip = FELT_H + 0.35;
  return {
    n: 7,
    name: 'The Jump',
    par: 3,
    cell: cellOf(7),
    tee: p(-43, 65.2),
    cup: p(-43, 72.2),
    felt: [rect(-44, 64.6, -42, 66.4), rampZ(-44, -42, 66.4, 68.5, FELT_H, lip, [2]), rect(-44.4, 69.7, -41.6, 73.6)],
    water: [{ poly: [p(-44.4, 68.5), p(-41.6, 68.5), p(-41.6, 69.7), p(-44.4, 69.7)], h: 0 }],
    walls: [
      kerb([p(-44, 68.5), p(-44, 66.4), p(-44, 64.6), p(-42, 64.6), p(-42, 66.4), p(-42, 68.5)]),
      stone([p(-44, 68.5), p(-44.4, 68.5), p(-44.4, 69.7)], 0.45),
      stone([p(-42, 68.5), p(-41.6, 68.5), p(-41.6, 69.7)], 0.45),
      kerb([p(-44.4, 69.7), p(-44.4, 73.6)]),
      rail([p(-44.4, 73.6), p(-41.6, 73.6)]),
      kerb([p(-41.6, 73.6), p(-41.6, 69.7)]),
    ],
    keepOff: [box(-44, 66.45, -42, 68.5)],
  };
}

/** 8. West up a volcano 2.2 m round and 0.5 m high, the cup at the bottom of the crater in its top. */
function theVolcano(): Hole {
  const cone = { x: -57.4, z: 69, r: 2.2, h: FELT_H, height: 0.5, crater: { r: 0.35, depth: 0.15 } };
  return {
    n: 8,
    name: 'The Volcano',
    par: 3,
    cell: cellOf(8),
    tee: p(-52.2, 69),
    cup: p(cone.x, cone.z),
    felt: [rect(-60.2, 66.4, -51.4, 71.6)],
    cones: [cone],
    walls: [kerb(closed([p(-60.2, 66.4), p(-51.4, 66.4), p(-51.4, 71.6), p(-60.2, 71.6)]))],
    keepOff: [oval(cone, cone.r, cone.r, 20)],
  };
}

/**
 * 9. An S: west from the tee, round a banked bend and back east under the Friday Tower arch, round
 * another and west again to the cup. The bends lean in (their outer edge 8 cm up), easing in and out
 * over the last 0.7 m of each straight.
 */
function fridayFinale(): Hole {
  const [h, bank, n] = [FELT_H, 0.08, 8];
  const c1 = p(-71, 68.4);
  const c2 = p(-66.6, 71);
  const in1 = arc(c1, 0.6, -Math.PI / 2, -Math.PI * 1.5, n);
  const out1 = arc(c1, 2, -Math.PI / 2, -Math.PI * 1.5, n);
  const in2 = arc(c2, 0.6, -Math.PI / 2, Math.PI / 2, n);
  const out2 = arc(c2, 2, -Math.PI / 2, Math.PI / 2, n);
  const felt: Felt[] = [
    rect(-70.3, 66.4, -64.6, 67.8),
    ...twist(p(-70.3, 66.4), out1[0], in1[0], p(-70.3, 67.8), [h, h + bank, h, h]),
    ...bend(in1, out1, h, bank),
    ...twist(in1[n], p(-70.3, 69), p(-70.3, 70.4), out1[n], [h, h, h, h + bank]),
    rect(-70.3, 69, -67.3, 70.4),
    ...twist(p(-67.3, 69), out2[0], in2[0], p(-67.3, 70.4), [h, h + bank, h, h]),
    ...bend(in2, out2, h, bank),
    ...twist(in2[n], out2[n], p(-67.3, 73), p(-67.3, 71.6), [h, h + bank, h, h]),
    rect(-73, 71.6, -67.3, 73),
  ];
  const round = [
    p(-73, 73),
    p(-67.3, 73),
    ...[...out2].reverse(),
    p(-67.3, 69),
    p(-70.3, 69),
    ...[...in1].reverse(),
    p(-70.3, 67.8),
    p(-64.6, 67.8),
    p(-64.6, 66.4),
    p(-70.3, 66.4),
    ...out1,
    p(-70.3, 70.4),
    p(-67.3, 70.4),
    ...in2,
    p(-67.3, 71.6),
    p(-73, 71.6),
  ];
  return {
    n: 9,
    name: 'Friday Finale',
    par: 4,
    cell: cellOf(9),
    tee: p(-65.2, 67.1),
    cup: p(-72.2, 72.3),
    felt,
    walls: [kerb(round), rail([p(-73, 71.6), p(-73, 73)])],
    arch: { x: -68.8, z: 69.7, yaw: Math.PI / 2, width: 1.8, height: 2.5 },
    keepOff: [box(-69.3, 69, -68.3, 70.4)],
  };
}

export const HOLES: readonly Hole[] = [openingPutt(), theWindmill(), bumperAlley(), theRamp(), theLoop(), threeTunnels(), theJump(), theVolcano(), fridayFinale()];

/** Par for the course. */
export const PAR = HOLES.reduce((sum, h) => sum + h.par, 0);
