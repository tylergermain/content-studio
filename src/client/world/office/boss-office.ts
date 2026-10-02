import * as THREE from 'three';
import { LOFT } from '../../../shared/layout';
import { hasBoss } from '../../../shared/mezzanine';
import { mesh, roundedBox, textPlane, toon } from '../toon';
import type { Collider, Interactable } from '../types';
import { keep, type Fixture } from './fixture';
import { PALETTE, box } from './materials';
import { floorPlant, pendant, plant } from './props';
import { chair, seatable } from './seats';

/** The boss's office as it's built: all of it in a group of its own, with what's in the way of it and what there is to use in it. */
interface BossOffice {
  group: THREE.Group;
  colliders: Collider[];
  interactables: Interactable[];
  /** The monitor on the boss's desk. */
  screen: THREE.Mesh;
}

/**
 * What makes the corner loft the boss's office: the big desk facing the glass, a comfy couch, a
 * telescope aimed at the desks, the lamp over the desk and the signs. The room itself (its floor, glass,
 * roof and stairs) is the loft's (loft.ts).
 */
export function buildBossOffice(): BossOffice {
  const group = new THREE.Group();
  const colliders: Collider[] = [];
  const interactables: Interactable[] = [];
  const { minX, maxX, minZ, maxZ, y: floorY, height } = LOFT;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const roofY = floorY + height;
  const woodMat = toon(PALETTE.wood);
  const inkMat = toon(PALETTE.deskLeg);

  const deskX = cx + 0.5;
  const deskZ = cz - 0.3;
  const desk = new THREE.Group();
  desk.add(mesh(roundedBox(2.6, 0.1, 1.2, 0.1), woodMat, 0, 0.78, 0));
  desk.add(mesh(box(2.4, 0.66, 0.08), toon('#8a5a3b'), 0, 0.4, -0.5));
  for (const sx of [-1, 1]) desk.add(mesh(box(0.1, 0.72, 1.0), toon('#8a5a3b'), sx * 1.15, 0.37, 0));
  desk.add(mesh(roundedBox(0.9, 0.55, 0.06, 0.03), toon(PALETTE.ink), 0, 1.18, -0.2));
  // Its neck is thinner than its body, so it doesn't stand out in front of the picture.
  desk.add(mesh(box(0.08, 0.2, 0.05), toon(PALETTE.ink), 0, 0.93, -0.2));
  // The desk's games play on it, and it shows what the boss shares (features/arcade, features/boss-desk).
  const screen = mesh(new THREE.PlaneGeometry(0.8, 0.45), new THREE.MeshBasicMaterial({ color: '#4cc9f0' }), 0, 1.18, -0.165, false);
  desk.add(screen);
  desk.add(mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.12, 10), toon('#ffd166'), 0.9, 0.89, 0.15));
  const plate = textPlane('👑 BOSS', { bg: '#ffd166', size: 48 });
  plate.scale.multiplyScalar(0.55);
  plate.position.set(0, 0.5, -0.55);
  plate.rotation.y = Math.PI;
  desk.add(plate);
  const bossChair = chair('#2b2d42');
  bossChair.scale.setScalar(1.2);
  bossChair.position.set(0, 0, 1.0);
  desk.add(bossChair);
  seatable(bossChair, 'boss-chair', 1.2, interactables);
  // Clicking the screen is using the chair: sit down, then play.
  screen.userData.interact = bossChair.userData.interact;
  desk.position.set(deskX, floorY, deskZ);
  group.add(desk);
  colliders.push({ minX: deskX - 1.3, maxX: deskX + 1.3, minZ: deskZ - 0.6, maxZ: deskZ + 0.6, bottom: floorY, top: floorY + 0.8 });

  const couch = new THREE.Group();
  const couchMat = toon('#ef476f');
  couch.add(mesh(roundedBox(1, 0.45, 2.4, 0.2), couchMat, 0, 0.3, 0));
  couch.add(mesh(roundedBox(0.35, 0.9, 2.4, 0.15), couchMat, 0.45, 0.55, 0));
  for (const sz of [-1, 1]) couch.add(mesh(roundedBox(1, 0.7, 0.3, 0.15), couchMat, 0, 0.45, sz * 1.1));
  couch.add(mesh(roundedBox(0.2, 0.45, 0.5, 0.1), toon('#ffd166'), 0.2, 0.75, 0.4));
  couch.position.set(maxX - 0.65, floorY, cz);
  group.add(couch);
  colliders.push({ minX: maxX - 1.15, maxX, minZ: cz - 1.2, maxZ: cz + 1.2, bottom: floorY, top: floorY + 0.55 });
  seatable(couch, 'loft-couch', 1.8, interactables);

  const rug = mesh(roundedBox(4.6, 0.02, 3.2, 0.6), toon('#caffbf'), deskX - 0.3, floorY + 0.015, cz + 0.1, false);
  group.add(rug);

  const scope = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const leg = mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.1, 6), inkMat, Math.sin(a) * 0.2, 0.52, Math.cos(a) * 0.2);
    leg.rotation.set(Math.cos(a) * -0.35, 0, Math.sin(a) * 0.35);
    scope.add(leg);
  }
  const tube = new THREE.Group();
  const tubeGeo = new THREE.CylinderGeometry(0.1, 0.06, 0.9, 14);
  tubeGeo.rotateX(Math.PI / 2);
  tube.add(mesh(tubeGeo, toon('#ffd166'), 0, 0, 0.1));
  tube.add(mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.08, 14).rotateX(Math.PI / 2), toon(PALETTE.ink), 0, 0, 0.55));
  tube.position.y = 1.08;
  scope.add(tube);
  scope.position.set(minX + 0.9, floorY, minZ + 0.9);
  group.add(scope);
  tube.lookAt(-6, 0.8, 0);
  const telescope: Interactable = { kind: 'telescope', x: scope.position.x, y: floorY, z: scope.position.z, radius: 1.65 };
  scope.userData.interact = telescope;
  interactables.push(telescope);
  colliders.push({ minX: minX + 0.65, maxX: minX + 1.15, minZ: minZ + 0.65, maxZ: minZ + 1.15, bottom: floorY, top: floorY + 1.3 });

  for (const [i, [px, pz, s]] of [
    [maxX - 0.6, minZ + 0.6, 1],
    [maxX - 0.6, maxZ - 0.6, 1.2],
  ].entries()) {
    // Starting past the monstera, which spreads too wide for a corner this tight.
    const p = plant(floorPlant(i + 1), s);
    p.position.set(px, floorY, pz);
    group.add(p);
    const r = 0.3 * s;
    colliders.push({ minX: px - r, maxX: px + r, minZ: pz - r, maxZ: pz + r, bottom: floorY, top: floorY + 0.5 * s });
  }

  // The lamp over the desk is the office's, not the room's: it hangs at head height, and an empty loft
  // takes furniture nearly up to its roof.
  const lamp = pendant();
  lamp.position.set(deskX, roofY - 0.4, cz);
  group.add(lamp);

  // Signs: one on the back wall inside, one over the glass for everyone downstairs. The one inside is
  // up under the ceiling, which leaves the wall behind the desk free for a row of pictures.
  const inside = textPlane('👑 Boss Office', { bg: '#fffaf3', size: 64 });
  inside.scale.multiplyScalar(0.6);
  inside.position.set(maxX - 3, floorY + 2.52, maxZ - 0.04);
  inside.rotation.y = Math.PI;
  group.add(inside);
  const outside = textPlane('👑 Boss Office', { bg: '#2b2d42', color: '#fffaf3', size: 64, border: '#fffaf3' });
  outside.scale.multiplyScalar(1.4);
  // In front of the roof's trim (minZ - 0.04 to minZ), or the trim hides the sign's lower half.
  outside.position.set(cx, roofY + 0.2, minZ - 0.07);
  outside.rotation.y = Math.PI;
  group.add(outside);
  return { group, colliders, interactables, screen };
}

declare module '../types' {
  interface OfficeHandles {
    /** The monitor on the boss's desk upstairs, where the arcade's games play (features/arcade/ui.ts). */
    bossScreen: THREE.Mesh;
  }
}

/**
 * The boss's office, up in the corner loft. It's the floor's choice (see hasBoss): a floor with no
 * corner loft, or one that keeps the loft an empty room for its own furniture, has the lot put away,
 * with what you'd bump into and what you'd use or sit on in it, and pictures can hang where its couch
 * and its sign were. The monitor is always given: nothing shows on it while it's put away.
 */
export const bossOffice: Fixture<'bossScreen'> = (site) => {
  const built = buildBossOffice();
  // What it has against the loft's walls, which pictures stay clear of: the couch and the sign.
  const marks = [site.wall('east', (LOFT.minZ + LOFT.maxZ) / 2, LOFT.y + 0.5, 2.4, 1), site.wall('south', LOFT.maxX - 3, LOFT.y + 1.9, 2.6, 0.6)];
  let there = false;
  built.group.visible = false;
  for (const mark of marks) mark.off = true;
  for (const it of built.interactables) it.off = true;
  site.get('room').on((room) => {
    const boss = hasBoss(room);
    if (boss === there) return;
    there = boss;
    built.group.visible = there;
    keep(site.colliders, built.colliders, there);
    keep(site.interactables, built.interactables, there);
    // Whatever still has hold of one (what you were aiming at) can't use it either.
    for (const it of built.interactables) it.off = !there;
    for (const mark of marks) mark.off = !there;
  });
  return { group: built.group, handle: { bossScreen: built.screen } };
};
