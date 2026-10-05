/**
 * Putt Street on the floors: a street fixture (see world/office/ground.ts), built into the street under
 * every floor from the holes in shared/minigolf/course.ts: the felt, the kerbs and walls, the windmill
 * turning on the office's clock, the rest of the obstacles, the picket fence, the kiosk and the boards.
 */
import * as THREE from 'three';
import { PUTT } from '../../../shared/mainstreet';
import { STREET_Y, streetBelow } from '../../../shared/layout';
import { HOLES } from '../../../shared/minigolf/course';
import { store } from '../../state';
import type { Fixture, StreetSite } from '../../world/office/fixture';
import { setObstacleBoxes, type NightParts, type StreetBox } from '../../world/outside';
import type { Collider, Interactable } from '../../world/types';
import { mergeByMaterial, mesh, toon } from '../../world/toon';
import { PaintedBoard, paintRecords, paintRounds } from '../../world/minigolf/boards';
import { buildGrounds } from '../../world/minigolf/grounds';
import { buildHole } from '../../world/minigolf/hole';
import { KIOSK_TOP, buildKiosk } from '../../world/minigolf/kiosk';
import { shownRound } from './shown';

/** Putt Street as a group of its own: what it looks like, and the windmill turning. */
export interface PuttStreetView {
  /** In the street frame, its y 0 the street. */
  group: THREE.Group;
  /** Turns the windmill's sails to where they are at office time `officeMs` (see millAngle). */
  update(officeMs: number): void;
}

/** What the floors' copy uses besides: what's in the way, what golf balls bounce off, and the putter rack. */
export interface PuttStreetBuilt extends PuttStreetView {
  /** In the street frame, bottom 0 the street. */
  colliders: Collider[];
  obstacles: StreetBox[];
  /** The rack's meshes, to point at to use it. */
  rack: THREE.Object3D[];
}

/** How long a record stays picked out on the record board, in ms. */
const FRESH_FOR = 60_000;

/**
 * Builds Putt Street's course, fence, kiosk and boards. `night` takes its bulbs and its two lamps; the
 * roof bar's copy (features/mainstreet/roof.ts) passes none, so the floors' lamps aren't doubled.
 */
export function buildPuttStreet(night: NightParts | null): PuttStreetBuilt {
  const group = new THREE.Group();
  const colliders: Collider[] = [];
  const obstacles: StreetBox[] = [];
  // Everything that never moves and has no picture on it, merged into a few draw calls at the end.
  const statics = new THREE.Group();
  const grounds = buildGrounds(night, statics);
  group.add(grounds.group);
  colliders.push(...grounds.colliders);
  const holes = HOLES.map((hole) => buildHole(hole, statics));
  for (const h of holes) {
    group.add(h.group);
    colliders.push(...h.colliders);
    obstacles.push(...h.obstacles);
  }
  const kiosk = buildKiosk(statics);
  group.add(kiosk.group);
  colliders.push(...kiosk.colliders);
  const k = PUTT.kiosk;
  obstacles.push({ minX: k.minX, maxX: k.maxX, minZ: k.minZ, maxZ: k.maxZ, top: KIOSK_TOP });

  // The record board by the gate, on two posts, facing the street.
  const records = new PaintedBoard(3.0, 2.0);
  const r = PUTT.record;
  records.group.position.set(r.x, 1.0, r.z);
  records.group.rotation.y = r.rotY;
  group.add(records.group);
  const post = toon('#2b2d42');
  for (const s of [-1, 1]) {
    const x = r.x + Math.cos(r.rotY) * s * 1.35;
    const z = r.z - Math.sin(r.rotY) * s * 1.35;
    statics.add(mesh(new THREE.BoxGeometry(0.12, 1.0, 0.12), post, x, 0.5, z));
    colliders.push({ minX: x - 0.08, maxX: x + 0.08, minZ: z - 0.08, maxZ: z + 0.08, bottom: 0, top: 3.0 });
  }
  group.add(mergeByMaterial(statics));

  // The boards follow the office's rounds and records: the live one ticks its clocks over every second
  // while there's a round on, and the record board picks out what just changed for a minute.
  let roundsDirty = true;
  let recordsDirty = true;
  let paintedAt = 0;
  let freshUntil = 0;
  store.on('putt', () => void (roundsDirty = true));
  store.on('puttBoard', () => void (recordsDirty = true));
  const paint = (officeMs: number) => {
    if (roundsDirty || (store.puttRounds.length > 0 && officeMs - paintedAt > 1000)) {
      roundsDirty = false;
      paintedAt = officeMs;
      kiosk.board.paint((g, w, h) => paintRounds(g, w, h, store.puttRounds.map((r) => shownRound(r, officeMs)), officeMs));
    }
    if (freshUntil && performance.now() > freshUntil) recordsDirty = true;
    if (!recordsDirty) return;
    recordsDirty = false;
    const latest = store.puttLatest && performance.now() - store.puttLatest.at < FRESH_FOR ? store.puttLatest : null;
    freshUntil = latest ? latest.at + FRESH_FOR : 0;
    records.paint((g, w, h) => paintRecords(g, w, h, store.puttBoard, officeMs, latest));
  };

  return {
    group,
    colliders,
    obstacles,
    rack: kiosk.rack,
    update(officeMs) {
      for (const h of holes) h.update(officeMs);
      paint(officeMs);
    },
  };
}

/** Putt Street on the street under the floor: what's out on the course (everyone's balls, your aim) is drawn in its group. */
export interface PuttCourse {
  /** The course's group, in the street frame (y 0 the street), down with the street on a floor above the bottom one. */
  group: THREE.Group;
  /** The putter rack in the kiosk, which you use (see features/minigolf). */
  rack: Interactable;
}

declare module '../../world/types' {
  interface OfficeHandles {
    /** Putt Street, the mini golf course on Main Street (see features/minigolf). */
    puttStreet: PuttCourse;
  }
}

/** Putt Street, down on the street: its colliders go down with it (they're the street's), and the rack's place to use follows it. */
export const puttCourse: Fixture<'puttStreet', StreetSite> = (site) => {
  const built = buildPuttStreet(site.get('night'));
  built.group.position.y = STREET_Y;
  site.ground.add(built.group);
  for (const c of built.colliders) site.groundColliders.push({ ...c, bottom: STREET_Y + (c.bottom ?? 0), top: STREET_Y + c.top });
  setObstacleBoxes('putt', built.obstacles);
  const rack: Interactable = { kind: 'puttrack', x: PUTT.rack.x, z: PUTT.rack.z, y: STREET_Y, radius: 1.6 };
  for (const o of built.rack) o.userData.interact = rack;
  site.interactables.push(rack);
  return {
    handle: { puttStreet: { group: built.group, rack } },
    update: () => built.update(store.officeNow()),
    setLevel: (index) => void (rack.y = streetBelow(index)),
  };
};
