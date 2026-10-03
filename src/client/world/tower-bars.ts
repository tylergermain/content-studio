import * as THREE from 'three';
import { FLOOR, SLAB, STOREY, WALL_HEIGHT, WALL_T, type Side } from '../../shared/layout';
import { mulberry32 } from '../../shared/rng';
import { FACADE, TOWER } from './facade';
import { bulb, type NightParts } from './outside';
import { mesh, toonUnique } from './toon';

// The tower over the real floors: three bars of glass stacked and shifted like the Friday Labs mark
// (TOWER in facade.ts). A storey of a bar is a dark spandrel and a band of glass, twice over, with a
// mullion every couple of meters and about a third of its bays lit at night, so the twelve storeys
// read as twenty-four. Where a bar sits on something wider there's a roof over what sticks out, and
// where it overhangs, a soffit under it. At each bar's foot the glass stops short of the floor: a
// seam set back into the bar, painted night ink, with a line of green light all the way round.
// Planes and thin boxes only, no colliders: nobody goes up there.

/** The building, walls included. */
const B = { minX: FLOOR.minX - WALL_T, maxX: FLOOR.maxX + WALL_T, minZ: FLOOR.minZ - WALL_T, maxZ: FLOOR.maxZ + WALL_T } as const;
/** Planes stand this far off the walls, as the tower's do (tower.ts). */
const OFF = 0.01;
/** How far the glass sits behind the spandrels and mullions, and how wide a mullion is. */
const DEPTH = 0.12;
const MULLION = 0.09;

/** How far along x a storey goes: all three bars and the building are as deep as each other. */
export interface Span {
  minX: number;
  maxX: number;
}

/** The bar storey `k` is part of, if any. */
export const barOf = (k: number) => TOWER.bars.find((b) => k >= b.from && k < b.to);

/** Storey `k`'s span, of `count` real floors: a real one, or one drawn under the first bar, is the building's; a drawn one is its bar's. */
export function spanOf(k: number, count: number): Span {
  const bar = k >= count ? barOf(k) : undefined;
  return bar ? { minX: bar.minX, maxX: bar.maxX } : { minX: B.minX, maxX: B.maxX };
}

/** One face of a span, `inset` into it: where along it things are (u, corner to corner), and its plane. */
function faceOf(side: Side, s: Span, inset = 0) {
  const ns = side === 'north' || side === 'south';
  const u0 = (ns ? s.minX : B.minZ) - OFF + inset;
  const u1 = (ns ? s.maxX : B.maxZ) + OFF - inset;
  const at = (u: number, y: number, back = 0): THREE.Vector3 => {
    const d = OFF - inset - back;
    if (side === 'south') return new THREE.Vector3(u, y, B.maxZ + d);
    if (side === 'north') return new THREE.Vector3(u, y, B.minZ - d);
    if (side === 'east') return new THREE.Vector3(s.maxX + d, y, u);
    return new THREE.Vector3(s.minX - d, y, u);
  };
  const rotY = { south: 0, north: Math.PI, east: Math.PI / 2, west: -Math.PI / 2 }[side];
  return { u0, u1, at, rotY };
}

const SIDES: Side[] = ['south', 'east', 'north', 'west'];

/**
 * The sky lights everything over the office floor's plan, a few storeys up, as though it were indoors,
 * and clears the air in it (skyInOffice in world/sky.ts, skyIndoors in haze.ts): a bar set in over
 * the plan is outdoors whatever it stands over, so its materials leave those two out.
 */
function outdoors<M extends THREE.Material>(m: M): M {
  m.onBeforeCompile = (shader, renderer) => {
    THREE.Material.prototype.onBeforeCompile.call(m, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace('skyInOffice( vSkyWorld )', '0.0').replace('skyIndoors( vSkyFogAt )', 'false');
  };
  return m;
}

/**
 * Which of `n` bays in a row are lit at night, and in which of FACADE.lit (-1 for none): runs of two
 * to six, as a whole office is, with gaps between, so about a third in all.
 */
function litRuns(n: number, random: () => number): number[] {
  const out = new Array<number>(n).fill(-1);
  for (let i = Math.floor(random() * 6); i < n; ) {
    const len = 2 + Math.floor(random() * 5);
    const pick = random();
    const glow = pick < 0.4 ? 0 : pick < 0.75 ? 1 : 2;
    for (let j = i; j < Math.min(n, i + len); j++) out[j] = glow;
    i += len + 4 + Math.floor(random() * 9);
  }
  return out;
}

export interface TowerBars {
  /** Storey `k` of the tower, a drawn one (over the `count` real floors), with its floor at `y0`. */
  storey(parts: THREE.Group, k: number, y0: number, count: number): void;
}

export function buildTowerBars(night: NightParts): TowerBars {
  const flat = (color: THREE.ColorRepresentation) => {
    const m = outdoors(toonUnique(color));
    m.userData.outlineParameters = { visible: false };
    return m;
  };
  const spandrel = flat(FACADE.skin);
  const mullion = flat(FACADE.concrete);
  const ink = flat(FACADE.ink);
  const roof = flat(FACADE.concrete);
  const soffit = flat(FACADE.skin);
  // Glass you can't see into, deeper and bluer than the real floors' (toward night ink), in three
  // shades: the sky catches it in broad slanting stripes. At night a bay in a run of them glows, as
  // though a whole office up there is still at it.
  const tones = [0.14, 0.32, 0.48].map((t) => new THREE.Color(FACADE.glass).lerp(new THREE.Color(FACADE.ink), t).offsetHSL(0, 0.12, 0));
  const dark = tones.map((c) => flat(c));
  const lit = tones.map((c) =>
    FACADE.lit.map((glow) => {
      const m = flat(c);
      m.emissive.set(glow);
      m.emissiveIntensity = 0;
      night.windows.push(m);
      return m;
    }),
  );
  const line = outdoors(bulb(night, FACADE.accent, 0.55));
  line.userData.outlineParameters = { visible: false };
  // At night the seams fill with the line's light.
  const haze = outdoors(new THREE.MeshBasicMaterial({ color: FACADE.accent, transparent: true, opacity: 0, depthWrite: false }));
  night.glows.push({ mat: haze, max: 0.5 });
  /** Which shade of glass a bay is, `u` along its face and `h` up the tower: stripes slanting up the bar. */
  const shade = (side: Side, u: number, h: number) => {
    const s = (((u + h * 0.8 + SIDES.indexOf(side) * 7) / 23) % 1 + 1) % 1;
    return s < 0.11 ? 0 : s < 0.19 ? 1 : 2;
  };

  /** A box along a face (`w` along it, `h` up, `d` deep), its front `back` behind the face. */
  const slab = (parts: THREE.Group, f: ReturnType<typeof faceOf>, u: number, y: number, w: number, h: number, d: number, mat: THREE.Material, back = 0) => {
    if (w < 0.001 || h < 0.001) return;
    const m = mesh(new THREE.BoxGeometry(w, h, d), mat, 0, 0, 0, false);
    m.position.copy(f.at(u, y, back + d / 2));
    m.rotation.y = f.rotY;
    parts.add(m);
  };
  const pane = (parts: THREE.Group, f: ReturnType<typeof faceOf>, u: number, y: number, w: number, h: number, mat: THREE.Material, back = 0) => {
    if (w < 0.001 || h < 0.001) return;
    const m = mesh(new THREE.PlaneGeometry(w, h), mat, 0, 0, 0, false);
    m.position.copy(f.at(u, y, back));
    m.rotation.y = f.rotY;
    parts.add(m);
  };
  /** Flat over x `x0`..`x1` and z `z0`..`z1` (front to back of the building unless said), at `y`, facing up or down. */
  const level = (parts: THREE.Group, x0: number, x1: number, y: number, up: boolean, mat: THREE.Material, z0: number = B.minZ - OFF, z1: number = B.maxZ + OFF) => {
    if (x1 - x0 < 0.001 || z1 - z0 < 0.001) return;
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(up ? -Math.PI / 2 : Math.PI / 2);
    parts.add(mesh(g, mat, (x0 + x1) / 2, y, (z0 + z1) / 2, false));
  };
  /** A ring `w` wide round the inside of span `s`'s outline, at `y`. */
  const ring = (parts: THREE.Group, s: Span, w: number, y: number, up: boolean, mat: THREE.Material) => {
    const x0 = s.minX - OFF;
    const x1 = s.maxX + OFF;
    const z0 = B.minZ - OFF;
    const z1 = B.maxZ + OFF;
    level(parts, x0, x1, y, up, mat, z0, z0 + w);
    level(parts, x0, x1, y, up, mat, z1 - w, z1);
    level(parts, x0, x0 + w, y, up, mat, z0 + w, z1 - w);
    level(parts, x1 - w, x1, y, up, mat, z0 + w, z1 - w);
  };

  return {
    storey(parts, k, y0, count) {
      const s = spanOf(k, count);
      const under = spanOf(k - 1, count);
      const bar = barOf(k);
      const seam = bar?.from === k;
      const random = mulberry32(20261002 + k * 7919);
      const foot = y0 - SLAB;
      // Where it sits on something wider, a roof over what sticks out, edged with a low parapet;
      // where it overhangs, a soffit.
      for (const [x0, x1] of [[under.minX, Math.min(under.maxX, s.minX)], [Math.max(under.minX, s.maxX), under.maxX]]) {
        if (x1 - x0 < 0.01) continue;
        level(parts, x0 - OFF, x1 + OFF, foot, true, roof);
        for (const side of ['south', 'north'] as const) slab(parts, faceOf(side, under), (x0 + x1) / 2, foot + SLAB / 2, x1 - x0 + 2 * OFF, SLAB, SLAB, spandrel);
        const end = faceOf(x0 === under.minX ? 'west' : 'east', under);
        slab(parts, end, (end.u0 + end.u1) / 2, foot + SLAB / 2, end.u1 - end.u0, SLAB, SLAB, spandrel);
      }
      level(parts, s.minX - OFF, Math.min(s.maxX, under.minX), foot, false, soffit);
      level(parts, Math.max(s.minX, under.maxX), s.maxX + OFF, foot, false, soffit);
      // The two bands of glass over their spandrels; at a bar's foot the first starts over the seam.
      const { below, height, inset } = TOWER.seam;
      const sill = y0 - below;
      const lowest = seam ? sill + height : foot;
      const rows: [number, number, number][] = [
        [lowest, y0, y0 + TOWER.glass],
        [y0 + TOWER.glass, y0 + TOWER.glass + TOWER.spandrel, y0 + WALL_HEIGHT],
      ];
      for (const side of SIDES) {
        const f = faceOf(side, s);
        const len = f.u1 - f.u0;
        const mid = (f.u0 + f.u1) / 2;
        const n = Math.max(1, Math.round(len / TOWER.mullion));
        const bay = len / n;
        for (const [a, glass, top] of rows) {
          if (glass > a) slab(parts, f, mid, (a + glass) / 2, len, glass - a, DEPTH, spandrel);
          const g0 = Math.max(a, glass);
          const lights = litRuns(n, random);
          for (let i = 0; i < n; i++) {
            const tone = shade(side, (i + 0.5) * bay, k * STOREY + g0 - y0);
            const mat = lights[i] < 0 ? dark[tone] : lit[tone][lights[i]];
            pane(parts, f, f.u0 + (i + 0.5) * bay, (g0 + top) / 2, bay, top - g0, mat, DEPTH);
          }
        }
        for (let i = 0; i <= n; i++) {
          const u = Math.min(f.u1 - MULLION / 2, Math.max(f.u0 + MULLION / 2, f.u0 + i * bay));
          slab(parts, f, u, (lowest + y0 + WALL_HEIGHT) / 2, MULLION, y0 + WALL_HEIGHT - lowest, DEPTH, mullion);
        }
        if (!seam) continue;
        // The seam: night ink set back into the bar, a line of green light along it, and its lid.
        const inner = faceOf(side, s, inset);
        const ilen = inner.u1 - inner.u0;
        pane(parts, inner, (inner.u0 + inner.u1) / 2, sill + height / 2, ilen, height, ink);
        // High in the seam, where the storey under it doesn't hide it from the street.
        slab(parts, inner, (inner.u0 + inner.u1) / 2, sill + height * 0.7, ilen + 0.1, 0.2, 0.1, line, -0.1);
        pane(parts, inner, (inner.u0 + inner.u1) / 2, sill + height / 2, ilen, height - 0.04, haze, -0.25);
      }
      if (seam) {
        ring(parts, s, inset, sill + height, false, ink);
        ring(parts, s, inset, sill + 0.002, true, roof);
      }
    },
  };
}
