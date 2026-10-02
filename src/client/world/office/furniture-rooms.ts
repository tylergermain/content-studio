import * as THREE from 'three';
import { palette, piece } from '../models';
import { toon } from '../toon';
import { BLACK, type Builders } from './furniture-kit';
import { glassPane } from './materials';

// The furniture's builders for one part of the catalog (see furniture.ts, and shared/furniture.ts for
// what each kind is and how much floor it takes): the walls a floor is divided into rooms with. They're
// modelled in Blender (blender/scripts/build_rooms.py): each is a painted copy of one piece of rooms.glb
// (see piece()), 2.6 tall, its length along x and its ends cut square, so a row of them makes one wall.

/** What isn't the piece's own paint: the felt behind a wood panel's slats, and its black steel foot and cap. */
const paintRooms = palette({ Backing: '#2b2d42', Steel: BLACK });

/** A color `k` times as bright: a wall's skirting and cap are a shade of its paint. */
const shade = (color: string, k: number) => `#${new THREE.Color(color).multiplyScalar(k).getHexString()}`;

/** A piece of rooms.glb, the materials in `own` painted the piece's way and the rest the pack's. */
function room(part: string, own: Record<string, THREE.Material>): THREE.Group {
  const g = new THREE.Group();
  g.add(piece('rooms', part, (name) => own[name] ?? paintRooms(name)));
  return g;
}

/** A painted wall, its skirting board and its cap a shade darker. */
const wall = (part: string, color: string) => room(part, { Wall: toon(color), Trim: toon(shade(color, 0.84)) });

/** A panel of upright wood slats, `color` the wood. */
const woodWall = (part: string, color: string) => room(part, { Slat: toon(color) });

/** Where the glass goes in a glass wall's frame (GLASS in build_rooms.py): from the rail along the floor to the one along the top. */
const GLASS = { bottom: 0.09, top: 2.54 };
/** The bays between a glass wall's posts (BAYS in build_rooms.py): each one's middle along x, and its width. */
const BAYS = {
  glass_wall: [
    [-0.585, 1.13],
    [0.585, 1.13],
  ],
  glass_short: [[0, 1.1]],
} as const;

/** A steel and glass partition: its frame in `color`, and a sheet of the office's window glass in each bay. */
function glassWall(part: keyof typeof BAYS, color: string): THREE.Group {
  const g = room(part, { Frame: toon(color) });
  for (const [x, w] of BAYS[part]) {
    const pane = glassPane(w, GLASS.top - GLASS.bottom);
    pane.position.set(x, (GLASS.top + GLASS.bottom) / 2, 0);
    g.add(pane);
  }
  return g;
}

export const ROOMS_BUILDERS: Builders = {
  wall: (_p, color) => wall('wall', color),
  'wall-short': (_p, color) => wall('wall_short', color),
  'glass-wall': (_p, color) => glassWall('glass_wall', color),
  'glass-short': (_p, color) => glassWall('glass_short', color),
  'wood-wall': (_p, color) => woodWall('wood_wall', color),
  'wood-short': (_p, color) => woodWall('wood_short', color),
};
