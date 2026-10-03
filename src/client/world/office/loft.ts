import * as THREE from 'three';
import { LOFT, STAIRS, WALL_T } from '../../../shared/layout';
import { mesh, toon } from '../toon';
import type { Collider } from '../types';
import { keep, type Fixture } from './fixture';
import { PALETTE, box, floorTexture, glassPane, type Looks } from './materials';

/** The loft as it's built: all of it in a group of its own, with what's in the way of it. */
interface Loft {
  group: THREE.Group;
  colliders: Collider[];
}

/**
 * The upstairs room: a loft on posts in the south-east corner, with glass on the two sides that
 * face the desks, reached by stairs along the south wall. It's built empty: its floor, its posts, its
 * roof, its glass and the stairs.
 */
export function buildLoft(looks: Looks): Loft {
  const group = new THREE.Group();
  const colliders: Collider[] = [];
  const { minX, maxX, minZ, maxZ, y: floorY, height } = LOFT;
  const w = maxX - minX;
  const d = maxZ - minZ;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const roofY = floorY + height;
  const SLAB = 0.25;
  const T = 0.12; // glass wall thickness
  const wallMat = looks.wall;
  const trimMat = looks.trim;
  const frameMat = toon('#ffffff');
  const woodMat = toon(PALETTE.wood);

  // Floor slab, planked like downstairs. Its underside is the meeting room's ceiling and its edges are
  // what the hall sees of the loft, so it's the walls' paint, with the trim only a thin line along the
  // foot of the two open edges (west only as far as the stairs, which run up against the rest).
  group.add(mesh(box(w, SLAB, d), wallMat, cx, floorY - SLAB / 2, cz));
  // The line stands proud of the slab's face (as far as the glass's sill does), touching it nowhere it'd flicker.
  const LINE = { h: 0.06, proud: 0.03 };
  const lineY = floorY - SLAB + LINE.h / 2;
  const westRun = STAIRS.minZ - minZ;
  group.add(mesh(box(w + LINE.proud, LINE.h, LINE.proud), trimMat, cx - LINE.proud / 2, lineY, minZ - LINE.proud / 2, false));
  group.add(mesh(box(LINE.proud, LINE.h, westRun), trimMat, minX - LINE.proud / 2, lineY, minZ + westRun / 2, false));
  const planks = floorTexture(w, d);
  looks.planks.push(planks);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshToonMaterial({ map: planks, gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(cx, floorY + 0.005, cz);
  floor.receiveShadow = true;
  group.add(floor);
  colliders.push({ minX, maxX, minZ, maxZ, bottom: floorY - SLAB, top: floorY });

  // Posts holding up the open corner, in the walls' paint like the slab.
  for (const x of [minX + 0.15, cx]) {
    group.add(mesh(new THREE.CylinderGeometry(0.12, 0.12, floorY - SLAB, 12), wallMat, x, (floorY - SLAB) / 2, minZ + 0.15));
    colliders.push({ minX: x - 0.14, maxX: x + 0.14, minZ: minZ + 0.01, maxZ: minZ + 0.29, top: floorY - SLAB });
  }

  // The outside walls carry on up behind the loft (buildWalls); the sun shines through them and the roof.
  // The roof runs into them, stopping short of their outside face.
  const into = WALL_T - 0.03;
  const roof = mesh(box(w + into, 0.2, d + into), wallMat, cx + into / 2, roofY + 0.1, cz + into / 2, false);
  group.add(roof);
  // A band round its open edges, the walls' paint with the trim's thin line along its top, as at the slab's foot.
  for (const [mat, y0, y1] of [
    [wallMat, roofY - 0.02, roofY + 0.22 - LINE.h],
    [trimMat, roofY + 0.22 - LINE.h, roofY + 0.22],
  ] as const) {
    group.add(mesh(box(w + 0.02 + into, y1 - y0, 0.04), mat, cx + (into - 0.02) / 2, (y0 + y1) / 2, minZ - 0.02, false));
    group.add(mesh(box(0.04, y1 - y0, d + 0.02 + into), mat, minX - 0.02, (y0 + y1) / 2, cz + (into - 0.02) / 2, false));
  }
  colliders.push({ minX, maxX, minZ, maxZ, bottom: roofY, top: roofY + 0.2 });
  group.add(mesh(box(w, 0.25, 0.04), trimMat, cx, floorY + 0.125, maxZ - 0.02, false));
  group.add(mesh(box(0.04, 0.25, d), trimMat, maxX - 0.02, floorY + 0.125, cz, false));

  // Floor-to-ceiling glass on the north and west sides, so you can look down on everyone working.
  const doorZ = STAIRS.minZ;
  const pane = (len: number, px: number, pz: number, rotY: number) => {
    const g = glassPane(len, height);
    g.position.set(px, floorY + height / 2, pz);
    g.rotation.y = rotY;
    group.add(g);
  };
  const bar = (bw: number, bh: number, bd: number, x: number, y: number, z: number) => group.add(mesh(box(bw, bh, bd), frameMat, x, y, z, false));
  const northZ = minZ + T / 2;
  const westX = minX + T / 2;
  for (let i = 0; i < 6; i++) pane(w / 6, minX + (i + 0.5) * (w / 6), northZ, 0);
  for (let i = 0; i <= 6; i++) bar(0.1, height, T + 0.04, minX + i * (w / 6), floorY + height / 2, northZ);
  bar(w, 0.12, T + 0.06, cx, floorY + 0.06, northZ);
  bar(w, 0.12, T + 0.06, cx, roofY - 0.06, northZ);
  const westLen = doorZ - minZ;
  for (let i = 0; i < 2; i++) pane(westLen / 2, westX, minZ + (i + 0.5) * (westLen / 2), Math.PI / 2);
  for (let i = 0; i <= 2; i++) bar(T + 0.04, height, 0.1, westX, floorY + height / 2, minZ + i * (westLen / 2));
  bar(T + 0.06, 0.12, westLen, westX, floorY + 0.06, minZ + westLen / 2);
  bar(T + 0.06, 0.12, westLen, westX, roofY - 0.06, minZ + westLen / 2);
  colliders.push({ minX, maxX, minZ, maxZ: minZ + T, bottom: floorY, top: 99 });
  colliders.push({ minX, maxX: minX + T, minZ, maxZ: doorZ, bottom: floorY, top: 99 });
  // Over the door at the top of the stairs.
  const doorTop = floorY + 2.3;
  group.add(mesh(box(T + 0.04, roofY - doorTop, maxZ - doorZ), wallMat, westX, (roofY + doorTop) / 2, (doorZ + maxZ) / 2, false));
  colliders.push({ minX, maxX: minX + T, minZ: doorZ, maxZ, bottom: doorTop, top: roofY });

  // Stairs: a solid run of steps up the south wall, wood treads, a handrail on the open side.
  const { fromX, toX, steps } = STAIRS;
  const sw = STAIRS.maxZ - STAIRS.minZ;
  const run = (toX - fromX) / steps;
  const rise = floorY / steps;
  const profile = new THREE.Shape();
  profile.moveTo(0, 0);
  for (let i = 0; i < steps; i++) {
    profile.lineTo(i * run, (i + 1) * rise - 0.04);
    profile.lineTo((i + 1) * run, (i + 1) * rise - 0.04);
  }
  profile.lineTo(toX - fromX, 0);
  profile.closePath();
  const stairs = mesh(new THREE.ExtrudeGeometry(profile, { depth: sw, bevelEnabled: false }), wallMat, fromX, 0, STAIRS.minZ);
  group.add(stairs);
  for (let i = 1; i <= steps; i++) {
    group.add(mesh(box(run + 0.04, 0.06, sw), woodMat, fromX + (i - 0.5) * run - 0.02, i * rise - 0.03, STAIRS.minZ + sw / 2, false));
    colliders.push({ minX: fromX + (i - 1) * run, maxX: fromX + i * run, minZ: STAIRS.minZ, maxZ: STAIRS.maxZ, top: i * rise });
  }
  const railZ = STAIRS.minZ + 0.06;
  const railH = 0.9;
  const inkMat = toon(PALETTE.deskLeg);
  for (let i = 1; i <= steps; i += 2) {
    group.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, railH, 6), inkMat, fromX + (i - 0.5) * run, i * rise + railH / 2, railZ, false));
  }
  const x0 = fromX + 0.5 * run;
  const x1 = fromX + (steps - 0.5) * run;
  const handrail = mesh(box(Math.hypot(x1 - x0, (x1 - x0) * (rise / run)) + 0.1, 0.07, 0.07), woodMat, (x0 + x1) / 2, (rise + floorY) / 2 + railH, railZ, false);
  handrail.rotation.z = Math.atan2(rise, run);
  group.add(handrail);
  // You can't step off the side of the stairs, or climb on from it.
  colliders.push({ minX: fromX, maxX: toX, minZ: STAIRS.minZ - 0.1, maxZ: STAIRS.minZ, top: 99 });
  return { group, colliders };
}

/**
 * The corner loft, up the stairs and over the meeting room. It's the floor's choice (see
 * RoomOptions.mezzanine): on one that hasn't it the lot is put away, the loft and its posts and the
 * stairs, with what you'd bump into of them, so the floor where the stairs stood is floor like any
 * other. What's in it is another fixture's: the boss's office (boss-office.ts), or on a floor that keeps
 * the room empty, the floor's own furniture. The meeting room under it stays (see meeting-room.ts,
 * which caps its glass where the loft's floor was).
 */
export const loft: Fixture = (site) => {
  const built = buildLoft(site.looks);
  let there = false;
  built.group.visible = false;
  site.get('room').on((room) => {
    const corner = room.mezzanine === 'corner';
    if (corner === there) return;
    there = corner;
    built.group.visible = there;
    keep(site.colliders, built.colliders, there);
  });
  return { group: built.group };
};
