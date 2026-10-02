import * as THREE from 'three';
import { FLOOR, WALL_T, WINDOWS } from '../../../shared/layout';
import { BIG, BIG_FLIGHTS, BIG_POSTS, DECK_SLAB, DECK_Y, HEADROOM, deckSolids, onDeck } from '../../../shared/mezzanine';
import { mergeByMaterial, mesh, toon } from '../toon';
import type { Collider } from '../types';
import { keep, type Fixture } from './fixture';
import { PALETTE, box, floorTexture, glassPane, onWall, type Looks } from './materials';

// The big mezzanine: a deck along the whole south side of the room, on a row of posts, with stairs out
// in the open up to its north edge and a glass rail along that edge. It's only the deck: the rooms up
// on it are the floor's own furniture (pieces with `level: 1`, see shared/furniture.ts). Where it all
// stands is shared/mezzanine.ts, which the rules and the paths read too.

/** How high the rail along the deck's edge stands, and how high the skirting round its walls. */
const RAIL_H = 1.05;
const SKIRTING = 0.36;
/** A room with this upstairs, for asking the shared code where its deck is. */
const ROOM = { mezzanine: 'big' } as const;
const { clamp } = THREE.MathUtils;
/** A window frame's bars, and how deep they are through the wall (see windowIn in shell.ts). */
const FRAME = 0.09;
const FRAME_DEPTH = WALL_T + 0.04;
/** The lights set in the deck's underside: (x, z) of each, clear of the posts and the meeting room's own. */
const LIGHTS: readonly (readonly [number, number])[] = [
  [-15, 9],
  [-10, 9],
  [-5, 9],
  [0, 9],
  [5, 9],
  [11, 6.9],
  [15.5, 6.9],
];

/** The big mezzanine as it's built: all of it in a group of its own, with what's in the way of it. */
export function buildMezzanine(looks: Looks): { group: THREE.Group; colliders: Collider[] } {
  const group = new THREE.Group();
  const { minX, maxX, minZ, maxZ } = BIG;
  const w = maxX - minX;
  const d = maxZ - minZ;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const woodMat = toon(PALETTE.wood);
  const inkMat = toon(PALETTE.deskLeg);
  /** Everything of it that's one plain color and never moves, drawn as a mesh per material. */
  const parts = new THREE.Group();

  // The slab: trim round its edge, where it shows as a band across the room, and painted like the
  // walls underneath, where it's the ceiling of everything under it. A box's faces go +x, -x, +y, -y, +z, -z.
  const slab = new THREE.Mesh(box(w, DECK_SLAB, d), Array.from({ length: 6 }, (_, i) => (i === 3 ? looks.wall : looks.trim)));
  slab.position.set(cx, DECK_Y - DECK_SLAB / 2, cz);
  slab.castShadow = true;
  slab.receiveShadow = true;
  group.add(slab);
  // Planked like downstairs.
  const planks = floorTexture(w, d);
  looks.planks.push(planks);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshToonMaterial({ map: planks, gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(cx, DECK_Y + 0.005, cz);
  floor.receiveShadow = true;
  group.add(floor);

  // The posts under it.
  for (const [x, z] of BIG_POSTS) parts.add(mesh(new THREE.CylinderGeometry(0.12, 0.12, HEADROOM, 12), looks.trim, x, HEADROOM / 2, z));

  // Each flight of stairs: a solid run of steps like the loft's, but out in the open, so it has a
  // handrail on both sides.
  for (const f of BIG_FLIGHTS) {
    const sw = f.maxX - f.minX;
    const run = (f.toZ - f.fromZ) / f.steps;
    const rise = DECK_Y / f.steps;
    const profile = new THREE.Shape();
    profile.moveTo(0, 0);
    for (let i = 0; i < f.steps; i++) {
      profile.lineTo(i * run, (i + 1) * rise - 0.04);
      profile.lineTo((i + 1) * run, (i + 1) * rise - 0.04);
    }
    profile.lineTo(f.toZ - f.fromZ, 0);
    profile.closePath();
    // Drawn climbing along x and extruded along z: turned a quarter, it climbs south from its east side.
    const wedge = mesh(new THREE.ExtrudeGeometry(profile, { depth: sw, bevelEnabled: false }), looks.wall, f.maxX, 0, f.fromZ);
    wedge.rotation.y = -Math.PI / 2;
    parts.add(wedge);
    const mid = (f.minX + f.maxX) / 2;
    for (let i = 1; i <= f.steps; i++) parts.add(mesh(box(sw, 0.06, run + 0.04), woodMat, mid, i * rise - 0.03, f.fromZ + (i - 0.5) * run - 0.02, false));
    const railH = 0.9;
    const z0 = f.fromZ + 0.5 * run;
    const z1 = f.fromZ + (f.steps - 0.5) * run;
    for (const x of [f.minX + 0.06, f.maxX - 0.06]) {
      for (let i = 1; i <= f.steps; i += 2) parts.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, railH, 6), inkMat, x, i * rise + railH / 2, f.fromZ + (i - 0.5) * run, false));
      const handrail = mesh(box(0.07, 0.07, Math.hypot(z1 - z0, (z1 - z0) * (rise / run)) + 0.1), woodMat, x, (rise + DECK_Y) / 2 + railH, (z0 + z1) / 2, false);
      handrail.rotation.x = -Math.atan2(rise, run);
      parts.add(handrail);
    }
  }

  // What's in the way of it is the shared list (the tests walk the same one): the slab overhead, the
  // posts, the steps and the fences either side of them, and the rail.
  const colliders: Collider[] = deckSolids();

  // The rail along the open edge, drawn where the list has it: glass under a wood top rail, in every
  // stretch between the flights.
  for (const c of colliders) {
    if (c.bottom !== DECK_Y) continue;
    const len = c.maxX - c.minX;
    const z = (c.minZ + c.maxZ) / 2;
    const n = Math.max(1, Math.round(len / 2));
    for (let i = 0; i < n; i++) {
      const pane = glassPane(len / n - 0.06, RAIL_H - 0.16);
      pane.position.set(c.minX + (i + 0.5) * (len / n), DECK_Y + RAIL_H / 2, z);
      parts.add(pane);
    }
    for (let i = 0; i <= n; i++) parts.add(mesh(box(0.06, RAIL_H, 0.06), inkMat, clamp(c.minX + i * (len / n), c.minX + 0.03, c.maxX - 0.03), DECK_Y + RAIL_H / 2, z, false));
    parts.add(mesh(box(len, 0.06, 0.08), inkMat, (c.minX + c.maxX) / 2, DECK_Y + 0.03, z, false));
    parts.add(mesh(box(len, 0.07, 0.1), woodMat, (c.minX + c.maxX) / 2, DECK_Y + RAIL_H, z, false));
  }

  // The low windows in the wall behind it are taller than the room under it: their heads are above its
  // floor. Each gets a top panel in its frame's white, from just under the slab up to its head, so from
  // below it's a window that ends at the ceiling, and from outside one with a solid top light where the
  // floor passes behind it, instead of the slab's edge showing through the glass.
  for (const o of WINDOWS) {
    const at = onWall(o.wall, o.u);
    // The ones the slab crosses: where it runs along the wall, with their sill under it and their head over it.
    const beside = onDeck(ROOM, clamp(at.x, FLOOR.minX + 0.3, FLOOR.maxX - 0.3), clamp(at.z, FLOOR.minZ + 0.3, FLOOR.maxZ - 0.3));
    if (!beside || o.y0 >= HEADROOM || o.y1 <= HEADROOM) continue;
    const bottom = HEADROOM - FRAME;
    const top = o.y1 - FRAME;
    const panel = mesh(box(o.width - 2 * FRAME, top - bottom, FRAME_DEPTH - 0.06), toon('#ffffff'), at.x, (bottom + top) / 2, at.z, false);
    panel.rotation.y = at.rotY;
    parts.add(panel);
  }

  // A skirting round its three walls. Along the south one it also covers the top of each of those
  // windows, whose head is a little above the deck.
  parts.add(mesh(box(w, SKIRTING, 0.04), looks.trim, cx, DECK_Y + SKIRTING / 2, maxZ - 0.02, false));
  for (const x of [minX + 0.02, maxX - 0.02]) parts.add(mesh(box(0.04, SKIRTING, d), looks.trim, x, DECK_Y + SKIRTING / 2, cz, false));

  // Flat lights set in its underside, like the ones over the meeting table.
  for (const [x, z] of LIGHTS) parts.add(mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.04, 20), toon('#fff7d6', { emissive: '#ffe08a' }), x, HEADROOM - 0.02, z, false));

  group.add(mergeByMaterial(parts));
  return { group, colliders };
}

/**
 * The big mezzanine. It's the floor's choice (see RoomOptions.mezzanine): on a floor that hasn't it,
 * the deck, its stairs, its posts and its rail are put away with what you'd bump into of them, and
 * pictures can hang where its skirting was. What stands on it is furniture (see furnish.ts).
 */
export const mezzanine: Fixture = (site) => {
  const built = buildMezzanine(site.looks);
  // Pictures upstairs hang above its skirting, which stands out further from the wall than a frame's back.
  const y = DECK_Y + SKIRTING / 2;
  const along = (BIG.minZ + BIG.maxZ) / 2;
  const marks = [site.wall('south', (BIG.minX + BIG.maxX) / 2, y, BIG.maxX - BIG.minX, SKIRTING), site.wall('east', along, y, BIG.maxZ - BIG.minZ, SKIRTING), site.wall('west', along, y, BIG.maxZ - BIG.minZ, SKIRTING)];
  let there = false;
  built.group.visible = false;
  for (const mark of marks) mark.off = true;
  site.get('room').on((room) => {
    const big = room.mezzanine === 'big';
    if (big === there) return;
    there = big;
    built.group.visible = there;
    keep(site.colliders, built.colliders, there);
    for (const mark of marks) mark.off = !there;
  });
  return { group: built.group };
};
