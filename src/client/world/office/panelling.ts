import * as THREE from 'three';
import { EXIT_DOOR, FLOOR, type Side } from '../../../shared/layout';
import { PANEL_SIDES } from '../../../shared/floorplan';
import { cutOut, panelRegions, type PanelRegion } from '../../../shared/panels';
import { toon } from '../toon';
import type { Fixture } from './fixture';

// Wood on the room's outside walls, floor to ceiling: upright slats on dark felt, the same as a wood
// slat panel from the builder's Rooms (furniture-rooms.ts), but the whole wall. Which walls have it,
// and in which wood, is the floor's choice (RoomOptions.panels and .wood). Each wall's slats are one
// flat sheet just inside its face, cut round its windows and doors (shared/panels.ts), so the boards,
// the TV, the pictures and everything else that hangs on the wall hang in front of it.

/** One slat and the gap beside it, in metres (PITCH and SLAT_W in blender/scripts/build_rooms.py). */
const PITCH = 0.075;
const SLAT = 0.045;
/** The felt behind the slats (the Backing of furniture-rooms.ts). */
const FELT = '#2b2d42';
/** What the slats are: oak is the wood slat panel's own color. */
const WOODS = { oak: '#b98554', walnut: '#7a5236' } as const;
/** How far inside the wall's face the sheet is: behind a hung picture's frame, which is 5 mm off it. */
const OFF = 0.003;

/** One slat's width of a wood, to repeat along a wall: felt, the slat with its eased edges a shade darker, felt. */
function slats(wood: keyof typeof WOODS): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 8;
  const g = c.getContext('2d')!;
  const px = c.width / PITCH;
  const edge = ((PITCH - SLAT) / 2) * px;
  g.fillStyle = FELT;
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = `#${new THREE.Color(WOODS[wood]).multiplyScalar(0.8).getHexString()}`;
  g.fillRect(edge, 0, SLAT * px, c.height);
  g.fillStyle = WOODS[wood];
  g.fillRect(edge + 3, 0, SLAT * px - 6, c.height);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** The point `u` along the `side` wall and `y` up it, on the sheet. */
function at(side: Side, u: number, y: number): [number, number, number] {
  switch (side) {
    case 'north':
      return [u, y, FLOOR.minZ + OFF];
    case 'south':
      return [u, y, FLOOR.maxZ - OFF];
    case 'west':
      return [FLOOR.minX + OFF, y, u];
    case 'east':
      return [FLOOR.maxX - OFF, y, u];
  }
}

/** The way each wall's sheet faces: into the room. */
const INWARD: Record<Side, [number, number, number]> = { north: [0, 0, 1], south: [0, 0, -1], west: [1, 0, 0], east: [-1, 0, 0] };

/** `regions` of the `side` wall as one mesh, its slats a PITCH apart all the way along whatever it's cut round. */
function sheet(side: Side, regions: readonly PanelRegion[], mat: THREE.Material): THREE.Mesh {
  const position: number[] = [];
  const normal: number[] = [];
  const uv: number[] = [];
  // Seen from inside the room, u runs to the left on the south and west walls: their corners go round the other way.
  const mirrored = side === 'south' || side === 'west';
  for (const r of regions) {
    const corners: [number, number][] = [
      [r.u0, r.y0],
      [r.u1, r.y0],
      [r.u1, r.y1],
      [r.u0, r.y1],
    ];
    for (const i of mirrored ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3]) {
      const [u, y] = corners[i];
      position.push(...at(side, u, y));
      normal.push(...INWARD[side]);
      uv.push(u / PITCH, y);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true;
  m.visible = false;
  return m;
}

/**
 * The wood walls. Every side's sheet is built once and shown on the floors that have that wall in wood
 * (see RoomOptions.panels); on a floor above the bottom one, where the exit doorway is wall (see plug
 * in shell.ts), the west wall's wood runs on over it.
 */
export const panelling: Fixture = (site) => {
  const group = new THREE.Group();
  // Oak unless a floor says walnut: the other wood is only painted for the first floor that has it.
  const textures: Partial<Record<keyof typeof WOODS, THREE.CanvasTexture>> = { oak: slats('oak') };
  // Drawn a touch nearer than it is, so 3 mm off the paint never flickers with it from across the room.
  const mat = new THREE.MeshToonMaterial({ map: textures.oak, gradientMap: toon('#fff').gradientMap, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  // It's flat: no toon outline (see noOutline).
  mat.userData.outlineParameters = { visible: false };

  const sheets = {} as Record<Side, THREE.Mesh>;
  for (const side of PANEL_SIDES) group.add((sheets[side] = sheet(side, panelRegions(side, false), mat)));
  // What the plugged doorway adds to its wall: that wall's wood with the door shut up, less its wood with the door there.
  const open = panelRegions(EXIT_DOOR.wall, false);
  const patch = sheet(
    EXIT_DOOR.wall,
    panelRegions(EXIT_DOOR.wall, true).flatMap((r) => cutOut(r, open)),
    mat,
  );
  group.add(patch);

  let plugged = false;
  const show = () => {
    const room = site.get('room').get();
    for (const side of PANEL_SIDES) sheets[side].visible = room.panels.includes(side);
    patch.visible = plugged && sheets[EXIT_DOOR.wall].visible;
    if (room.panels.length) mat.map = textures[room.wood] ??= slats(room.wood);
  };
  site.get('room').on(show);
  return {
    group,
    setLevel: (index) => {
      plugged = index > 0;
      show();
    },
  };
};
