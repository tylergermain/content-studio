import * as THREE from 'three';
import { MEETING_ROOM, MEETING_TABLE, WALL_HEIGHT } from '../../../shared/layout';
import type { NightParts } from '../outside';
import { mesh, textPlane, toon } from '../toon';
import type { Collider } from '../types';
import { keep, type Fixture } from './fixture';
import { PALETTE, box, glassPane } from './materials';
import { buildMeetingPlace } from './meeting-place';
import type { Door } from './shell';

/** The two lights over the glass room's table: how far either side of its middle. */
const LIGHTS = [-0.95, 0.95];

/** The glass room as it's built: all of it in a group of its own, with what's in the way of it and its door. */
interface GlassRoom {
  group: THREE.Group;
  colliders: Collider[];
  door: Door;
  /** What finishes it off on a floor with nothing over it (see buildGlassRoom). */
  open: THREE.Group;
}

/**
 * The meeting room under the loft: glass walls from the loft's posts round to the outside walls and a
 * sliding glass door facing the lounge. It's the glass only: the table, its chairs, the board and the
 * sign are the floor's meeting place (meeting-place.ts), which stands in here on a floor that meets in
 * the glass room. On a floor with nothing over it, it's a glass room open to the ceiling, its walls
 * capped with a rail.
 */
export function buildGlassRoom(): GlassRoom {
  const group = new THREE.Group();
  const colliders: Collider[] = [];
  const R = MEETING_ROOM;
  const H = R.height;
  const T = 0.1;
  const frameMat = toon('#ffffff');
  const walls = new THREE.Group();
  const bar = (w: number, h: number, d: number, x: number, y: number, z: number) => walls.add(mesh(box(w, h, d), frameMat, x, y, z, false));
  /** A run of glass along x (north wall) or z (west wall), from a to b, in panes about `pane` wide. */
  const run = (axis: 'x' | 'z', a: number, b: number, at: number, pane = 2.2) => {
    const len = b - a;
    const n = Math.max(1, Math.round(len / pane));
    for (let i = 0; i < n; i++) {
      const g = glassPane(len / n, H);
      const u = a + (i + 0.5) * (len / n);
      if (axis === 'x') g.position.set(u, H / 2, at);
      else {
        g.position.set(at, H / 2, u);
        g.rotation.y = Math.PI / 2;
      }
      walls.add(g);
    }
    for (let i = 0; i <= n; i++) {
      const u = a + i * (len / n);
      if (axis === 'x') bar(0.08, H, T + 0.04, u, H / 2, at);
      else bar(T + 0.04, H, 0.08, at, H / 2, u);
    }
    for (const y of [0.05, H - 0.05]) {
      if (axis === 'x') bar(len, 0.1, T + 0.06, (a + b) / 2, y, at);
      else bar(T + 0.06, 0.1, len, at, y, (a + b) / 2);
    }
    colliders.push(axis === 'x' ? { minX: a, maxX: b, minZ: at - T / 2, maxZ: at + T / 2, top: H } : { minX: at - T / 2, maxX: at + T / 2, minZ: a, maxZ: b, top: H });
  };
  run('x', R.minX, R.door.x0, R.minZ);
  run('x', R.door.x1, R.maxX, R.minZ);
  run('z', R.minZ, R.maxZ, R.minX);
  // Over the door, up to the loft's floor.
  bar(R.door.x1 - R.door.x0, 0.1, T + 0.06, (R.door.x0 + R.door.x1) / 2, 2.3, R.minZ);
  group.add(walls);

  // The door: two glass leaves that slide apart over the glass on either side when someone comes up.
  const dx = (R.door.x0 + R.door.x1) / 2;
  const half = (R.door.x1 - R.door.x0) / 2;
  const alu = toon('#aab4be');
  const leaves: [THREE.Group, number][] = [];
  for (const side of [-1, 1]) {
    const leaf = new THREE.Group();
    const h = 2.25;
    for (const y of [0.04, h - 0.04]) leaf.add(mesh(box(half, 0.07, 0.04), alu, 0, y, 0, false));
    for (const x of [-half / 2 + 0.03, half / 2 - 0.03]) leaf.add(mesh(box(0.06, h, 0.04), alu, x, h / 2, 0, false));
    const pane = glassPane(half - 0.12, h - 0.14);
    pane.position.y = h / 2;
    leaf.add(pane);
    leaf.add(mesh(box(0.03, 0.4, 0.07), toon(PALETTE.ink), -side * (half / 2 - 0.1), 1.05, 0, false));
    const x0 = dx + (side * half) / 2;
    leaf.position.set(x0, 0, R.minZ - T / 2 - 0.04);
    group.add(leaf);
    leaves.push([leaf, x0]);
  }
  const door: Door = {
    x: dx,
    y: 0,
    z: R.minZ,
    open: 0,
    show: (k) => {
      const e = k * k * (3 - 2 * k);
      for (const [leaf, x0] of leaves) leaf.position.x = x0 + Math.sign(x0 - dx) * e * (half - 0.06);
    },
  };
  const label = textPlane('🤝 Meeting room', { bg: '#2b2d42', color: '#fffaf3', size: 56, border: '#fffaf3' });
  label.scale.multiplyScalar(0.62);
  // In front of the glass wall's frame (out to R.minZ - 0.08) and the sliding leaves (to R.minZ - 0.11),
  // which it runs across once its text is wider than the door.
  label.position.set(dx, 2.52, R.minZ - 0.13);
  label.rotation.y = Math.PI;
  group.add(label);

  // With no loft over it the room's open to the ceiling, and finished off where the loft's floor was:
  // a slim rail capping the glass, right along both walls and over the door, and a beam from the
  // front wall to the back one over each light, which is set in it instead.
  const open = new THREE.Group();
  const cap = (w: number, h: number, d: number, x: number, y: number, z: number) => open.add(mesh(box(w, h, d), frameMat, x, y, z, false));
  const RAIL = 0.07;
  const lip = (T + 0.1) / 2;
  cap(R.maxX - R.minX + lip, RAIL, lip * 2, (R.minX - lip + R.maxX) / 2, H + RAIL / 2, R.minZ);
  cap(lip * 2, RAIL, R.maxZ - R.minZ - lip, R.minX, H + RAIL / 2, (R.minZ + lip + R.maxZ) / 2);
  for (const dx of LIGHTS) cap(0.14, RAIL - 0.01, R.maxZ - R.minZ - lip, MEETING_TABLE.x + dx, H + RAIL / 2, (R.minZ + lip + R.maxZ) / 2);
  group.add(open);
  return { group, colliders, door, open };
}

/**
 * Flat lights where the glass room's table is, at the height of the loft's floor: a hanging lamp would
 * be in front of the board. Their glow at night is there on every floor (the halos are made once), so
 * the lights are too, whatever the floor has in that corner: set in the floor over them (a loft's or
 * the big mezzanine's), in the glass room's beams where it's open to the ceiling, and where there's
 * neither, on the cords this hands back, long ones down from the ceiling.
 */
function buildLights(group: THREE.Group, night: NightParts): THREE.Group {
  const H = MEETING_ROOM.height;
  const cords = new THREE.Group();
  for (const dx of LIGHTS) {
    const x = MEETING_TABLE.x + dx;
    group.add(mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.04, 20), toon('#fff7d6', { emissive: '#ffe08a' }), x, H - 0.02, MEETING_TABLE.z, false));
    night.halos.push({ at: new THREE.Vector3(x, H - 0.08, MEETING_TABLE.z), size: 0.9, color: '#ffe08a' });
    cords.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, WALL_HEIGHT - H, 6), toon(PALETTE.ink), x, (WALL_HEIGHT + H) / 2, MEETING_TABLE.z, false));
    cords.add(mesh(new THREE.CylinderGeometry(0.08, 0.37, 0.07, 20), toon(PALETTE.ink), x, H + 0.035, MEETING_TABLE.z, false));
  }
  group.add(cords);
  return cords;
}

declare module '../types' {
  interface OfficeHandles {
    /** The meeting's board, showing its output as it's written, and the sign that says how it's going: wherever the floor's workers meet. */
    meetingBoard: THREE.Mesh;
    meetingSign: THREE.Mesh;
  }
}

/**
 * Where the floor's workers meet. It's the floor's choice (see RoomOptions.meeting): the glass room
 * under the loft (or, on a floor without one, open to the ceiling), which is put away with what you'd
 * bump into of it on a floor that meets on the stage or at the anchor desk instead, its door kept
 * shut. The table, the chairs, the board and the sign are meeting-place.ts's, and move with the choice.
 */
export const meetingRoom: Fixture<'meetingBoard' | 'meetingSign'> = (site) => {
  const glass = buildGlassRoom();
  site.group.add(glass.group);
  site.doors.push(glass.door);
  const place = buildMeetingPlace(site);
  const cords = buildLights(site.group, site.get('night'));
  site.get('room').on((room) => {
    const there = room.meeting === 'room';
    const overhead = room.mezzanine !== 'none';
    glass.group.visible = there;
    glass.open.visible = !overhead;
    glass.door.locked = !there;
    keep(site.colliders, glass.colliders, there);
    cords.visible = !there && !overhead;
  });
  return { handle: { meetingBoard: place.board, meetingSign: place.sign } };
};
