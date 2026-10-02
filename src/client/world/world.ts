import type * as THREE from 'three';
import type { FloorPalette } from '../../shared/floors';
import { LOFT, WALL_HEIGHT, FLOOR, type DeskDef } from '../../shared/layout';
import { OFFICE_PLAN, type BoardKey, type MapPlan } from '../../shared/maps';
import { wayHome, wayIn, wayToBalcony, type Pt } from '../../shared/nav';
import type { Area } from './confetti';
import type { Gong } from '../features/gong/world';
import type { Collider, DeskView, Interactable, Office } from './types';

/*
 * A world: the office, built and ready to walk round, as the parts that follow its workers and its
 * boards see it: where the seats and the boards are, what's in the way, how workers walk in and out.
 * The office has a great deal more of its own (the elevator, the balcony, the lounge…), which they
 * reach through ctx.office.
 */

/** The ways a worker walks. */
export interface Ways {
  /**
   * Out of the building from `seat`: the first point is where it gets down. `chute`: it goes over
   * the balcony railing by parachute at the end.
   */
  home(seat: DeskDef): { way: Pt[]; chute: boolean };
  /** In to beside `seat`'s chair, from the elevator, where workers come in. */
  in(seat: DeskDef): Pt[];
}

export interface World {
  plan: MapPlan;
  group: THREE.Group;
  colliders: Collider[];
  interactables: Interactable[];
  /** Every seat by id: the desks, the overflow seats, the board agents' places and the meeting chairs. */
  desks: Map<string, DeskView>;
  boardMeshes: Record<BoardKey, THREE.Mesh>;
  /** The meeting's output as it's written, and how the meeting's going. */
  meetingBoard?: THREE.Mesh;
  meetingSign?: THREE.Mesh;
  /** The gong a merged pull request rings. */
  gong?: Gong;
  ways: Ways;
  /** Where confetti rains when a pull request merges, and from how high over each spot. */
  rain: { area: Area; top: (x: number, z: number) => number }[];
  /** Brings out the overflow seats in `out` and puts the rest away: the colliders of the ones that just came out. */
  setBeanbags(out: Set<string>): Collider[];
  /** Paints it in a floor's colors, so each project looks like itself. */
  setLook(p: FloorPalette): void;
  setProjectName(name: string): void;
  /** Animates it; doors open for anyone in `people` who comes up to them. */
  update(t: number, dt: number, people: Iterable<{ x: number; y: number; z: number }>): void;
}

/** Where confetti rains from over (x, z) downstairs in the office: the ceiling, or under the loft, the underside of its floor. */
function ceilingOver(x: number, z: number): number {
  const loft = x > LOFT.minX && x < LOFT.maxX && z > LOFT.minZ && z < LOFT.maxZ;
  return loft ? LOFT.y - 0.35 : WALL_HEIGHT - 0.1;
}

/**
 * The office as a world. `upstairs` says whether this floor is above the bottom one (no exit door:
 * workers leave by the balcony), and `wing` how many rows its back office is built out (see WING).
 */
export function officeWorld(office: Office, upstairs: () => boolean, wing: () => number): World {
  return {
    plan: OFFICE_PLAN,
    group: office.group,
    colliders: office.colliders,
    interactables: office.interactables,
    desks: office.desks,
    boardMeshes: office.boardMeshes,
    meetingBoard: office.meetingBoard,
    meetingSign: office.meetingSign,
    gong: office.gong,
    ways: {
      home: (seat) => (upstairs() ? { way: wayToBalcony(seat, wing()), chute: true } : { way: wayHome(seat, wing()), chute: false }),
      in: (seat) => wayIn(seat, wing()),
    },
    rain: [
      { area: FLOOR, top: ceilingOver },
      { area: LOFT, top: () => LOFT.y + LOFT.height - 0.1 },
    ],
    setBeanbags: (out) => office.setBeanbags(out),
    setLook: (p) => office.setLook(p),
    setProjectName: (name) => office.setProjectName(name),
    update: (t, dt, people) => office.update(t, dt, people),
  };
}
