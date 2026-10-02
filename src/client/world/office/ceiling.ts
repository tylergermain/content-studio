import * as THREE from 'three';
import { CEILING_KINDS, type CeilingKind } from '../../../shared/floorplan';
import { ELEVATOR_FRONT, FLOOR, WALL_HEIGHT } from '../../../shared/layout';
import { bulb, type NightParts } from '../outside';
import { canvasTexture } from '../texture';
import { mergeByMaterial, mesh, toon } from '../toon';
import type { Fixture } from './fixture';
import { PALETTE, box } from './materials';

// What hangs under the office's ceiling: the five pendant lamps, and the floor's own choice of what's
// up there with them (see RoomOptions.ceiling). The tiles themselves are the stack's, on every floor;
// a floor that says nothing has them bare, with the yellow cone pendants the office comes with. The
// others each hang a kit under them: timber beams, a row of banners and a light ring, or a studio's
// lighting grid. Everything of a kit is well over every head (nothing under 4.4 m, so over the big
// mezzanine's stairs and rail too), clear of the fire pole and the ladder's hatch, and none of it is
// in anyone's way: there's nothing here to bump into. Its lights are bulbs the sky turns up at night
// (see bulb), with no halos of their own: the sky makes those once, for the pendants.

/** Where the five pendants hang: where they always have, since the sky makes their halos once (see NightParts.halos). */
export const LAMPS: readonly (readonly [x: number, z: number])[] = [
  [-10.5, -4],
  [-1.5, -4],
  [-10.5, 4],
  [-1.5, 4],
  [13, 0],
];
/** How high their shades hang. */
export const LAMP_Y = 4.05;

/** The kinds of ceiling with something hung under the tiles. */
export type CeilingKit = Exclude<CeilingKind, 'tiles'>;

/** Charcoal, for a studio's rigging: the Steps' own. */
const DARK = '#101112';
const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
type P3 = readonly [x: number, y: number, z: number];

/**
 * A pendant lamp, its shade at 0, on a cord `cord` meters long, with a shade for each kind of ceiling,
 * of which a floor shows one: the office's yellow cone (the pendant in props.ts, part for part), the
 * same cone in green enamel under beams, a white globe under banners, and a black dome under a
 * lighting grid. `glass` is the globe's, which is lit itself.
 */
function pendant(cord: number, glass: THREE.Material): { lamp: THREE.Group; shades: Record<CeilingKind, THREE.Object3D> } {
  const lamp = new THREE.Group();
  const c = cord / 0.8;
  const ink = toon(PALETTE.ink);
  lamp.add(mesh(new THREE.CylinderGeometry(0.01, 0.01, c, 4), ink, 0, c / 2, 0, false));
  lamp.add(mesh(new THREE.SphereGeometry(0.16, 10, 8), toon('#fff7d6', { emissive: '#ffe08a' }), 0, -0.15, 0, false));
  const cone = (color: string) => mesh(new THREE.ConeGeometry(0.5, 0.45, 16, 1, true), toon(color), 0, 0, 0, false);
  // The globe is round the bulb, on a collar where the cord goes in.
  const globe = new THREE.Group();
  globe.add(mesh(new THREE.SphereGeometry(0.26, 18, 12), glass, 0, -0.11, 0, false));
  globe.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.1, 10), ink, 0, 0.17, 0, false));
  // The dome is a shallow bowl upside down, the bulb just showing under its rim. A shape has only
  // the one face, so its pale lining is a bowl of its own: the other half of the ball, turned over,
  // which turns it inside out.
  const dome = new THREE.Group();
  dome.add(mesh(new THREE.SphereGeometry(0.5, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2), toon(DARK), 0, 0, 0, false));
  dome.add(mesh(new THREE.SphereGeometry(0.49, 18, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).scale(1, -1, 1), toon('#f3ead8'), 0, 0, 0, false));
  dome.position.y = -0.2;
  dome.scale.y = 0.6;
  const shades: Record<CeilingKind, THREE.Object3D> = { tiles: cone('#ffd166'), beams: cone('#09ca59'), banners: globe, grid: dome };
  for (const kind of CEILING_KINDS) lamp.add(shades[kind]);
  lamp.scale.setScalar(0.8);
  return { lamp, shades };
}

/**
 * Ceiling lamps (cartoon pendants), hung on long cords down from the high ceiling. Their shades are
 * the floor's own (see RoomOptions.ceiling); where they hang isn't, and nor are their halos.
 */
export const lamps: Fixture = (site) => {
  const night = site.get('night');
  const glass = bulb(night, '#fffaf0', 0.5);
  const hung = LAMPS.map(([x, z]) => {
    const { lamp, shades } = pendant(WALL_HEIGHT - LAMP_Y, glass);
    lamp.position.set(x, LAMP_Y, z);
    site.group.add(lamp);
    night.halos.push({ at: new THREE.Vector3(x, LAMP_Y - 0.12, z), size: 1.3, color: '#ffe08a' });
    return shades;
  });
  site.get('room').on((room) => {
    for (const shades of hung) for (const kind of CEILING_KINDS) shades[kind].visible = kind === room.ceiling;
  });
  return {};
};

/** A round bar from `a` to `b`, `r` thick. */
function rod(mat: THREE.Material, a: P3, b: P3, r: number): THREE.Mesh {
  const from = new THREE.Vector3(...a);
  const along = new THREE.Vector3(...b).sub(from);
  const m = mesh(new THREE.CylinderGeometry(r, r, along.length(), 8), mat, 0, 0, 0, false);
  m.position.copy(from).addScaledVector(along, 0.5);
  m.quaternion.setFromUnitVectors(UP, along.normalize());
  return m;
}

/** A spotlight clamped under `on` and turned to shine at `at`: a black can on a short stem, with a lit lens. It reaches 0.55 down at the most. */
function spot(dark: THREE.Material, lens: THREE.Material, on: P3, at: P3): THREE.Group {
  const g = new THREE.Group();
  g.position.set(...on);
  g.add(mesh(box(0.1, 0.1, 0.1), dark, 0, 0, 0, false));
  g.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.16, 6), dark, 0, -0.1, 0, false));
  const can = new THREE.Group();
  can.position.y = -0.3;
  can.add(mesh(new THREE.CylinderGeometry(0.1, 0.15, 0.34, 14), dark, 0, 0, 0, false));
  can.add(mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.02, 14), lens, 0, -0.17, 0, false));
  can.quaternion.setFromUnitVectors(DOWN, new THREE.Vector3(at[0] - on[0], at[1] - (on[1] - 0.3), at[2] - on[2]).normalize());
  g.add(can);
  return g;
}

/** The beams: how wide and deep each is, its timber (walnut), and where each runs from north to south, x and the z it starts at. */
const BEAM = { w: 0.3, h: 0.5, color: '#7a5236' } as const;
const BEAMS: readonly (readonly [x: number, fromZ: number])[] = [
  [-14.4, FLOOR.minZ],
  [-7.2, FLOOR.minZ],
  [0, FLOOR.minZ],
  // This one starts at the elevator's shaft, which goes up through the ceiling where it would run.
  [8.4, ELEVATOR_FRONT],
  [15.6, FLOOR.minZ],
];

/** Timber beams across the room under the tiles, from the north wall to the south: over the corner loft's roof, and well over the big mezzanine. */
function beams(): THREE.Group {
  const parts = new THREE.Group();
  const timber = toon(BEAM.color);
  for (const [x, fromZ] of BEAMS) parts.add(mesh(box(BEAM.w, BEAM.h, FLOOR.maxZ - fromZ), timber, x, WALL_HEIGHT - BEAM.h / 2, (fromZ + FLOOR.maxZ) / 2, false));
  return mergeByMaterial(parts);
}

/**
 * The banners: a row of them down the middle of the room, each across it (`w` wide in z) on a pole
 * under the tiles, its tails `bottom` up, the first at `fromX` and one every `step` east of it. The
 * last is over a meter from the fire pole's hole in the ceiling.
 */
const BANNER = { w: 1.6, top: WALL_HEIGHT - 0.14, bottom: 4.5, tails: 0.4, depth: 0.03, fromX: -4, step: 1.25, count: 9, z: 0 } as const;
/** What's written on one: how big, and how high its middle is. */
const LETTERS = { w: 1.2, h: 1.5, y: 5.72 } as const;
/** The light ring over the stage: a round truss `r` across on wires, with a lit strip under it and spots turned on the panel's table. */
const RING = { x: 14.6, z: 0, r: 3.2, y: 5.2, top: 5.5, spots: 8, at: { x: 15.5, y: 1 } } as const;

/** LEVEL and its number, white on nothing: what a banner says, on either face. */
function levelTexture(level: number): THREE.CanvasTexture {
  return canvasTexture(512, 640, (g) => {
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '800 92px Nunito, ui-rounded, system-ui, sans-serif';
    g.letterSpacing = '18px';
    // (The spacing after its last letter would push the word off its middle.)
    g.fillText('LEVEL', 256 + 9, 96);
    g.letterSpacing = '0px';
    g.font = '800 470px Nunito, ui-rounded, system-ui, sans-serif';
    g.fillText(String(level), 256, 400);
  });
}

/**
 * Banners down the middle of the room, in the floor's own trim (`trim`), LEVEL 1 to LEVEL 9 from the
 * west on both faces: walk east under them and they count up to the stage, which has a light ring over it.
 */
function banners(lit: THREE.Material, trim: THREE.Material): THREE.Group {
  const parts = new THREE.Group();
  const group = new THREE.Group();
  const dark = toon(DARK);
  const { w, top, bottom, tails, depth } = BANNER;
  // The cloth, drawn hanging from its pole at 0 with a swallowtail cut out of its bottom edge, across x: turned a quarter, it's across the room.
  const cut = new THREE.Shape();
  cut.moveTo(-w / 2, 0);
  cut.lineTo(w / 2, 0);
  cut.lineTo(w / 2, bottom - top);
  cut.lineTo(0, bottom - top + tails);
  cut.lineTo(-w / 2, bottom - top);
  cut.closePath();
  const cloth = new THREE.ExtrudeGeometry(cut, { depth, bevelEnabled: false });
  cloth.translate(0, 0, -depth / 2);
  cloth.rotateY(Math.PI / 2);
  for (let i = 0; i < BANNER.count; i++) {
    const x = BANNER.fromX + i * BANNER.step;
    parts.add(mesh(cloth, trim, x, top, BANNER.z, false));
    // Its pole, and the two cords it hangs from the ceiling by.
    parts.add(rod(dark, [x, top, BANNER.z - w / 2 - 0.06], [x, top, BANNER.z + w / 2 + 0.06], 0.03));
    for (const side of [-1, 1]) parts.add(rod(dark, [x, top, BANNER.z + side * (w / 2 - 0.1)], [x, WALL_HEIGHT, BANNER.z + side * (w / 2 - 0.1)], 0.01));
    const letters = new THREE.MeshBasicMaterial({ map: levelTexture(i + 1), transparent: true, alphaTest: 0.05 });
    for (const side of [-1, 1]) {
      const face = new THREE.Mesh(new THREE.PlaneGeometry(LETTERS.w, LETTERS.h), letters);
      face.position.set(x + side * (depth / 2 + 0.004), LETTERS.y, BANNER.z);
      face.rotation.y = (side * Math.PI) / 2;
      group.add(face);
    }
  }

  // The ring: two hoops with struts between them, hung on four wires.
  const hoop = (y: number, tube: number, mat: THREE.Material) => {
    const m = mesh(new THREE.TorusGeometry(RING.r, tube, 8, 64), mat, RING.x, y, RING.z, false);
    m.rotation.x = Math.PI / 2;
    return m;
  };
  parts.add(hoop(RING.y, 0.06, dark), hoop(RING.top, 0.04, dark), hoop(RING.y - 0.06, 0.03, lit));
  /** Where on the ring `turns` of the way round it is. */
  const round = (turns: number): [x: number, z: number] => [RING.x + Math.cos(turns * Math.PI * 2) * RING.r, RING.z + Math.sin(turns * Math.PI * 2) * RING.r];
  for (let i = 0; i < 16; i++) {
    const [x, z] = round((i + 0.5) / 16);
    parts.add(rod(dark, [x, RING.y, z], [x, RING.top, z], 0.02));
    // Every fourth strut carries on up to the ceiling as a wire.
    if (i % 4 === 0) parts.add(rod(dark, [x, RING.top, z], [x, WALL_HEIGHT, z], 0.012));
  }
  // Its spots, between the struts, each turned on the panel's table across from it.
  for (let i = 0; i < RING.spots; i++) {
    const [x, z] = round((i + 0.5) / RING.spots);
    parts.add(spot(dark, lit, [x, RING.y - 0.08, z], [RING.at.x, RING.at.y, RING.z + (z - RING.z) * 0.6]));
  }
  group.add(mergeByMaterial(parts));
  // (Merged, every banner has a cloth of its own.)
  cloth.dispose();
  return group;
}

/**
 * The lighting grid: black pipes `y` up, over the desks north of where a big mezzanine's stairs and
 * rail are. `across` are the ones running east to west (z, and from which x to which), `along` the
 * ones from north to south (x, and from which z to which): short of the elevator's shaft in the
 * north-east, and the one that would pass the fire pole is broken either side of it.
 */
const GRID = {
  y: 5.7,
  r: 0.045,
  across: [
    [-11, -17, 7],
    [-8, -17, 10],
    [-5, -17, 10],
    [-2, -17, 10],
    [1, -17, 5.9],
    [1, 7.7, 10],
    [4, -17, 10],
  ],
  along: [
    [-16, -11, 4],
    [-11, -11, 4],
    [-6, -11, 4],
    [-1, -11, 4],
    [4, -11, 4],
    [9, -10.4, 4],
  ],
  /** The rows it hangs from the ceiling at: a wire at every pipe along that crosses one of them. */
  hung: [-8, -2, 4],
  /** A bar of spots under it, over the anchor desk: from which x to which, its z, and the spots' own from first to last. */
  bar: { fromX: -7.4, toX: -0.4, z: -6.2, y: 5.6, spots: 8, first: -6.9, last: -0.9 },
} as const;

/** A studio's lighting grid over the desks, with a bar of spots over the anchor desk. */
function grid(lit: THREE.Material): THREE.Group {
  const parts = new THREE.Group();
  const dark = toon(DARK);
  const { y, r, bar } = GRID;
  for (const [z, fromX, toX] of GRID.across) parts.add(rod(dark, [fromX, y, z], [toX, y, z], r));
  for (const [x, fromZ, toZ] of GRID.along) {
    parts.add(rod(dark, [x, y, fromZ], [x, y, toZ], r));
    for (const [z, fromX, toX] of GRID.across) {
      if (z < fromZ || z > toZ || x < fromX || x > toX) continue;
      // A clamp where two pipes cross, and at some a wire up to the ceiling.
      parts.add(mesh(box(0.14, 0.14, 0.14), dark, x, y, z, false));
      if ((GRID.hung as readonly number[]).includes(z)) parts.add(rod(dark, [x, y, z], [x, WALL_HEIGHT, z], 0.012));
    }
    // The bar hangs under the pipes it crosses.
    if (x > bar.fromX && x < bar.toX) parts.add(mesh(box(0.1, y - bar.y + 0.1, 0.1), dark, x, (y + bar.y) / 2, bar.z, false));
  }
  parts.add(rod(dark, [bar.fromX, bar.y, bar.z], [bar.toX, bar.y, bar.z], 0.035));
  for (let i = 0; i < bar.spots; i++) {
    const x = bar.first + (i * (bar.last - bar.first)) / (bar.spots - 1);
    // Each a little off straight down, every other one the other way, so they aren't a row of soldiers.
    parts.add(spot(dark, lit, [x, bar.y, bar.z], [x, 1, bar.z + (i % 2 ? 0.7 : -0.7)]));
  }
  return mergeByMaterial(parts);
}

/**
 * Every kit as it's built, each in a group of its own. `trim` is the floor's own trim, which the
 * banners are cut from; the lights of all of them are one bulb, which the sky turns up at night.
 */
export function buildCeilings(night: NightParts, trim: THREE.Material): Record<CeilingKit, THREE.Group> {
  const lit = bulb(night, '#fff3d6', 0.55);
  return { beams: beams(), banners: banners(lit, trim), grid: grid(lit) };
}

/**
 * What hangs under the ceiling, which is the floor's choice (see RoomOptions.ceiling): every kit is
 * built, and the one the floor has is shown. There's nothing of any of them to bump into or to use.
 */
export const ceiling: Fixture = (site) => {
  const kits = buildCeilings(site.get('night'), site.looks.trim);
  const group = new THREE.Group();
  for (const kind of Object.keys(kits) as CeilingKit[]) group.add(kits[kind]);
  site.get('room').on((room) => {
    for (const kind of Object.keys(kits) as CeilingKit[]) kits[kind].visible = kind === room.ceiling;
  });
  return { group };
};
