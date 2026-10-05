/**
 * Friday One on the floors: a street fixture (see world/office/ground.ts), built into the street under
 * every floor, that draws the helicopter where it is (store.heli, store.heliPose: features/heli/index.ts
 * says each frame), its crew from other floors in their seats, and the colliders it gives the street
 * while it's down.
 */
import * as THREE from 'three';
import { HELI, homePose } from '../../../shared/heli';
import { STREET_Y, streetBelow } from '../../../shared/layout';
import type { HeliPose } from '../../../shared/protocol';
import { keep, type Fixture, type StreetSite } from '../../world/office/fixture';
import type { Collider, Interactable } from '../../world/types';
import { CrewFigures } from './crew';
import { buildHeli, poseHeli, type HeliModel } from './model';

/**
 * Its body as what you bump into while it's down, in its own frame (middles across and along it, half
 * sizes, and how tall): the cabin and skids in two lengths, and the tail. Turned off square, each takes
 * the box round it as turned, so two along the cabin keep that box close to it.
 */
const BODY = [
  { x: 0, z: 1.2, hx: 1.25, hz: 0.9, top: 2.7 },
  { x: 0, z: -0.55, hx: 1.25, hz: 0.9, top: 2.8 },
  { x: 0, z: -4.3, hx: 0.4, hz: 2.85, top: 3.1 },
] as const;

/** Friday One as the floor you're on draws it, down on the street under it. */
export class HeliPark {
  readonly group = new THREE.Group();
  readonly model: HeliModel = buildHeli();
  /** E at either door (see index.ts): they go where it goes. */
  readonly doors: Interactable[] = HELI.doors.map((d) => ({ kind: 'heli', x: d.x, z: d.z, y: STREET_Y, radius: HELI.reach - 0.3 }));
  /** Who's aboard from elsewhere, and the pilot's tag. */
  readonly crew = new CrewFigures(this.group);
  /** What you bump into of it while it's down (none in the air). */
  private readonly boxes: Collider[] = BODY.map(() => ({ minX: 0, maxX: 0, minZ: 0, maxZ: 0, bottom: STREET_Y, top: STREET_Y }));
  /** How far below the floor you're on the street is (see streetBelow). */
  private street = STREET_Y;
  private down = false;
  private readonly pose: HeliPose = homePose();

  constructor(
    /** The office's: its body's boxes go in with them while it's down. */
    private readonly all: Collider[],
  ) {
    this.group.add(this.model.root);
    // Aimed at in first person, it's the door you'd get in by.
    this.model.root.userData.interact = this.doors[0];
  }

  /** Whether `c` is one of its own boxes (what's in its way is everything else). */
  owns(c: Collider): boolean {
    return this.boxes.includes(c);
  }

  /** The floor you're on is `street` above the street: it and its boxes are down there. */
  setStreet(street: number) {
    this.street = street;
    this.place();
  }

  /**
   * Draws it at `pose` with its rotor turned to `angle` at `spin` and the lights at `t` seconds; `down`
   * (parked or landed) it gives the street its body to bump into.
   */
  show(pose: HeliPose, angle: number, spin: number, t: number, down: boolean) {
    Object.assign(this.pose, pose);
    // In the street under the floor (site.ground), which is that many storeys down already.
    poseHeli(this.model, pose, STREET_Y, angle, spin, t);
    if (down !== this.down) {
      this.down = down;
      keep(this.all, this.boxes, down);
    }
    this.place();
  }

  /** Its boxes and doors where it is now, on the street as far down as the floor you're on has it. */
  private place() {
    const p = this.pose;
    const c = Math.cos(p.yaw);
    const s = Math.sin(p.yaw);
    const floor = this.street + p.h;
    for (let i = 0; i < BODY.length; i++) {
      const b = BODY[i];
      const box = this.boxes[i];
      const x = p.x + b.x * c + b.z * s;
      const z = p.z - b.x * s + b.z * c;
      const ex = Math.abs(c) * b.hx + Math.abs(s) * b.hz;
      const ez = Math.abs(s) * b.hx + Math.abs(c) * b.hz;
      box.minX = x - ex;
      box.maxX = x + ex;
      box.minZ = z - ez;
      box.maxZ = z + ez;
      box.bottom = floor;
      box.top = floor + b.top;
    }
    for (let i = 0; i < HELI.doors.length; i++) {
      const d = HELI.doors[i];
      const it = this.doors[i];
      it.x = p.x + d.x * c + d.z * s;
      it.z = p.z - d.x * s + d.z * c;
      it.y = floor;
    }
  }
}

declare module '../../world/types' {
  interface OfficeHandles {
    /** Friday One, drawn on the street under the floor (see features/heli). */
    heli: HeliPark;
  }
}

/** Friday One down on the street under the floor: where it is comes from features/heli each frame. */
export const heliPark: Fixture<'heli', StreetSite> = (site) => {
  // It moves, so its boxes go in with the floor's and follow it (and the street) themselves, rather
  // than going down with the street's (see the cars).
  const park = new HeliPark(site.colliders);
  site.ground.add(park.group);
  return { handle: { heli: park }, setLevel: (index) => park.setStreet(streetBelow(index)) };
};
