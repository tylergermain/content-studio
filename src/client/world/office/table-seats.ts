import * as THREE from 'three';
import { MEETING_LAPTOP, deskSeat, type DeskDef } from '../../../shared/layout';
import { TABLE, TABLE_SEATS } from '../../../shared/table-seats';
import type { Fixture } from './fixture';
import { vacancyMarker } from './hire-marker';
import { chair } from './seats';
import type { DeskView, Interactable } from '../types';

// The chairs round the floor's conference tables (shared/table-seats.ts): a worker sits at one as it would at a desk,
// its laptop on the table in front of it, and a '+' over a free one says you can hire there. One for each of the
// office's table seats, put away until a table on the floor has it; the table itself is furniture (furniture.ts).

declare module '../types' {
  interface OfficeHandles {
    /** Brings out the chairs `seats` has, where it puts them, and puts the rest away. */
    setTables(seats: ReadonlyMap<string, DeskDef>): void;
  }
}

/** A chair at a conference table, with its laptop on the table in front of it. */
function buildTableSeat(def: DeskDef): DeskView {
  const group = new THREE.Group();
  const laptopAnchor = new THREE.Object3D();
  laptopAnchor.position.set(0, TABLE.height, MEETING_LAPTOP.z);
  laptopAnchor.scale.setScalar(MEETING_LAPTOP.scale);
  group.add(laptopAnchor);
  const seatAnchor = new THREE.Object3D();
  seatAnchor.position.set(0, 0.4, 0.85);
  seatAnchor.rotation.y = Math.PI;
  seatAnchor.scale.setScalar(0.82);
  group.add(seatAnchor);
  const ch = chair();
  ch.position.set(0, 0, 0.85);
  group.add(ch);
  const stage = new THREE.Object3D();
  stage.position.set(0, 0.48, 0.85);
  group.add(stage);
  const vacancyY = 1.45;
  const vacancy = vacancyMarker(vacancyY);
  vacancy.position.z = 0.85;
  group.add(vacancy);
  return { def, group, laptopAnchor, seatAnchor, stage, chair: ch, vacancy, vacancyY };
}

export const tableSeats: Fixture<'setTables'> = (site) => {
  const chairs = TABLE_SEATS.map((def) => {
    const view = buildTableSeat(def);
    view.group.visible = false;
    site.group.add(view.group);
    site.desks.set(def.id, view);
    const it: Interactable = { kind: 'desk', deskId: def.id, x: 0, z: 0, radius: 1.1, off: true };
    site.interactables.push(it);
    view.group.userData.interact = view.interact = it;
    return { def, view, it };
  });
  const setTables = (seats: ReadonlyMap<string, DeskDef>) => {
    for (const { def, view, it } of chairs) {
      const pose = seats.get(def.id);
      view.group.visible = !!pose;
      it.off = !pose;
      if (!pose) continue;
      view.group.position.set(pose.x, 0, pose.z);
      view.group.rotation.y = pose.rotY;
      Object.assign(it, deskSeat(pose, 1.25));
    }
  };
  return { handle: { setTables } };
};
