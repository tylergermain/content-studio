import * as THREE from 'three';
import { PUTT } from '../../../shared/mainstreet';
import { heightAt } from '../../../shared/minigolf/physics';
import { CUP, type Cone, type Felt, type Hole } from '../../../shared/minigolf/types';
import { mesh, toon } from '../toon';
import { sideGeometry, soup, stripGeometry, topGeometry } from './shapes';

// What a hole's ball rolls on: its patches of felt (level or sloped, with their sides down to the
// ground, and the edge a jump launches off painted), the volcano's cone and crater, the water, the
// cup, and the rubber mat it's teed up on. Into `parts`, which is merged afterwards (see hole.ts), so
// the felt's few colors are a few draw calls for the whole course.

const FELT = toon(PUTT.felt);
/** The felt's sides, and a patch that's up a slope or banked a shade darker, so a ramp reads as one. */
const FELT_SIDE = toon('#2c7a37');
const FELT_SLOPE = toon('#379442');
/** The painted edge a jump launches off, and the volcano's crater and its glowing rim. */
const LIP = toon('#ffd166');
/** The volcano's slopes are painted rock (still felt underneath, for the ball). */
const ROCK = toon('#8d5b3e');
const CRATER = toon('#5a3a2a');
const LAVA = toon('#ff7a45', { emissive: '#ff5a1f' });
const WATER = toon('#4cc9f0', { emissive: '#1a7fb5', opacity: 0.88 });
const WATER_BED = toon('#1d6f94');
const CUP_RIM = toon('#fffaf3');
const CUP_HOLE = toon('#141414');
const MAT = toon('#22313f');

const feltHeight = (f: Felt) => (x: number, z: number) => f.h + (f.slope ? f.slope.x * (x - f.poly[0].x) + f.slope.z * (z - f.poly[0].z) : 0);

/** The felt `hole`'s ball rolls on, the water and the cup, into `parts`. */
export function buildFelt(hole: Hole, parts: THREE.Group) {
  for (const f of hole.felt) {
    const height = feltHeight(f);
    const sloped = !!f.slope && (Math.abs(f.slope.x) > 1e-3 || Math.abs(f.slope.z) > 1e-3);
    parts.add(mesh(topGeometry(f.poly, height), sloped ? FELT_SLOPE : FELT, 0, 0, 0, false));
    parts.add(mesh(sideGeometry(f.poly, height), FELT_SIDE, 0, 0, 0, false));
    // A jump's launching edge, painted along the felt so it can be seen coming.
    for (const e of f.lips ?? []) {
      const a = f.poly[e % f.poly.length];
      const b = f.poly[(e + 1) % f.poly.length];
      parts.add(mesh(stripGeometry([a, b], (x, z) => height(x, z) + 0.012, 0.07, (x, z) => height(x, z) - 0.05), LIP, 0, 0, 0, false));
    }
  }
  for (const c of hole.cones ?? []) buildCone(hole, c, parts);
  for (const w of hole.water ?? []) {
    // Never under the grass of the hole's cell (see hole.ts), even where the office has it lower.
    const y = Math.max(w.h, 0.028);
    parts.add(mesh(topGeometry(w.poly, () => y - 0.008), WATER_BED, 0, 0, 0, false));
    parts.add(mesh(topGeometry(w.poly, () => y), WATER, 0, 0, 0, false));
  }
  // The cup: a black hole in a white rim, on the felt (or the crater's floor).
  const cy = heightAt(hole, hole.cup.x, hole.cup.z) ?? 0;
  parts.add(mesh(new THREE.CircleGeometry(CUP.r + 0.022, 24).rotateX(-Math.PI / 2), CUP_RIM, hole.cup.x, cy + 0.003, hole.cup.z, false));
  parts.add(mesh(new THREE.CircleGeometry(CUP.r, 24).rotateX(-Math.PI / 2), CUP_HOLE, hole.cup.x, cy + 0.005, hole.cup.z, false));
  // The rubber tee mat the ball's put down on, with a white spot for where.
  const ty = heightAt(hole, hole.tee.x, hole.tee.z) ?? 0;
  parts.add(mesh(new THREE.BoxGeometry(0.42, 0.012, 0.42), MAT, hole.tee.x, ty + 0.006, hole.tee.z, false));
  parts.add(mesh(new THREE.CircleGeometry(0.03, 12).rotateX(-Math.PI / 2), CUP_RIM, hole.tee.x, ty + 0.0135, hole.tee.z, false));
}

/** Rings out from the middle a cone is sampled at, as fractions of its radius. */
const RINGS = 16;
const ROUND = 40;

/**
 * The volcano: its slope sampled from the felt's own height (heightAt, cone and crater both), so it's
 * the very shape the ball rolls over, and its crater a darker hollow inside a ring of lava.
 */
function buildCone(hole: Hole, c: Cone, parts: THREE.Group) {
  const at = (d: number, a: number) => {
    const x = c.x + Math.cos(a) * d;
    const z = c.z + Math.sin(a) * d;
    return new THREE.Vector3(x, (heightAt(hole, x, z) ?? c.h) + 0.002, z);
  };
  /** A band of the cone from radius d0 out to d1. */
  const band = (d0: number, d1: number, rings: number, mat: THREE.Material) => {
    const out: number[] = [];
    for (let r = 0; r < rings; r++) {
      const r0 = d0 + ((d1 - d0) * r) / rings;
      const r1 = d0 + ((d1 - d0) * (r + 1)) / rings;
      for (let s = 0; s < ROUND; s++) {
        const a0 = (s / ROUND) * Math.PI * 2;
        const a1 = ((s + 1) / ROUND) * Math.PI * 2;
        const p = [at(r0, a0), at(r1, a0), at(r1, a1), at(r0, a1)];
        // Facing up (out of the cone): the right way round whichever way its slope goes.
        for (const [i, j, k] of [
          [0, 2, 1],
          [0, 3, 2],
        ])
          out.push(p[i].x, p[i].y, p[i].z, p[j].x, p[j].y, p[j].z, p[k].x, p[k].y, p[k].z);
      }
    }
    parts.add(mesh(soup(out), mat, 0, 0, 0, false));
  };
  const crater = c.crater && c.crater.r < c.r ? c.crater.r : 0;
  if (!crater) return band(0, c.r, RINGS, ROCK);
  band(crater + 0.01, c.r, RINGS - 4, ROCK);
  band(0, crater - 0.01, 4, CRATER);
  // The crater's rim, between the two: lava, glowing a little, and a few runs of it down the slope.
  band(crater - 0.01, crater + 0.01, 1, LAVA);
  for (let i = 0; i < 7; i++) {
    const a = i * 0.9 + 0.4;
    const len = c.r * (0.45 + 0.07 * (i % 4));
    const pts = Array.from({ length: 7 }, (_, k) => {
      const d = crater + 0.02 + ((len - crater) * k) / 6;
      // Each run wanders a little as it goes down.
      const w = a + Math.sin(k * 1.3 + i) * 0.05;
      return { x: c.x + Math.cos(w) * d, z: c.z + Math.sin(w) * d };
    });
    const surface = (x: number, z: number) => heightAt(hole, x, z) ?? c.h;
    parts.add(mesh(stripGeometry(pts, (x, z) => surface(x, z) + 0.008, 0.06 - i * 0.004, (x, z) => surface(x, z) - 0.02), LAVA, 0, 0, 0, false));
  }
}
