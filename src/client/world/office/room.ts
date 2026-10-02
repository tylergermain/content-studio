import * as THREE from 'three';
import { BOARDS, LOFT, MACHINE_MONITOR, STAIRS, STREET_Y, TV, WALL_HEIGHT } from '../../../shared/layout';
import { wallFacing } from '../../../shared/decor';
import type { NightParts } from '../outside';
import { mesh, roundedBox, textPlane, toon, toonUnique } from '../toon';
import type { Interactable } from '../types';
import type { Fixture } from './fixture';
import { PALETTE } from './materials';
import { wallBoard } from './props';

// The room itself, past its walls and its seats: what the sky lights and darkens, the boards on the
// walls, and the TV and the machine's monitor. What stands on its floor (the lounge, the rugs, the
// plants) is furniture, which the office builder arranges: see furnish.ts. What hangs under its
// ceiling, the lamps with it, is ceiling.ts.

declare module '../types' {
  interface OfficeHandles {
    /** Lights, windows and glass for the sky to change with the time of day and the weather. */
    night: NightParts;
    boardMeshes: Record<keyof typeof BOARDS, THREE.Mesh>;
    /** The sign over each board, which a floor that makes a board its own rewrites (see features/studio). */
    boardLabels: Record<keyof typeof BOARDS, THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>>;
    tvScreen: THREE.Mesh;
    /** The monitor on the west wall showing how busy the office's machine is (features/boards/machine.ts). */
    machineScreen: THREE.Mesh;
  }
}

/** What the sky lights and darkens (see NightParts), which everything after it that has any adds to. */
export const nightLights: Fixture<'night'> = () => ({
  handle: {
    night: {
      bulbs: [],
      halos: [],
      lamps: [],
      windows: [],
      street: STREET_Y,
      clouds: toonUnique('#ffffff'),
      wetGlass: new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false, visible: false }),
      glows: [],
    },
  },
});

/** Cork boards on the walls. */
export const boards: Fixture<'boardMeshes' | 'boardLabels'> = (site) => {
  const boardMeshes = {} as Record<keyof typeof BOARDS, THREE.Mesh>;
  const boardLabels = {} as Record<keyof typeof BOARDS, THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>>;
  for (const key of Object.keys(BOARDS) as (keyof typeof BOARDS)[]) {
    const b = BOARDS[key];
    // Out from the wall, the way the board faces.
    const nx = Math.sin(b.rotY);
    const nz = Math.cos(b.rotY);
    // The queue is a whiteboard in an aluminium frame; the others hang in wood.
    const { group: bg, face } = wallBoard(b.width, b.height, key === 'queue' ? '#aab4be' : PALETTE.wood);
    bg.position.set(b.x + nx * 0.08, b.y, b.z + nz * 0.08);
    bg.rotation.y = b.rotY;
    site.group.add(bg);
    boardMeshes[key] = face;
    const label = textPlane(b.label, { bg: '#fffaf3', size: 64 });
    label.scale.multiplyScalar(1.3);
    label.position.set(b.x + nx * 0.04, b.y + b.height / 2 + 0.5, b.z + nz * 0.04);
    label.rotation.y = b.rotY;
    site.group.add(label);
    boardLabels[key] = label;
    const it: Interactable = { kind: key, x: b.x + nx * 1.6, z: b.z + nz * 1.6, radius: 2.4 };
    site.interactables.push(it);
    bg.userData.interact = it;
    // The board and its label above it, up to the ceiling.
    const wall = wallFacing(b.rotY);
    const bottom = b.y - (b.height + 0.3) / 2;
    site.wall(wall, wall === 'north' || wall === 'south' ? b.x : b.z, (bottom + WALL_HEIGHT) / 2, b.width + 0.3, WALL_HEIGHT - bottom);
  }
  return { handle: { boardMeshes, boardLabels } };
};

/** Lounge: the TV on the east wall. */
export const tv: Fixture<'tvScreen'> = (site) => {
  const tvGroup = new THREE.Group();
  tvGroup.add(mesh(roundedBox(TV.width + 0.3, 0.14, TV.height + 0.3, 0.12), toon(PALETTE.ink), 0, 0, 0));
  (tvGroup.children[0] as THREE.Mesh).rotation.x = Math.PI / 2;
  const tvScreen = new THREE.Mesh(new THREE.PlaneGeometry(TV.width, TV.height), new THREE.MeshBasicMaterial({ color: '#1b1d2e' }));
  tvScreen.position.z = 0.08;
  tvGroup.add(tvScreen);
  tvGroup.position.set(TV.x - 0.1, TV.y, TV.z);
  tvGroup.rotation.y = -Math.PI / 2;
  site.group.add(tvGroup);
  const it: Interactable = { kind: 'tv', x: TV.x - 4.5, z: TV.z, radius: 3.2 };
  site.interactables.push(it);
  tvGroup.userData.interact = it;
  site.wall('east', TV.z, TV.y, TV.width + 0.3, TV.height + 0.3);
  return { handle: { tvScreen } };
};

/** The machine monitor between the west windows, facing the desks. */
export const machineMonitor: Fixture<'machineScreen'> = (site) => {
  const monitor = new THREE.Group();
  const bezel = mesh(roundedBox(MACHINE_MONITOR.width + 0.16, 0.1, MACHINE_MONITOR.height + 0.16, 0.06), toon(PALETTE.ink), 0, 0, 0);
  bezel.rotation.x = Math.PI / 2;
  monitor.add(bezel);
  const machineScreen = new THREE.Mesh(new THREE.PlaneGeometry(MACHINE_MONITOR.width, MACHINE_MONITOR.height), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
  machineScreen.position.z = 0.06;
  monitor.add(machineScreen);
  monitor.position.set(MACHINE_MONITOR.x + 0.07, MACHINE_MONITOR.y, MACHINE_MONITOR.z);
  monitor.rotation.y = Math.PI / 2;
  site.group.add(monitor);
  site.wall('west', MACHINE_MONITOR.z, MACHINE_MONITOR.y, MACHINE_MONITOR.width + 0.2, MACHINE_MONITOR.height + 0.2);
  return { handle: { machineScreen } };
};

/**
 * Pictures stay clear of the corner loft's stairs, step by step, so they can hang above them. On a
 * floor without that loft the stairs are put away, and the wall they ran along is free.
 */
export const clearOfStairs: Fixture = (site) => {
  const run = (STAIRS.toX - STAIRS.fromX) / STAIRS.steps;
  const rise = LOFT.y / STAIRS.steps;
  const marks = Array.from({ length: STAIRS.steps }, (_, i) => site.wall('south', STAIRS.fromX + (i + 0.5) * run, ((i + 1) * rise) / 2, run, (i + 1) * rise));
  site.get('room').on((room) => {
    for (const mark of marks) mark.off = room.mezzanine !== 'corner';
  });
  return {};
};
