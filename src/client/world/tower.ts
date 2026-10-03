import * as THREE from 'three';
import { columnsOf } from '../../shared/clerestory';
import { BALCONY, BALCONY_DOOR, ELEVATOR, ELEVATOR_FRONT, EXIT_DOOR, FLOOR, ROOF_BAR, SLAB, STAGE, STOREY, STREET_Y, WALL_HEIGHT, WALL_T, WINDOWS, WING, wingMinZ, wingRowZ, type Opening, type Side } from '../../shared/layout';
import { FACADE, TOWER, storeys } from './facade';
import type { Collider } from './types';
import type { Fixture } from './office/fixture';
import { bulb, type NightParts } from './outside';
import { mergeByMaterial, mesh, toon, toonUnique } from './toon';
import { barOf, buildTowerBars } from './tower-bars';
import { buildTowerSigns } from './tower-signs';

export { storeysKey } from './facade';

// The rest of the building, from outside: a floor per project at the bottom, in graphite with each
// floor's color on its slab and its name on its wall, and over them the tower, three bars of glass
// (world/tower-bars.ts) up to TOWER.storeys, however many floors there are. Only the floor you're on
// is really there; the others are its outside (walls, windows, a balcony off each, the parapet round
// the top, the rooftop bar and its mast over it, roughly), rebuilt whenever floors come and go or you
// change floors. Up on the roof it's every storey, under your feet.

/** The building, walls included. */
const B = { minX: FLOOR.minX - WALL_T, maxX: FLOOR.maxX + WALL_T, minZ: FLOOR.minZ - WALL_T, maxZ: FLOOR.maxZ + WALL_T } as const;
/** The outside's planes stand this far off the walls, so they never fight the floor you're on for a pixel. */
const OFF = 0.01;
/** How tall the mast on the elevator's housing is, with the beacon on top (features/rooftop/mast.ts is the roof's own, with the same numbers). */
const MAST = 14;

export interface Tower {
  group: THREE.Group;
  /**
   * Builds the outside of every storey but `index`: the `count` real floors from the bottom one (0),
   * and the tower's over them up to TOWER.storeys (or as many as there are floors, if that's more).
   * An `index` of that many or more is the roof: everything below it, and no top (the roof is its
   * own). `wings` is how far each floor's back office is built out (see WING), yours included: the
   * others' are drawn, and all of them stand on posts down to the street. The storeys' colors and
   * names are facade.ts's storeys(), set before.
   */
  set(index: number, count: number, wings?: readonly number[]): void;
}

/** A window in each row of a back office, in the building's east wall (world/office/wing.ts cuts the same ones). */
export function wingWindows(level: number): Opening[] {
  return Array.from({ length: level }, (_, i) => ({ wall: 'east' as const, u: wingRowZ(i + 1), width: 2.4, y0: 1.1, y1: 3.3 }));
}

/** Where the posts under a back office stand: at the back corners of each row. */
export function wingPosts(row: number): { x: number; z: number }[] {
  const z = wingMinZ(row) - WALL_T + 0.22;
  return [
    { x: WING.minX - WALL_T + 0.22, z },
    { x: WING.maxX + WALL_T - 0.22, z },
  ];
}


/** Each side of the building: where along it things are (u, from corner to corner, where it meets the next side's plane), and its plane. */
const FACES: Record<Side, { u0: number; u1: number; at: (u: number, y: number) => THREE.Vector3; rotY: number }> = {
  north: { u0: B.minX - OFF, u1: B.maxX + OFF, at: (u, y) => new THREE.Vector3(u, y, B.minZ - OFF), rotY: Math.PI },
  south: { u0: B.minX - OFF, u1: B.maxX + OFF, at: (u, y) => new THREE.Vector3(u, y, B.maxZ + OFF), rotY: 0 },
  west: { u0: B.minZ - OFF, u1: B.maxZ + OFF, at: (u, y) => new THREE.Vector3(B.minX - OFF, y, u), rotY: -Math.PI / 2 },
  east: { u0: B.minZ - OFF, u1: B.maxZ + OFF, at: (u, y) => new THREE.Vector3(B.maxX + OFF, y, u), rotY: Math.PI / 2 },
};

/** A wall-built group (along x, outdoors toward +z) turned onto `side`, `u` along it. */
function onFace(g: THREE.Object3D, side: Side, u: number): THREE.Object3D {
  const f = FACES[side];
  g.position.copy(f.at(u, 0));
  g.rotation.y = f.rotY;
  return g;
}

export function buildTower(colliders: Collider[], night: NightParts): Tower {
  const group = new THREE.Group();
  // Big flat walls get no cartoon outline (the frames round the windows give it its ink lines).
  const flat = (color: string) => {
    const m = toonUnique(color);
    m.userData.outlineParameters = { visible: false };
    return m;
  };
  const paint = flat(FACADE.skin);
  const frame = toon(FACADE.frame);
  const alu = toon('#aab4be');
  const ink = toon('#3d405b');
  const wood = toon('#c98b5a');
  const deck = flat('#d6a574');
  const edge = flat(FACADE.ink);
  const behind = flat('#2b2d42');
  const concrete = flat(FACADE.concrete);
  // Each storey's slab band (and its balcony's and back office's edges) in its floor's color.
  const bands = new Map<string, THREE.Material>();
  const bandOf = (k: number) => {
    const color = storeys()[k]?.accent ?? FACADE.band;
    let m = bands.get(color);
    if (!m) bands.set(color, (m = flat(color)));
    return m;
  };
  // Glass you can't see into; at night most of it glows, as though everyone's still at it.
  const dark = toon(FACADE.glass);
  const lit = FACADE.lit.map((glow) => {
    const m = toonUnique(FACADE.glass);
    m.emissive.set(glow);
    m.emissiveIntensity = 0;
    night.windows.push(m);
    return m;
  });
  const glint = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35, depthWrite: false });
  const railGlass = new THREE.MeshBasicMaterial({ color: '#d6f1ff', transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide });

  let built: THREE.Object3D[] = [];
  let mine: Collider[] = [];
  let seed = 1;
  /** The same windows light up each time a floor's outside is rebuilt. */
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };

  /**
   * One floor's outside on `side`, `y0` up from the floor you're on: the band of its slab, then its
   * wall round its windows and doors, under, between and over the ones in a column (see columnsOf).
   */
  const facade = (parts: THREE.Group, side: Side, y0: number, holes: Opening[], band: THREE.Material) => {
    const f = FACES[side];
    const piece = (u0: number, u1: number, y1: number, y2: number, mat: THREE.Material) => {
      if (u1 - u0 < 0.001 || y2 - y1 < 0.001) return;
      const m = mesh(new THREE.PlaneGeometry(u1 - u0, y2 - y1), mat, 0, 0, 0, false);
      m.position.copy(f.at((u0 + u1) / 2, (y1 + y2) / 2));
      m.rotation.y = f.rotY;
      parts.add(m);
    };
    piece(f.u0, f.u1, y0 - SLAB, y0, band);
    let u = f.u0;
    for (const { u0: h0, u1: h1, holes: column } of columnsOf(holes)) {
      piece(u, h0, y0, y0 + WALL_HEIGHT, paint);
      let y = 0;
      for (const o of column) {
        piece(h0, h1, y0 + y, y0 + o.y0, paint);
        y = o.y1;
      }
      piece(h0, h1, y0 + y, y0 + WALL_HEIGHT, paint);
      u = h1;
    }
    piece(u, f.u1, y0, y0 + WALL_HEIGHT, paint);
  };

  /** Glass in a hole: set back a little, with a frame round it, a bar down the middle and a sill. */
  const glazing = (parts: THREE.Group, o: Opening, y0: number, door: boolean) => {
    const g = new THREE.Group();
    const w = o.width;
    const h = o.y1 - o.y0;
    const F = door ? 0.08 : 0.09;
    const rim = door ? alu : frame;
    // Most of the real floors are lit at night, warm; here and there it's a screen's blue.
    const r = random();
    const glass = r < 0.08 ? lit[2] : r < 0.36 ? lit[0] : r < 0.68 ? lit[1] : dark;
    const mid = y0 + (o.y0 + o.y1) / 2;
    g.add(mesh(new THREE.PlaneGeometry(w - 2 * F, h - 2 * F), glass, 0, mid, -0.06, false));
    const s = mesh(new THREE.PlaneGeometry(0.16, h * 0.55), glint, -w * 0.18, mid + h * 0.05, -0.05, false);
    s.rotation.z = -0.5;
    g.add(s);
    g.add(mesh(new THREE.BoxGeometry(w, F, 0.14), rim, 0, y0 + o.y1 - F / 2, -0.05, false));
    g.add(mesh(new THREE.BoxGeometry(w, F, 0.14), rim, 0, y0 + o.y0 + F / 2, -0.05, false));
    for (const sx of [-1, 1]) g.add(mesh(new THREE.BoxGeometry(F, h, 0.14), rim, sx * (w / 2 - F / 2), mid, -0.05, false));
    g.add(mesh(new THREE.BoxGeometry(F * (door ? 1 : 0.8), h - 2 * F, 0.08), rim, 0, mid, -0.05, false));
    if (!door) g.add(mesh(new THREE.BoxGeometry(w + 0.2, 0.06, 0.16), frame, 0, y0 + o.y0 - 0.03, 0.06, false));
    parts.add(onFace(g, o.wall, o.u));
  };

  /** The balcony off a floor `y0` up: its slab (edged in `band`, planks on top, concrete under), and a railing with glass in it round the three open sides. */
  const balcony = (parts: THREE.Group, y0: number, band: THREE.Material) => {
    const { minX, maxX, minZ, maxZ } = BALCONY;
    const w = maxX - minX;
    const d = maxZ - minZ;
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    parts.add(mesh(new THREE.BoxGeometry(w, SLAB - 0.01, d), band, cx, y0 - SLAB / 2 - 0.005, cz, false));
    parts.add(mesh(new THREE.PlaneGeometry(w - 0.02, d - 0.02).rotateX(-Math.PI / 2), deck, cx, y0 - 0.008, cz, false));
    parts.add(mesh(new THREE.PlaneGeometry(w - 0.02, d - 0.02).rotateX(Math.PI / 2), concrete, cx, y0 - SLAB - 0.002, cz, false));
    const railH = 1.05;
    const inset = 0.06;
    const sides: [number, number, number, number][] = [
      [minX + inset, maxZ - inset, maxX - inset, maxZ - inset],
      [minX + inset, minZ, minX + inset, maxZ - inset],
      [maxX - inset, minZ, maxX - inset, maxZ - inset],
    ];
    for (const [x0, z0, x1, z1] of sides) {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const alongX = z0 === z1;
      const n = Math.ceil(len / 1.6);
      for (let i = 0; i <= n; i++) parts.add(mesh(new THREE.BoxGeometry(0.06, railH, 0.06), ink, x0 + ((x1 - x0) * i) / n, y0 + railH / 2, z0 + ((z1 - z0) * i) / n, false));
      parts.add(mesh(alongX ? new THREE.BoxGeometry(len + 0.1, 0.07, 0.12) : new THREE.BoxGeometry(0.12, 0.07, len + 0.1), wood, (x0 + x1) / 2, y0 + railH + 0.02, (z0 + z1) / 2, false));
      const pane = mesh(new THREE.PlaneGeometry(len - 0.1, railH - 0.2), railGlass, (x0 + x1) / 2, y0 + (railH - 0.2) / 2 + 0.08, (z0 + z1) / 2, false);
      pane.rotation.y = alongX ? 0 : Math.PI / 2;
      parts.add(pane);
    }
  };

  /** A slim parapet round the top of the building, `top` up: the roof's edge in night ink, just proud of the walls and meeting at the corners. */
  const crown = (parts: THREE.Group, top: number) => {
    const out = 0.06;
    for (const side of Object.keys(FACES) as Side[]) {
      const f = FACES[side];
      const g = new THREE.Group();
      g.add(mesh(new THREE.BoxGeometry(f.u1 - f.u0 + 2 * out, SLAB, out + OFF), edge, 0, top + SLAB / 2, (out - OFF) / 2, false));
      parts.add(onFace(g, side, (f.u0 + f.u1) / 2));
    }
  };

  // The rooftop bar, as it looks from down below (features/rooftop/world.ts has the real one).
  const curb = toon('#d8d3ca');
  const steel = toon('#b8c1cc');
  const steelDark = toon('#8d99ae');
  const beacon = bulb(night, '#ff5d5d', 0.6);
  const stage = toon('#2b2d42');
  const black = toon('#1d1d1d');
  const led = bulb(night, '#7b2ff7', 0.35);
  const truss = toon('#c9d1d9');
  const barWood = toon('#6b3f2a');
  const counter = toon('#f4f1ea');
  const shelf = toon('#4a2c1d');
  const pergola = toon('#8a5a3b');
  const parasol = toon('#ef476f');

  /**
   * The rooftop bar on the roof, `y` up, roughly: the deck, a curb round the edge with glass on it
   * and a steel rail along the top, the elevator's housing with the mast on it, the DJ's stage with
   * the LED wall behind it and the rig over it, the bar and its back bar under a pergola, and the
   * parasols along the south edge.
   */
  const roofTop = (parts: THREE.Group, y: number) => {
    const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y0: number, z: number) => parts.add(mesh(new THREE.BoxGeometry(w, h, d), mat, x, y0 + h / 2, z, false));
    parts.add(mesh(new THREE.PlaneGeometry(B.maxX - B.minX, B.maxZ - B.minZ).rotateX(-Math.PI / 2), curb, (B.minX + B.maxX) / 2, y + 0.002, (B.minZ + B.maxZ) / 2, false));
    const edges: [number, number, number, number][] = [
      [B.minX, B.maxX, B.minZ, FLOOR.minZ],
      [B.minX, B.maxX, FLOOR.maxZ, B.maxZ],
      [B.minX, FLOOR.minX, B.minZ, B.maxZ],
      [FLOOR.maxX, B.maxX, B.minZ, B.maxZ],
    ];
    for (const [x0, x1, z0, z1] of edges) {
      const ex = (x0 + x1) / 2;
      const ez = (z0 + z1) / 2;
      const alongX = x1 - x0 > z1 - z0;
      const len = alongX ? x1 - x0 : z1 - z0;
      box(x1 - x0, 0.45, z1 - z0, curb, ex, y, ez);
      const pane = mesh(new THREE.PlaneGeometry(len, 0.72), railGlass, ex, y + 0.81, ez, false);
      if (!alongX) pane.rotation.y = Math.PI / 2;
      parts.add(pane);
      box(alongX ? len : 0.07, 0.07, alongX ? 0.07 : len, steel, ex, y + 1.155, ez);
      for (let a = 0; a <= len + 0.01; a += 2.4) box(0.06, 0.75, 0.06, steel, alongX ? x0 + a : ex, y + 0.425, alongX ? ez : z0 + a);
    }

    // The elevator's housing, as tall as a floor, and on it the mast, with the light at its top.
    const hz = (B.minZ + ELEVATOR_FRONT) / 2;
    box(ELEVATOR.width, WALL_HEIGHT, ELEVATOR_FRONT - B.minZ, steel, ELEVATOR.x, y, hz);
    box(ELEVATOR.width + 0.3, 0.3, ELEVATOR_FRONT - B.minZ + 0.2, steelDark, ELEVATOR.x, y + WALL_HEIGHT, hz + 0.05);
    const foot = y + WALL_HEIGHT + 0.3;
    parts.add(mesh(new THREE.CylinderGeometry(0.06, 0.22, MAST, 8), steel, ELEVATOR.x, foot + MAST / 2, hz, false));
    for (const [at, r] of [[0.3, 0.55], [0.62, 0.42]]) parts.add(mesh(new THREE.CylinderGeometry(r, r, 0.14, 12), steelDark, ELEVATOR.x, foot + MAST * at, hz, false));
    parts.add(mesh(new THREE.SphereGeometry(0.32, 12, 9), beacon, ELEVATOR.x, foot + MAST + 0.2, hz, false));

    // The stage, the LED wall behind the DJ, and the rig: a truss tower either side and a beam across.
    const sw = STAGE.maxX - STAGE.minX;
    const scx = (STAGE.minX + STAGE.maxX) / 2;
    box(sw, STAGE.height, STAGE.maxZ - STAGE.minZ, stage, scx, y, (STAGE.minZ + STAGE.maxZ) / 2);
    box(8.3, 4.3, 0.25, black, scx, y + STAGE.height + 0.2, STAGE.minZ + 0.06);
    parts.add(mesh(new THREE.PlaneGeometry(8, 4), led, scx, y + STAGE.height + 2.35, STAGE.minZ + 0.2, false));
    const rigZ = STAGE.maxZ - 0.15;
    const rigTop = 5.6;
    for (const x of [STAGE.minX + 0.2, STAGE.maxX - 0.2]) box(0.34, rigTop - STAGE.height, 0.34, truss, x, y + STAGE.height, rigZ);
    box(sw - 0.4, 0.34, 0.34, truss, scx, y + rigTop - 0.34, rigZ);

    // The bar along the east side, the shelves of bottles behind it, and the pergola over both.
    const blen = ROOF_BAR.maxZ - ROOF_BAR.minZ;
    const bz = (ROOF_BAR.minZ + ROOF_BAR.maxZ) / 2;
    const front = ROOF_BAR.x - ROOF_BAR.depth / 2;
    box(ROOF_BAR.depth, ROOF_BAR.height - 0.06, blen, barWood, ROOF_BAR.x, y, bz);
    box(ROOF_BAR.depth + 0.2, 0.06, blen + 0.2, counter, ROOF_BAR.x - 0.05, y + ROOF_BAR.height - 0.06, bz);
    box(0.6, 2.4, blen - 0.6, shelf, FLOOR.maxX - 0.35, y, bz);
    const p0 = { x: front - 0.9, z: ROOF_BAR.minZ - 0.8 };
    const p1 = { x: FLOOR.maxX - 0.1, z: ROOF_BAR.maxZ + 0.8 };
    const roofY = 3.3;
    for (const x of [p0.x, p1.x]) {
      for (const z of [p0.z, p1.z]) box(0.16, roofY, 0.16, pergola, x, y, z);
      box(0.16, 0.22, p1.z - p0.z + 0.3, pergola, x, y + roofY - 0.11, (p0.z + p1.z) / 2);
    }
    for (let z = p0.z; z <= p1.z + 0.01; z += 0.55) box(p1.x - p0.x + 0.4, 0.08, 0.1, pergola, (p0.x + p1.x) / 2, y + roofY + 0.11, z);

    // Parasols along the south edge, over the sun loungers.
    for (const x of [-0.8, 2]) {
      const z = FLOOR.maxZ - 1.1;
      box(0.08, 2.6, 0.08, counter, x, y, z);
      parts.add(mesh(new THREE.ConeGeometry(1.5, 0.5, 12), parasol, x, y + 2.6, z, false));
    }
  };

  /**
   * One floor's back office, `y0` up, from outside: its three walls round the bay (windows in the
   * east one), the band of its slab, and a roof over the rows the floor above doesn't cover, or an
   * underside under the ones the floor below doesn't.
   */
  const bay = (parts: THREE.Group, y0: number, level: number, above: number, below: number, band: THREE.Material) => {
    const back = wingMinZ(level) - WALL_T;
    const west = WING.minX - WALL_T;
    const east = B.maxX;
    const plane = (w: number, h: number, mat: THREE.Material, x: number, y: number, z: number, rotY: number) => {
      if (w < 0.001 || h < 0.001) return;
      const m = mesh(new THREE.PlaneGeometry(w, h), mat, x, y, z, false);
      m.rotation.y = rotY;
      parts.add(m);
    };
    // Each wall: its band, then paint round its windows (along z on the side walls, x on the back).
    const wall = (u0: number, u1: number, holes: Opening[], at: (u: number) => [number, number], rotY: number) => {
      const [bx, bz] = at((u0 + u1) / 2);
      plane(Math.abs(u1 - u0), SLAB, band, bx, y0 - SLAB / 2, bz, rotY);
      let u = Math.min(u0, u1);
      const end = Math.max(u0, u1);
      const piece = (a: number, b: number, y1: number, y2: number) => {
        const [x, z] = at((a + b) / 2);
        plane(b - a, y2 - y1, paint, x, y0 + (y1 + y2) / 2, z, rotY);
      };
      for (const o of [...holes].sort((a, b) => a.u - b.u)) {
        piece(u, o.u - o.width / 2, 0, WALL_HEIGHT);
        piece(o.u - o.width / 2, o.u + o.width / 2, 0, o.y0);
        piece(o.u - o.width / 2, o.u + o.width / 2, o.y1, WALL_HEIGHT);
        u = o.u + o.width / 2;
      }
      piece(u, end, 0, WALL_HEIGHT);
    };
    const windows = wingWindows(level);
    wall(back, B.minZ, [], (z) => [west - OFF, z], -Math.PI / 2);
    wall(back, B.minZ, windows, (z) => [east + OFF, z], Math.PI / 2);
    wall(west, east, [], (x) => [x, back - OFF], Math.PI);
    for (const o of windows) glazing(parts, o, y0, false);
    // Over (and under) the rows of it that the floor above's (and below's) back office doesn't cover.
    const flat = (from: number, y: number, up: boolean) => {
      if (from >= level) return;
      const z0 = wingMinZ(level) - WALL_T;
      const z1 = from > 0 ? wingMinZ(from) - WALL_T : B.minZ;
      const g = new THREE.PlaneGeometry(east - west, z1 - z0).rotateX(up ? -Math.PI / 2 : Math.PI / 2);
      parts.add(mesh(g, concrete, (west + east) / 2, y, (z0 + z1) / 2, false));
    };
    flat(above, y0 + WALL_HEIGHT, true);
    flat(below, y0 - SLAB, false);
  };

  /**
   * Storey `k`'s outside as one of the base's, its floor `y0` up from the floor you're on: its walls
   * round its windows and doors, the glass in them, its balcony and its back office (if `wings` has one).
   */
  const floor = (parts: THREE.Group, k: number, y0: number, wings: readonly number[]) => {
    const band = bandOf(k);
    // The same windows light up whichever floor you're looking from.
    seed = 20260927 + k * 7919;
    for (const side of Object.keys(FACES) as Side[]) {
      const holes: Opening[] = WINDOWS.filter((o) => o.wall === side);
      if (side === 'south') holes.push(BALCONY_DOOR);
      // Only the bottom floor has a way out on the west side; its door stands in the hole (see world/office/shell.ts).
      if (side === 'west' && k === 0) holes.push(EXIT_DOOR);
      facade(parts, side, y0, holes, band);
    }
    for (const o of WINDOWS) glazing(parts, o, y0, false);
    glazing(parts, BALCONY_DOOR, y0, true);
    balcony(parts, y0, band);
    const wing = wings[k] ?? 0;
    if (wing > 0) bay(parts, y0, wing, wings[k + 1] ?? 0, k > 0 ? (wings[k - 1] ?? 0) : 0, band);
    if (k === 0) {
      // Dark behind the exit door, through its porthole.
      const back = mesh(new THREE.PlaneGeometry(EXIT_DOOR.width, EXIT_DOOR.y1), behind, FLOOR.minX - 0.02, y0 + EXIT_DOOR.y1 / 2, EXIT_DOOR.u, false);
      back.rotation.y = -Math.PI / 2;
      parts.add(back);
    }
  };

  const bars = buildTowerBars(night);
  const signs = buildTowerSigns(night);
  // The bars go by nothing but how many floors are real: drawn once for that many, from the bottom
  // floor's level, and only moved to where you are after that.
  let glass: { count: number; group: THREE.Group } | null = null;
  const barsOver = (count: number, total: number) => {
    if (glass?.count === count) return glass.group;
    glass?.group.removeFromParent();
    glass?.group.traverse((m) => (m as THREE.Mesh).isMesh && (m as THREE.Mesh).geometry.dispose());
    const parts = new THREE.Group();
    for (let k = count; k < total; k++) if (barOf(k)) bars.storey(parts, k, k * STOREY, count);
    glass = { count, group: mergeByMaterial(parts) };
    glass.group.traverse((o) => (o.receiveShadow = false));
    return glass.group;
  };

  const set = (index: number, count: number, wings: readonly number[] = []) => {
    for (const o of built) {
      o.removeFromParent();
      o.traverse((m) => {
        if ((m as THREE.Mesh).isMesh) (m as THREE.Mesh).geometry.dispose();
      });
    }
    built = [];
    for (const c of mine) {
      const i = colliders.indexOf(c);
      if (i >= 0) colliders.splice(i, 1);
    }
    mine = [];

    const total = Math.max(count, TOWER.storeys);
    const parts = new THREE.Group();
    // A real floor, or one drawn under the first bar, is the base's; over that, the bars'.
    for (let k = 0; k < total; k++) if (k !== index && (k < count || !barOf(k))) floor(parts, k, (k - index) * STOREY, k < count ? wings : []);
    const over = barsOver(count, total);
    over.position.y = -index * STOREY;
    group.add(over);
    // Each real floor's name on its wall (yours too), and the sign on the top bar.
    signs.draw(parts, index, count, total);
    // On top, a parapet, and the rooftop bar over it; but up on the roof, it's the roof's own.
    if (index < total) {
      const top = (total - 1 - index) * STOREY + WALL_HEIGHT;
      crown(parts, top);
      roofTop(parts, top + SLAB);
    }
    // Down in the garage (the elevator goes there), the bottom floor's slab over it, seen from
    // underneath: on that floor it's world/stack.ts's.
    if (index > 0 && index < count) {
      const under = new THREE.PlaneGeometry(B.maxX - B.minX, B.maxZ - B.minZ).rotateX(Math.PI / 2);
      parts.add(mesh(under, concrete, (B.minX + B.maxX) / 2, -index * STOREY - SLAB, (B.minZ + B.maxZ) / 2, false));
    }
    // The back offices stand on posts down to the street: each row's, from under the lowest floor it's built on.
    const street = STREET_Y - index * STOREY;
    const posts: Collider[] = [];
    for (let row = 1; row <= WING.rows; row++) {
      const lowest = wings.findIndex((w) => w >= row);
      if (lowest < 0 || lowest >= count) continue;
      const top = (lowest - index) * STOREY - SLAB;
      for (const p of wingPosts(row)) {
        parts.add(mesh(new THREE.CylinderGeometry(0.14, 0.14, top - street, 10), concrete, p.x, (top + street) / 2, p.z, false));
        posts.push({ minX: p.x - 0.16, maxX: p.x + 0.16, minZ: p.z - 0.16, maxZ: p.z + 0.16, bottom: street, top });
      }
    }

    // None of it casts a shadow (the sun lights the office through where its roof would be), and none
    // takes one from the floor you're on, which would fall on it as though nothing were in between.
    // What's a picture (the signs' letters) stays as it is: merging would lose where on it each corner is.
    parts.updateMatrixWorld(true);
    const pictures = new THREE.Group();
    const kept: THREE.Mesh[] = [];
    parts.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && (Array.isArray(m.material) || (m.material as THREE.MeshBasicMaterial).map)) kept.push(m);
    });
    for (const m of kept) pictures.attach(m);
    for (const g of [mergeByMaterial(parts), pictures]) {
      g.traverse((o) => (o.receiveShadow = false));
      group.add(g);
      built.push(g);
    }

    // Below you, the outside walls down to the garage, which you can't walk into from the steps
    // outside the bottom floor's door, and the bottom floor's slab, which is the garage's ceiling.
    if (index > 0 && index < count) {
      const bottom = -index * STOREY - SLAB;
      const T = WALL_T;
      mine.push(
        { minX: B.minX, maxX: B.maxX, minZ: B.minZ, maxZ: B.minZ + T, bottom, top: -SLAB },
        { minX: B.minX, maxX: B.maxX, minZ: B.maxZ - T, maxZ: B.maxZ, bottom, top: -SLAB },
        { minX: B.minX, maxX: B.minX + T, minZ: B.minZ, maxZ: B.maxZ, bottom, top: -SLAB },
        { minX: B.maxX - T, maxX: B.maxX, minZ: B.minZ, maxZ: B.maxZ, bottom, top: -SLAB },
        { ...B, bottom, top: bottom + SLAB },
      );
      colliders.push(...mine);
    }
    mine.push(...posts);
    colliders.push(...posts);
  };

  return { group, set };
}

/** The rest of the building, above and below this floor. */
export const tower: Fixture = (site) => {
  const built = buildTower(site.colliders, site.get('night'));
  return { group: built.group, setLevel: (index, count, wings) => built.set(index, count, wings) };
};
