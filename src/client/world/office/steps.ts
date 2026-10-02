import * as THREE from 'three';
import { seatPlace } from '../../../shared/layout';
import { STEPS, STEPS_TOP, stepsSeats, stepsSolids } from '../../../shared/steps';
import { mergeByMaterial, mesh, roundedBox, textPlane, toon } from '../toon';
import type { Collider, Interactable } from '../types';
import { keep, type Fixture } from './fixture';
import { PALETTE, box, glassPane, type Looks } from './materials';

// The Steps: a six-tier amphitheatre across the lounge, rising west from the floor in front of the TV,
// to walk up and sit on. Carpeted tiers with a strip in the floor's trim color along each nosing and
// the tier's number on its riser, a bench on each with a cushion at every place, a wall behind the top
// tier and a glass rail stepping down each side. The strip carries on round the block, down each side
// step by step and along the back, so from the lift it's a dark block with its own outline drawn on
// it. Where it stands, what you bump into of it and where there is to sit on it are shared/steps.ts,
// which the rules and the paths read too.

/** The carpet the tiers and the wall behind them are in. */
const CARPET = '#101112';
/** The cushions that aren't in the floor's trim color, and the numerals: the paper of the brand's walls. */
const PAPER = '#f5f6f2';
/** A tier's bench: a board this long across each place, this deep from just behind the nosing, with a cushion on it. */
const BENCH = { length: 2.2, depth: 0.42, board: 0.03, cushion: 0.05 } as const;
/** The strip along a tier's front edge: how far back it goes and how far down the riser. */
const NOSING = 0.05;
/** How far the strip stands out of the carpet, so the two never flicker from across the room. */
const PROUD = 0.01;
/** The two ways up between the benches, where the numerals are. */
const AISLES = [-1.45, 1.45] as const;
/** How near a place you stand to sit down on it (they're 2.9 apart along a tier, and 0.75 from one tier to the next). */
const REACH = 1.2;

/** Where tier `i` (from 1, the bottom one) starts: its riser, on its east side. */
const riser = (i: number) => STEPS.east - (i - 1) * STEPS.run;

/** The Steps as they're built, and each place to sit on them: what you look at to sit there, and what you use it by. */
function buildSteps(looks: Looks): { group: THREE.Group; seats: Interactable[] } {
  const { west, minZ, maxZ, tiers, run, rise, rail, wall } = STEPS;
  const group = new THREE.Group();
  const carpet = toon(CARPET);
  const wood = toon(PALETTE.wood);
  const ink = toon(PALETTE.deskLeg);
  const paper = toon(PAPER);
  /** Everything of it that's one plain color and never moves, drawn as a mesh per material. */
  const parts = new THREE.Group();
  const length = maxZ - minZ;
  const across = length + 2 * wall;

  for (let i = 1; i <= tiers; i++) {
    const top = i * rise;
    const x = riser(i) - run / 2;
    // The tier, solid from the floor up, and as wide as the rails either side stand on.
    parts.add(mesh(box(run, top, across), carpet, x, top / 2, 0));
    // Its nosing, from one side of the block to the other.
    parts.add(mesh(box(NOSING + PROUD, NOSING + PROUD, across + 2 * PROUD), looks.trim, riser(i) - (NOSING - PROUD) / 2, top - (NOSING - PROUD) / 2, 0, false));
    for (const side of [-1, 1]) {
      // The rail down each side: a pane of glass on the tier's end under a wood top rail, a post where it steps.
      const z = side * (across - wall) / 2;
      const pane = glassPane(run - 0.06, rail - 0.14);
      pane.position.set(x, top + rail / 2 - 0.02, z);
      parts.add(pane);
      parts.add(mesh(box(run, 0.06, wall), wood, x, top + rail - 0.03, z, false));
      parts.add(mesh(box(0.05, rail - 0.06, 0.05), ink, riser(i) - 0.025, top + (rail - 0.06) / 2, z, false));
      // The strip on the block's side: along under the tier's edge (to the back of the wall, for the top one), and down its riser to the one below.
      const face = side * (across + PROUD) / 2;
      const from = i === tiers ? west - wall : riser(i + 1);
      parts.add(mesh(box(riser(i) - from, NOSING, PROUD), looks.trim, (from + riser(i)) / 2, top - NOSING / 2, face, false));
      const foot = Math.max(0, top - rise - NOSING);
      parts.add(mesh(box(NOSING, top - NOSING - foot, PROUD), looks.trim, riser(i) - NOSING / 2, (foot + top - NOSING) / 2, face, false));
    }
  }
  // The wall behind the top tier, a rail's height over it, with the same wood along its top, and the strip along its back at the top tier's height.
  const back = STEPS_TOP + rail;
  parts.add(mesh(box(wall, back, across), carpet, west - wall / 2, back / 2, 0));
  parts.add(mesh(box(wall + 0.04, 0.06, across + 0.04), wood, west - wall / 2, back - 0.02, 0, false));
  parts.add(mesh(box(PROUD, NOSING, across + 2 * PROUD), looks.trim, west - wall - PROUD / 2, STEPS_TOP - NOSING / 2, 0, false));
  // A board along its inside to lean back on from the top tier.
  parts.add(mesh(box(0.03, 0.3, length - 0.2), wood, west + 0.015, STEPS_TOP + 0.5, 0, false));
  group.add(mergeByMaterial(parts));

  // Each tier's number on its riser, either side of the middle benches.
  for (let i = 1; i <= tiers; i++) {
    const numeral = textPlane(String(i), { color: PAPER, size: 64 });
    numeral.scale.setScalar(0.62);
    numeral.rotation.y = Math.PI / 2;
    for (const z of AISLES) {
      // The same sign twice: a copy shares its picture.
      const at = numeral.clone();
      at.position.set(riser(i) + PROUD / 2, (i - 1) * rise + (rise - NOSING) / 2, z);
      group.add(at);
    }
  }

  // The benches: a board and a cushion at each place, which is what you look at to sit there. The
  // cushions take turns between the floor's trim color and paper.
  const seats: Interactable[] = [];
  const board = box(BENCH.depth, BENCH.board, BENCH.length);
  const cushion = roundedBox(BENCH.depth - 0.06, BENCH.cushion, BENCH.length - 0.7, 0.1);
  stepsSeats().forEach((seat, t) => {
    const top = (t + 1) * rise;
    seat.places.forEach((_, n) => {
      const place = seatPlace(seat, n);
      const bench = new THREE.Group();
      bench.position.set(riser(t + 1) - NOSING - BENCH.depth / 2, top, place.z);
      bench.add(mesh(board, wood, 0, BENCH.board / 2, 0, false));
      bench.add(mesh(cushion, (t + n) % 2 ? paper : looks.trim, 0, BENCH.board + BENCH.cushion / 2, 0, false));
      const it: Interactable = { kind: 'seat', seatId: seat.id, x: place.x, y: place.y, z: place.z, radius: REACH, off: true };
      bench.userData.interact = it;
      seats.push(it);
      group.add(bench);
    });
  });
  return { group, seats };
}

/**
 * The Steps. They're the floor's choice (see RoomOptions.steps): on a floor that hasn't them they're
 * put away, with what you'd bump into of them and the places to sit on them. Sitting there is the
 * seats' own business (features/seating), by the ids shared/steps.ts gives them.
 */
export const steps: Fixture = (site) => {
  const built = buildSteps(site.looks);
  // What's in the way of them is the shared list (the tests walk the same one).
  const colliders: Collider[] = stepsSolids();
  built.group.visible = false;
  site.get('room').on((room) => {
    built.group.visible = room.steps;
    for (const seat of built.seats) seat.off = !room.steps;
    keep(site.colliders, colliders, room.steps);
    keep(site.interactables, built.seats, room.steps);
  });
  return { group: built.group };
};
