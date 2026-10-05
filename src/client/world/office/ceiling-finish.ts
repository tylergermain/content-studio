import * as THREE from 'three';
import type { CeilingKind } from '../../../shared/floorplan';
import { FLOOR, WALL_HEIGHT } from '../../../shared/layout';
import { canvasTexture, tilingCanvasTexture } from '../texture';
import { mesh, toon } from '../toon';
import { box } from './materials';

// The ceiling itself, which goes with what hangs under it (see ceiling.ts): the stack's cream tiles on
// a floor that says nothing, warm timber boards between the beams, a bright white ceiling over the
// banners, or a studio's black deck over its lighting grid, with ducts and cable trays under it. The
// ceiling is the stack's one surface (and the back office's, which matches it), repainted: nothing's
// added up there, so the hatch, the poles' holes and the lamps' halos are where they always were.

/** How a ceiling is painted: its picture (uvs in meters), what glows of it, and how much. */
interface Finish {
  map: THREE.Texture | null;
  glow: THREE.Texture | null;
  emissive: THREE.Color;
}

/** A little pseudo-random sequence, the same every time, so the boards are always cut the same. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** `hex` made `k` lighter (k > 0) or darker (k < 0). */
function shade(hex: string, k: number): string {
  return `#${new THREE.Color(hex).offsetHSL(0, 0, k).getHexString()}`;
}

/**
 * Tongue-and-groove boards running east to west (across the beams, which run north to south), each
 * 0.2 m wide and cut to lengths of 1.2 to 2.4 m, their joints staggered: 4.8 m of the room by 2.4 m
 * to a repeat, at 200 pixels a meter. Honey-colored pine, lighter than the walnut beams and the floor.
 */
function boardsTexture(): THREE.CanvasTexture {
  const W = 960;
  const H = 480;
  const rows = 12;
  const row = H / rows;
  const rand = seeded(7);
  const tones = ['#ddb07f', '#d6a776', '#e3b988', '#d2a171', '#dbab7b'];
  const t = tilingCanvasTexture(W, H, (g) => {
    for (let r = 0; r < rows; r++) {
      const y = r * row;
      // Where this row's joints are, from a start somewhere along it, round to it again.
      let x = Math.floor(rand() * W);
      const start = x;
      do {
        const len = Math.min(240 + Math.floor(rand() * 240), start + W - x);
        const tone = shade(tones[Math.floor(rand() * tones.length)], (rand() - 0.5) * 0.04);
        const grain = [0, 1, 2].map(() => y + 6 + Math.floor(rand() * (row - 12)));
        // Drawn twice, the second a whole width back, so a board that runs off the end comes in at the start.
        for (const dx of [0, -W]) {
          g.fillStyle = tone;
          g.fillRect(x + dx, y, len, row);
          // The grain: a few faint streaks along the board.
          g.fillStyle = shade(tone, -0.05);
          for (const gy of grain) g.fillRect(x + dx, gy, len, 1);
          // The joint at its end.
          g.fillStyle = '#7a4f2e';
          g.fillRect(x + dx + len - 1, y, 2, row);
        }
        x += len;
      } while (x < start + W);
      // The groove between this board and the next: a dark line with a sliver of light under it.
      g.fillStyle = '#6e4529';
      g.fillRect(0, y, W, 2);
      g.fillStyle = shade(tones[2], 0.05);
      g.fillRect(0, y + 2, W, 1);
    }
  });
  t.repeat.set(1 / 4.8, 1 / 2.4);
  return t;
}

/**
 * Long white acoustic panels the length of the room, east to west, toward the stage: 0.6 m wide, with
 * a fine reveal between them and a deeper one every 2.4 m. Nothing across them, so the room reads long.
 */
function panelsTexture(): THREE.CanvasTexture {
  const H = 512;
  const t = tilingCanvasTexture(16, H, (g) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 16, H);
    for (let i = 0; i < 4; i++) {
      const y = (i * H) / 4;
      g.fillStyle = i === 0 ? '#c9d0d9' : '#e4e8ee';
      g.fillRect(0, y, 16, i === 0 ? 4 : 2);
    }
  });
  t.repeat.set(1, 1 / 2.4);
  return t;
}

/**
 * How brightly the white ceiling glows, from the north wall to the south: most down the middle, where
 * the banners hang, and less toward the walls, as a vault would catch the light. Once across the room.
 */
function vaultTexture(): THREE.CanvasTexture {
  const H = 128;
  const t = canvasTexture(1, H, (g) => {
    for (let y = 0; y < H; y++) {
      const k = Math.cos(((y + 0.5) / H - 0.5) * Math.PI);
      g.fillStyle = `#${new THREE.Color().setScalar(0.62 + 0.38 * k).getHexString()}`;
      g.fillRect(0, y, 1, 1);
    }
  });
  t.repeat.set(1, 1 / (FLOOR.maxZ - FLOOR.minZ));
  t.offset.set(0, -FLOOR.minZ / (FLOOR.maxZ - FLOOR.minZ));
  return t;
}

/** A studio's metal deck painted out black: its ribs running north to south, 0.3 m apart. */
function deckTexture(): THREE.CanvasTexture {
  const W = 256;
  const rib = W / 4;
  const t = tilingCanvasTexture(W, 16, (g) => {
    for (let i = 0; i < 4; i++) {
      const x = i * rib;
      g.fillStyle = '#1b1c1f';
      g.fillRect(x, 0, rib, 16);
      g.fillStyle = '#26282c';
      g.fillRect(x + 8, 0, rib / 2 - 8, 16);
      g.fillStyle = '#303237';
      g.fillRect(x + 8, 0, 3, 16);
      g.fillStyle = '#131416';
      g.fillRect(x + rib / 2 - 3, 0, 3, 16);
    }
  });
  t.repeat.set(1 / 1.2, 1);
  return t;
}

/**
 * Repaints the ceiling `mat` (the stack's, see Stack.ceiling) for each kind of ceiling: the tiles it
 * comes with, kept as they were, or one of the others, each painted the first time a floor asks for it.
 */
export function ceilingFinish(mat: THREE.MeshToonMaterial): (kind: CeilingKind) => void {
  const tiles: Finish = { map: mat.map, glow: mat.emissiveMap, emissive: mat.emissive.clone() };
  const made: Partial<Record<CeilingKind, Finish>> = { tiles };
  const make: Record<Exclude<CeilingKind, 'tiles'>, () => Finish> = {
    beams: () => {
      const map = boardsTexture();
      return { map, glow: map, emissive: new THREE.Color('#66605a') };
    },
    banners: () => ({ map: panelsTexture(), glow: vaultTexture(), emissive: new THREE.Color('#aeb2b8') }),
    grid: () => {
      const map = deckTexture();
      return { map, glow: map, emissive: new THREE.Color('#3a3a3a') };
    },
  };
  return (kind) => {
    const f = (made[kind] ??= kind === 'tiles' ? tiles : make[kind]());
    mat.map = f.map;
    mat.emissiveMap = f.glow;
    mat.emissive.copy(f.emissive);
  };
}

/**
 * The ducts: each across the room from the west wall to the east at `z`, `r` round, tight under the
 * deck and over the windows' heads, with a drop to a diffuser at each of `drops` (clear of the grid's
 * pipes and the trays). Clear of the fire pole and the elevator's shaft, and of the lamps' cords.
 */
const DUCTS = [
  { z: -9.6, r: 0.26, drops: [-15.5, -8.5, -3.5, 6.5, 11.5, 15.5] },
  { z: 2.9, r: 0.2, drops: [] },
] as const;
/** The trays: where each runs north to south, from the north wall to short of the deck's rail, how high, how wide, and where it hangs from (clear of the ducts). */
const TRAYS = { xs: [-13.5, 1.5], fromZ: FLOOR.minZ, toZ: 3.9, y: 6.0, w: 0.42, hung: [-11.8, -7.4, -3.8, -0.2, 3.5] } as const;

/**
 * A studio's services, under its black deck and over its lighting grid: two round ducts across the
 * room, and two ladder trays of cable from the north wall toward the deck, under the ducts.
 */
export function services(): THREE.Group {
  const parts = new THREE.Group();
  const duct = toon('#3a3d43');
  const band = toon('#4a4e55');
  const dark = toon('#1d1e21');
  const vent = toon('#8a9099');
  // (A hair short of the walls, which it goes into.)
  const len = FLOOR.maxX - FLOOR.minX - 0.02;
  const midX = (FLOOR.minX + FLOOR.maxX) / 2;
  const along = (geo: THREE.BufferGeometry) => geo.rotateZ(Math.PI / 2);
  for (const d of DUCTS) {
    const y = WALL_HEIGHT - 0.06 - d.r;
    parts.add(mesh(along(new THREE.CylinderGeometry(d.r, d.r, len, 18, 1, true)), duct, midX, y, d.z, false));
    // Its seams, a band every 1.2 m, and a strap up to the deck every 2.4.
    for (let x = FLOOR.minX + 0.6; x < FLOOR.maxX; x += 1.2) {
      parts.add(mesh(along(new THREE.CylinderGeometry(d.r + 0.014, d.r + 0.014, 0.06, 18, 1, true)), band, x, y, d.z, false));
      if (Math.round((x - FLOOR.minX - 0.6) / 1.2) % 2 === 0) parts.add(mesh(box(0.05, 0.08, 0.05), dark, x, WALL_HEIGHT - 0.04, d.z, false));
    }
    // A drop down to a round diffuser.
    for (const x of d.drops) {
      parts.add(mesh(new THREE.CylinderGeometry(d.r * 0.6, d.r * 0.6, 0.3, 14, 1, true), duct, x, y - d.r - 0.1, d.z, false));
      parts.add(mesh(new THREE.CylinderGeometry(0.32, 0.22, 0.08, 18), vent, x, y - d.r - 0.27, d.z, false));
    }
  }
  // The trays: two rails with rungs between them, a bundle of cable along them, on rods to the deck.
  const cable = [toon('#4b5058'), toon('#2c2f34')];
  const tlen = TRAYS.toZ - TRAYS.fromZ;
  const tmid = (TRAYS.fromZ + TRAYS.toZ) / 2;
  for (const x of TRAYS.xs) {
    for (const s of [-1, 1]) parts.add(mesh(box(0.04, 0.1, tlen), dark, x + (s * TRAYS.w) / 2, TRAYS.y, tmid, false));
    for (let z = TRAYS.fromZ + 0.3; z < TRAYS.toZ; z += 0.3) parts.add(mesh(box(TRAYS.w, 0.025, 0.04), dark, x, TRAYS.y - 0.04, z, false));
    cable.forEach((mat, i) => parts.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, tlen, 8).rotateX(Math.PI / 2), mat, x - 0.08 + i * 0.14, TRAYS.y - 0.02, tmid, false)));
    for (const z of TRAYS.hung) for (const s of [-1, 1]) parts.add(mesh(new THREE.CylinderGeometry(0.008, 0.008, WALL_HEIGHT - TRAYS.y, 4), dark, x + (s * TRAYS.w) / 2, (WALL_HEIGHT + TRAYS.y) / 2, z, false));
  }
  return parts;
}
