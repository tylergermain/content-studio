import * as THREE from 'three';
import { FLOOR, STOREY, WALL_T } from '../../shared/layout';
import { BUILDING, FACADE, storeys } from './facade';
import type { NightParts } from './outside';
import { canvasTexture } from './texture';
import { mesh, toonUnique } from './toon';

// The building's signs (see TOWER and storeys in facade.ts): each real storey's name across its south
// wall in its own color, and the Friday Labs lockup on a panel of night ink near the top of the tower,
// the mark alone on its ends. Lit at night like the windows (night.windows), so nothing here needs a
// lamp or a halo. Its pictures are painted once and repainted only when a name or a color changes;
// what goes on the tower is redrawn with the rest of it (see tower.ts), which keeps them unmerged.

/** The building, walls included. */
const B = { minX: FLOOR.minX - WALL_T, maxX: FLOOR.maxX + WALL_T, minZ: FLOOR.minZ - WALL_T, maxZ: FLOOR.maxZ + WALL_T } as const;

/**
 * Where a storey's name goes on its south wall, `y0`..`y1` over its floor: the blank stretch east of
 * the balcony, under the loft's window, `off` out from the wall.
 */
const NAME = { minX: 4.3, maxX: 16.7, y0: 1.0, y1: 2.6, off: 0.02 } as const;

/**
 * The lockup's panel on the top bar's south and north faces, `w` by `h`, its top `below` under the
 * roof (from 100.3 to 108.3 m over the street, on 15 storeys); the mark alone, `mark` square, on the
 * east and west at the same height. Each stands `out` from the face, clear of the glass and its mullions.
 */
const LOCKUP = { w: 30, h: 8, below: 1.8, mark: 8, out: 0.4 } as const;

/** The lockup picture (BUILDING.lockup) is 1942 by 518 pixels, the mark the first 574 of them across. */
const PICTURE = { w: 1942, h: 518, mark: 574 } as const;

/** The mark's three bars, in the lockup picture's pixels: what's drawn when the picture won't load. */
const BARS: readonly (readonly [number, number])[][] = [
  [[96, 0], [497, 0], [573, 105], [573, 155], [170, 155], [96, 50]],
  [[0, 183], [402, 183], [478, 288], [478, 338], [74, 338], [0, 233]],
  [[211, 363], [428, 363], [502, 468], [502, 518], [285, 518], [211, 413]],
];

/** Lettering like the wordmark's: a heavy grotesk. */
const FONT = (px: number) => `800 ${px}px 'Helvetica Neue', Helvetica, Arial, system-ui, sans-serif`;

export interface TowerSigns {
  /**
   * Puts the signs into `parts`, a tower `total` storeys tall seen from storey `index` (an `index` of
   * `total` is the roof): every real storey's name (the first `count`, yours included, a plane just
   * off your own wall), and the lockup, while the two storeys behind it are drawn ones.
   */
  draw(parts: THREE.Group, index: number, count: number, total: number): void;
}

/** The lockup picture, loaded once for every tower that shows it; null if it won't load. */
let picture: Promise<HTMLImageElement | null> | null = null;
function lockupPicture(): Promise<HTMLImageElement | null> {
  picture ??= new Promise((done) => {
    const img = new Image();
    img.onload = () => done(img);
    img.onerror = () => done(null);
    img.src = BUILDING.lockup;
  });
  return picture;
}

/** The mark's bars in `g`, the mark's `h` pixels tall with its top left corner at `x`, `y`. */
function drawBars(g: CanvasRenderingContext2D, x: number, y: number, h: number) {
  const k = h / PICTURE.h;
  g.fillStyle = FACADE.accent;
  for (const bar of BARS) {
    g.beginPath();
    for (const [px, py] of bar) g.lineTo(x + px * k, y + py * k);
    g.closePath();
    g.fill();
  }
}

/** The lockup on night ink: the picture as large as fits inside a margin, else the bars and the name. */
function paintLockup(g: CanvasRenderingContext2D, img: HTMLImageElement | null) {
  const { width: w, height: h } = g.canvas;
  g.fillStyle = FACADE.ink;
  g.fillRect(0, 0, w, h);
  const pad = h * 0.13;
  const k = Math.min((w - 2 * pad) / PICTURE.w, (h - 2 * pad) / PICTURE.h);
  const pw = PICTURE.w * k;
  const ph = PICTURE.h * k;
  const x = (w - pw) / 2;
  const y = (h - ph) / 2;
  if (img) {
    g.drawImage(img, x, y, pw, ph);
    return;
  }
  drawBars(g, x, y, ph);
  g.fillStyle = FACADE.frame;
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  const left = x + PICTURE.mark * k * 1.18;
  g.font = FONT(Math.round(ph * 0.5));
  const room = x + pw - left;
  const squeeze = Math.min(1, room / g.measureText(BUILDING.name).width);
  g.save();
  g.translate(left, h / 2);
  g.scale(squeeze, 1);
  g.fillText(BUILDING.name, 0, 0);
  g.restore();
}

/** The mark alone on night ink: cut from the picture, else drawn. */
function paintMark(g: CanvasRenderingContext2D, img: HTMLImageElement | null) {
  const { width: w, height: h } = g.canvas;
  g.fillStyle = FACADE.ink;
  g.fillRect(0, 0, w, h);
  const pad = h * 0.16;
  const k = Math.min((w - 2 * pad) / PICTURE.mark, (h - 2 * pad) / PICTURE.h);
  const mw = PICTURE.mark * k;
  const mh = PICTURE.h * k;
  const x = (w - mw) / 2;
  const y = (h - mh) / 2;
  if (img) g.drawImage(img, 0, 0, PICTURE.mark, PICTURE.h, x, y, mw, mh);
  else drawBars(g, x, y, mh);
}

/** A storey's name in capitals in its color, on nothing: squeezed to fit, and smaller only if it's very long. */
function paintName(g: CanvasRenderingContext2D, name: string, color: string) {
  const { width: w, height: h } = g.canvas;
  g.clearRect(0, 0, w, h);
  const text = name.toUpperCase();
  const room = w - h * 0.3;
  let px = Math.round(h * 0.86);
  g.font = FONT(px);
  const wide = g.measureText(text).width;
  // Squeezed up to about two thirds; past that the letters get smaller instead.
  if (wide * 0.62 > room) {
    px = Math.floor((px * room) / (wide * 0.62));
    g.font = FONT(px);
  }
  const m = g.measureText(text);
  const squeeze = Math.min(1, room / m.width);
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.save();
  g.translate(w / 2, h / 2 + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2);
  g.scale(squeeze, 1);
  g.fillText(text, 0, 0);
  g.restore();
}

/** A picture on the outside that lights up at night with the windows, without the toon outline. */
function signMaterial(night: NightParts, map: THREE.Texture, cutout: boolean): THREE.MeshToonMaterial {
  const m = toonUnique('#ffffff');
  m.map = map;
  m.emissive.set('#ffffff');
  m.emissiveMap = map;
  m.emissiveIntensity = 0;
  if (cutout) m.alphaTest = 0.4;
  m.userData.outlineParameters = { visible: false };
  night.windows.push(m);
  return m;
}

/** Each side's face of the building: where on it a point `u` along and `y` up is, `out` from it, and which way it turns. */
const FACES = {
  south: { at: (u: number, out: number) => [u, B.maxZ + out] as const, rotY: 0 },
  north: { at: (u: number, out: number) => [-u, B.minZ - out] as const, rotY: Math.PI },
  east: { at: (u: number, out: number) => [B.maxX + out, -u] as const, rotY: Math.PI / 2 },
  west: { at: (u: number, out: number) => [B.minX - out, u] as const, rotY: -Math.PI / 2 },
};

export function buildTowerSigns(night: NightParts): TowerSigns {
  const rim = toonUnique(FACADE.ink);
  rim.userData.outlineParameters = { visible: false };

  // The lockup and the mark: night ink until the picture's in (or isn't).
  const lockup = canvasTexture(2048, 546, (g) => paintLockup(g, null));
  const mark = canvasTexture(512, 512, (g) => paintMark(g, null));
  const lockupMat = signMaterial(night, lockup, false);
  const markMat = signMaterial(night, mark, false);
  void lockupPicture().then((img) => {
    paintLockup((lockup.image as HTMLCanvasElement).getContext('2d')!, img);
    paintMark((mark.image as HTMLCanvasElement).getContext('2d')!, img);
    lockup.needsUpdate = true;
    mark.needsUpdate = true;
  });

  // A name for each real storey, made the first time there's one that high and kept.
  const names: { tex: THREE.CanvasTexture; mat: THREE.MeshToonMaterial; painted: string }[] = [];
  const nameFor = (k: number, name: string, accent: string) => {
    let slot = names[k];
    if (!slot) {
      const tex = canvasTexture(1024, 132);
      slot = names[k] = { tex, mat: signMaterial(night, tex, true), painted: '' };
    }
    const key = `${name}\n${accent}`;
    if (slot.painted !== key) {
      slot.painted = key;
      paintName((slot.tex.image as HTMLCanvasElement).getContext('2d')!, name, accent);
      slot.tex.needsUpdate = true;
    }
    return slot.mat;
  };

  /**
   * A panel on `side`, `w` by `h` with its middle `y` up: the picture `out` from the face, and night
   * ink round its edges back to the face, so from below or the side it's a slab and not a sheet.
   */
  const panel = (parts: THREE.Group, side: keyof typeof FACES, mat: THREE.Material, w: number, h: number, y: number, out: number) => {
    const g = new THREE.Group();
    g.add(mesh(new THREE.PlaneGeometry(w, h), mat, 0, 0, out, false));
    const edge = (geo: THREE.BufferGeometry, x: number, ey: number) => g.add(mesh(geo, rim, x, ey, out / 2, false));
    edge(new THREE.PlaneGeometry(w, out).rotateX(-Math.PI / 2), 0, h / 2);
    edge(new THREE.PlaneGeometry(w, out).rotateX(Math.PI / 2), 0, -h / 2);
    edge(new THREE.PlaneGeometry(out, h).rotateY(-Math.PI / 2), -w / 2, 0);
    edge(new THREE.PlaneGeometry(out, h).rotateY(Math.PI / 2), w / 2, 0);
    const [x, z] = FACES[side].at(0, 0);
    g.position.set(x, y, z);
    g.rotation.y = FACES[side].rotY;
    parts.add(g);
  };

  const draw = (parts: THREE.Group, index: number, count: number, total: number) => {
    // The floors' names, from the bottom up, each over its own floor.
    const looks = storeys();
    for (let k = 0; k < count; k++) {
      const look = looks[k];
      if (!look?.name.trim()) continue;
      const w = NAME.maxX - NAME.minX;
      const h = NAME.y1 - NAME.y0;
      const [x, z] = FACES.south.at((NAME.minX + NAME.maxX) / 2, NAME.off);
      parts.add(mesh(new THREE.PlaneGeometry(w, h), nameFor(k, look.name, look.accent), x, (k - index) * STOREY + (NAME.y0 + NAME.y1) / 2, z, false));
    }
    // The lockup goes on drawn glass, never over a real floor's windows and balcony.
    if (count > total - 2) return;
    const y = (total - index) * STOREY - LOCKUP.below - LOCKUP.h / 2;
    panel(parts, 'south', lockupMat, LOCKUP.w, LOCKUP.h, y, LOCKUP.out);
    panel(parts, 'north', lockupMat, LOCKUP.w, LOCKUP.h, y, LOCKUP.out);
    panel(parts, 'east', markMat, LOCKUP.mark, LOCKUP.mark, y, LOCKUP.out);
    panel(parts, 'west', markMat, LOCKUP.mark, LOCKUP.mark, y, LOCKUP.out);
  };

  return { draw };
}
