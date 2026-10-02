import * as THREE from 'three';
import { DESK_SIZE } from '../../../shared/layout';
import { kindDef, type FurnitureKind, type Piece } from '../../../shared/furniture';
import { mesh, roundedBox, textPlane, toon } from '../toon';
import { DECOR_BUILDERS } from './furniture-decor';
import { DARK_WOOD, legs, placeholder, type BuiltPiece, type Builders } from './furniture-kit';
import { PLAY_BUILDERS } from './furniture-play';
import { ROOMS_BUILDERS } from './furniture-rooms';
import { SCREENS_BUILDERS } from './furniture-screens';
import { STUDIO_BUILDERS } from './furniture-studio';
import { TICKER_BUILDERS } from './furniture-ticker';
import { PALETTE, box } from './materials';

export type { BuiltPiece } from './furniture-kit';
import { coffeeTable, loungeCouch, plant, pouf, type PlantSpecies } from './props';
import { chair } from './seats';

// The office's furniture as it looks: one builder for each kind the office builder has (see
// shared/furniture.ts for what each is and how much floor it takes). The lounge's pieces and the plants
// are the models they always were (props.ts); the rest is built here. Each stands on the floor with its
// origin under the middle of its footprint, its front toward +z.

const PLANT_SPECIES: Partial<Record<FurnitureKind, PlantSpecies>> = { monstera: 'monstera', 'snake-plant': 'snake_plant', ficus: 'ficus' };

/** A rug `w` by `d`, lying a hair over the floor (and over the last one laid, where two overlap). */
function rug(w: number, d: number, corner: number, color: string, lift: number): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(roundedBox(w, 0.02, d, corner), toon(color), 0, 0.011 + lift, 0, false));
  return g;
}

/**
 * A desk of your own: a desk with a monitor and a keyboard on it, and a chair in `color` pulled up to
 * it. The desk is toward the back of its footprint and the chair toward the front, facing it.
 */
function teamDesk(color: string): BuiltPiece {
  const g = new THREE.Group();
  const height = DESK_SIZE.height;
  const deskZ = -0.5;
  const w = 1.7;
  const d = 0.8;
  const top = mesh(roundedBox(w, 0.08, d, 0.08), toon(PALETTE.desk), 0, height - 0.04, deskZ);
  g.add(top);
  const frame = new THREE.Group();
  frame.position.z = deskZ;
  legs(frame, w, d, height - 0.08);
  g.add(frame);
  // The modesty panel, at the back.
  g.add(mesh(box(w - 0.3, 0.32, 0.03), toon(color), 0, height - 0.26, deskZ - d / 2 + 0.06));
  // The monitor on its stand, facing the chair.
  const ink = toon(PALETTE.ink);
  g.add(mesh(roundedBox(0.3, 0.02, 0.2, 0.05), ink, 0, height + 0.01, deskZ - 0.14));
  g.add(mesh(box(0.05, 0.2, 0.04), ink, 0, height + 0.11, deskZ - 0.16));
  const bezel = mesh(roundedBox(0.78, 0.04, 0.48, 0.03), ink, 0, height + 0.42, deskZ - 0.14);
  bezel.rotation.x = Math.PI / 2;
  g.add(bezel);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.42), new THREE.MeshBasicMaterial({ color: '#1b1d2e' }));
  screen.position.set(0, height + 0.42, deskZ - 0.118);
  g.add(screen);
  // A keyboard and a mouse.
  g.add(mesh(roundedBox(0.46, 0.02, 0.15, 0.03), toon('#e9ecef'), -0.04, height + 0.01, deskZ + 0.14));
  g.add(mesh(roundedBox(0.07, 0.025, 0.11, 0.03), toon('#e9ecef'), 0.36, height + 0.012, deskZ + 0.15));
  const seat = chair(color);
  seat.position.set(0, 0, 0.42);
  g.add(seat);
  return { group: g, screen };
}

function table(color: string): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(roundedBox(2.4, 0.08, 1.1, 0.1), toon(color), 0, 0.72, 0));
  legs(g, 2.4, 1.1, 0.68, 0.16);
  return g;
}

function standingTable(color: string): THREE.Group {
  const g = new THREE.Group();
  const post = toon(PALETTE.deskLeg);
  g.add(mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.06, 28), toon(color), 0, 1.02, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.96, 10), post, 0, 0.5, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.3, 0.32, 0.04, 24), post, 0, 0.02, 0));
  return g;
}

function sideTable(color: string): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(roundedBox(0.58, 0.06, 0.58, 0.08), toon(color), 0, 0.49, 0));
  g.add(mesh(roundedBox(0.5, 0.04, 0.5, 0.06), toon(color), 0, 0.18, 0));
  legs(g, 0.58, 0.58, 0.46, 0.07);
  return g;
}

function armchair(color: string): THREE.Group {
  const g = new THREE.Group();
  const cloth = toon(color);
  g.add(mesh(roundedBox(0.94, 0.3, 0.86, 0.1), cloth, 0, 0.2, 0));
  // The cushion you sit on, and the back behind it.
  g.add(mesh(roundedBox(0.66, 0.14, 0.62, 0.1), cloth, 0, 0.38, 0.08));
  const back = mesh(roundedBox(0.9, 0.2, 0.62, 0.1), cloth, 0, 0.62, -0.36);
  back.rotation.x = Math.PI / 2 - 0.14;
  g.add(back);
  for (const sx of [-1, 1]) g.add(mesh(roundedBox(0.16, 0.28, 0.8, 0.07), cloth, sx * 0.41, 0.47, 0.02));
  const foot = toon(DARK_WOOD);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.06, 8), foot, sx * 0.38, 0.03, sz * 0.34));
  return g;
}

/** A panel on two feet, to wall an area off with. */
function divider(color: string): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(roundedBox(2.3, 1.3, 0.07, 0.03), toon(color), 0, 0.8, 0));
  const frame = toon(PALETTE.deskLeg);
  g.add(mesh(box(2.34, 0.05, 0.09), frame, 0, 1.47, 0));
  for (const sx of [-1, 1]) {
    g.add(mesh(box(0.05, 1.5, 0.09), frame, sx * 1.17, 0.75, 0));
    g.add(mesh(roundedBox(0.1, 0.04, 0.2, 0.03), frame, sx * 1.1, 0.02, 0));
  }
  return g;
}

const BOOKS = ['#e63946', '#457b9d', '#f4a261', '#2a9d8f', '#9b5de5', '#ffd166'];

function bookcase(color: string): THREE.Group {
  const g = new THREE.Group();
  const wood = toon(color);
  const w = 1.6;
  const d = 0.42;
  const h = 1.9;
  for (const sx of [-1, 1]) g.add(mesh(box(0.05, h, d), wood, sx * (w / 2 - 0.025), h / 2, 0));
  g.add(mesh(box(w, h, 0.03), toon(DARK_WOOD), 0, h / 2, -d / 2 + 0.015));
  const shelves = [0.03, 0.5, 0.97, 1.44, h - 0.025];
  for (const y of shelves) g.add(mesh(box(w - 0.1, 0.05, d - 0.02), wood, 0, y, 0.01));
  // A row of books on each shelf, each a little different, the same every time it's built.
  shelves.slice(0, -1).forEach((y, row) => {
    let x = -w / 2 + 0.1;
    for (let i = 0; x < w / 2 - 0.2; i++) {
      const seed = (row * 7 + i * 13) % 11;
      const thick = 0.05 + (seed % 4) * 0.012;
      const tall = 0.28 + (seed % 5) * 0.025;
      // A gap now and then, where a book's out.
      if (seed !== 3) g.add(mesh(box(thick, tall, 0.24), toon(BOOKS[(row + i) % BOOKS.length]), x + thick / 2, y + 0.025 + tall / 2, 0.02));
      x += thick + 0.008;
    }
  });
  return g;
}

function floorLamp(color: string): THREE.Group {
  const g = new THREE.Group();
  const stand = toon(PALETTE.ink);
  g.add(mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.04, 20), stand, 0, 0.02, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.4, 8), stand, 0, 0.72, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.16, 0.24, 0.32, 20, 1, true), toon(color), 0, 1.54, 0, false));
  g.add(mesh(new THREE.SphereGeometry(0.09, 10, 8), toon('#fff7d6', { emissive: '#ffe08a' }), 0, 1.5, 0, false));
  return g;
}

/** A sign standing on the floor on two posts, saying `text` on both sides. */
function sign(color: string, text: string): THREE.Group {
  const g = new THREE.Group();
  const post = toon(PALETTE.deskLeg);
  for (const sx of [-1, 1]) {
    g.add(mesh(box(0.06, 1.2, 0.06), post, sx * 0.8, 0.6, 0));
    g.add(mesh(roundedBox(0.12, 0.04, 0.36, 0.03), post, sx * 0.8, 0.02, 0));
  }
  g.add(mesh(roundedBox(1.76, 0.5, 0.07, 0.03), toon(color), 0, 1.33, 0));
  // Light letters on a dark board, dark ones on a light one.
  const c = new THREE.Color(color);
  const ink = c.r * 0.299 + c.g * 0.587 + c.b * 0.114 > 0.6 ? '#2b2d42' : '#fffaf3';
  for (const side of [1, -1]) {
    const label = textPlane(text, { color: ink, size: 72 });
    const fit = Math.min(1.6 / label.geometry.parameters.width, 0.4 / label.geometry.parameters.height);
    label.scale.setScalar(fit);
    label.position.set(0, 1.33, side * 0.037);
    label.userData.letters = true;
    if (side < 0) label.rotation.y = Math.PI;
    g.add(label);
  }
  return g;
}

/**
 * A piece of furniture as it's built, in `p`'s color and saying what it says, at the origin: whoever
 * builds it puts it where it stands and turns it. `index` is where it comes in the floor's list, which
 * lays one rug a hair over another.
 */
export function buildPiece(p: Piece, index = 0): BuiltPiece {
  const k = kindDef(p.kind);
  const color = p.color ?? k.color ?? '#ffffff';
  const lift = (index % 12) * 0.0012;
  const build = BUILDERS[p.kind];
  const built = build ? build(p, color, lift) : placeholder(p, color);
  return built instanceof THREE.Group ? { group: built } : built;
}

/** A group round something that isn't one (a model's piece). */
function wrap(o: THREE.Object3D): THREE.Group {
  const group = new THREE.Group();
  group.add(o);
  return group;
}

const plantOf = (species: PlantSpecies) => () => plant(species, 1);

/** Every kind's builder: the ones here, and each part of the catalog's own (the files beside this one). */
const BUILDERS: Builders = {
  'team-desk': (_p, color) => teamDesk(color),
  table: (_p, color) => table(color),
  'standing-table': (_p, color) => standingTable(color),
  'coffee-table': () => wrap(coffeeTable()),
  'side-table': (_p, color) => sideTable(color),
  sofa: (_p, color) => loungeCouch(color),
  armchair: (_p, color) => armchair(color),
  pouf: (_p, color) => wrap(pouf(color)),
  monstera: plantOf(PLANT_SPECIES.monstera!),
  'snake-plant': plantOf(PLANT_SPECIES['snake-plant']!),
  ficus: plantOf(PLANT_SPECIES.ficus!),
  rug: (_p, color, lift) => rug(6.2, 4.6, 0.6, color, lift),
  'rug-large': (_p, color, lift) => rug(7, 7, 1.2, color, lift),
  'rug-small': (_p, color, lift) => rug(3, 2, 0.4, color, lift),
  'rug-round': (_p, color, lift) => {
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(1.6, 1.6, 0.02, 48), toon(color), 0, 0.011 + lift, 0, false));
    return g;
  },
  divider: (_p, color) => divider(color),
  bookcase: (_p, color) => bookcase(color),
  'floor-lamp': (_p, color) => floorLamp(color),
  sign: (p, color) => sign(color, p.text ?? kindDef(p.kind).text ?? ''),
  ...ROOMS_BUILDERS,
  ...DECOR_BUILDERS,
  ...STUDIO_BUILDERS,
  ...SCREENS_BUILDERS,
  ...TICKER_BUILDERS,
  ...PLAY_BUILDERS,
};

/**
 * Lets go of what a piece was built with that was its own: its shapes, a sign's letters, and a
 * painting's picture (`userData.own`: the material is its own, the image on it is everyone's who shows
 * it, see world/frames.ts). A model's shapes are shared with every other copy of it (see piece() in
 * world/models.ts), so they're never let go of.
 */
export function disposePiece(group: THREE.Object3D) {
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (!m.userData.shared) m.geometry.dispose();
    if (m.userData.letters) {
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.map?.dispose();
      mat.dispose();
    } else if (m.userData.own) (m.material as THREE.Material).dispose();
  });
}
