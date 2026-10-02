import * as THREE from 'three';
import { SEATING_BY_ID } from '../../../shared/layout';
import { mesh, roundedBox, toon } from '../../world/toon';
import type { Interactable } from '../../world/types';
import type { Fixture } from '../../world/office/fixture';
import { PALETTE, box } from '../../world/office/materials';
import { chair, seatable } from '../../world/office/seats';
import { BOSS_DESK, GUEST_SEATS, hasBossDesk } from './desk';

// The guests' side of the boss's desk: two chairs across it, turned in toward it, and a second monitor
// back to back with the boss's, facing them. The desk itself, the boss's chair and the boss's monitor
// are the boss's office's (world/office/boss-office.ts); what the two monitors show is screens.ts.

declare module '../../world/types' {
  interface OfficeHandles {
    /** The monitor on the boss's desk that faces the guests' chairs: it shows what the boss's does (features/boss-desk/screens.ts). */
    guestScreen: THREE.Mesh;
  }
}

/**
 * What's across the boss's desk, in the desk's own frame (see BOSS_DESK: +z is the boss's side). A floor
 * without the desk (see hasBossDesk) has it put away, chairs and all, with nothing there to sit on.
 */
export const bossDesk: Fixture<'guestScreen'> = (site) => {
  const group = new THREE.Group();
  group.position.set(BOSS_DESK.x, BOSS_DESK.y, BOSS_DESK.z);
  const interactables: Interactable[] = [];

  // The monitor, just behind the boss's (whose back is at z -0.23). It's the same size as theirs, so
  // one picture fits both, and it isn't something to use: aiming at it from a chair leaves E with the chair.
  // Its neck is thinner than its body, so it doesn't stand out in front of the picture.
  group.add(mesh(box(0.08, 0.2, 0.05), toon(PALETTE.ink), 0, 0.93, -0.28));
  group.add(mesh(roundedBox(0.9, 0.55, 0.06, 0.03), toon(PALETTE.ink), 0, 1.18, -0.28));
  const screen = mesh(new THREE.PlaneGeometry(0.8, 0.45), new THREE.MeshBasicMaterial({ color: '#4cc9f0' }), 0, 1.18, -0.315, false);
  screen.rotation.y = Math.PI;
  group.add(screen);

  // A chair as it's built faces -z, so each is turned half a turn past the way its sitter faces.
  for (const id of GUEST_SEATS) {
    const seat = SEATING_BY_ID.get(id)!;
    const c = chair('#8d99ae');
    c.position.set(seat.x - BOSS_DESK.x, 0, seat.z - BOSS_DESK.z);
    c.rotation.y = seat.rotY + Math.PI;
    group.add(c);
    seatable(c, id, 1.1, interactables);
  }

  site.get('room').on((room) => {
    const there = hasBossDesk(room);
    group.visible = there;
    for (const it of interactables) it.off = !there;
  });
  return { group, interactables, handle: { guestScreen: screen } };
};
