import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLASS_FONT, GLASS_INK, GLASS_MUTED, glassInk, glassMargin, glassRing, glassTone, paintGlass } from './glass';

let gradient: THREE.DataTexture | null = null;

/** Three-step ramp that gives MeshToonMaterial its flat cartoon banding. */
function gradientMap(): THREE.DataTexture {
  if (gradient) return gradient;
  const data = new Uint8Array([90, 90, 90, 255, 185, 185, 185, 255, 255, 255, 255, 255]);
  gradient = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  gradient.minFilter = THREE.NearestFilter;
  gradient.magFilter = THREE.NearestFilter;
  gradient.needsUpdate = true;
  return gradient;
}

const cache = new Map<string, THREE.MeshToonMaterial>();

export function toon(color: THREE.ColorRepresentation, opts: { emissive?: THREE.ColorRepresentation; transparent?: boolean; opacity?: number } = {}): THREE.MeshToonMaterial {
  const key = `${new THREE.Color(color).getHexString()}|${opts.emissive ?? ''}|${opts.opacity ?? 1}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const m = new THREE.MeshToonMaterial({ color, gradientMap: gradientMap() });
  if (opts.emissive !== undefined) m.emissive = new THREE.Color(opts.emissive);
  if (opts.transparent || (opts.opacity ?? 1) < 1) {
    m.transparent = true;
    m.opacity = opts.opacity ?? 1;
  }
  // Shared by everything of its color: see ownSet.
  m.userData.shared = true;
  cache.set(key, m);
  return m;
}

/** The copies of the shared toon materials for each set of meshes drawn another way than the office's. */
const sets = new Map<string, WeakMap<THREE.Material, THREE.Material>>();

/**
 * One of the shared toon materials (see toon), as a set of meshes that's drawn another way than the office's
 * has it: a copy of its own. Three works a material's shader program out again every time it's drawn another
 * way than it last was (on a skinned mesh, then not; in the office's foggy scene, then the hands' own), which
 * is slow, so a skinned mesh (the dog's) and the hands each have their own. It looks the same. Anything that
 * isn't one of the shared ones is its own already.
 */
/**
 * Everything under `root` given its own copies of the shared materials it has (see ownSet): what's in your
 * hands (a mug, a paper, a dram) is built from the office's shared ones, and the hands' scene is lit its own
 * way with no fog, so before it's drawn its meshes get theirs. Quick for a small scene.
 */
export function ownSetIn(root: THREE.Object3D, set: 'skinned' | 'hands') {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (Array.isArray(m.material)) {
      if (m.material.some((x) => x.userData.shared)) m.material = m.material.map((x) => ownSet(x, set));
    } else if (m.material?.userData.shared) m.material = ownSet(m.material, set);
  });
}

export function ownSet<T extends THREE.Material>(m: T, set: 'skinned' | 'hands'): T {
  if (!m.userData.shared) return m;
  let copies = sets.get(set);
  if (!copies) sets.set(set, (copies = new WeakMap()));
  let copy = copies.get(m) as T | undefined;
  if (!copy) {
    copy = m.clone() as T;
    copy.userData = { ...m.userData, shared: false };
    copies.set(m, copy);
  }
  return copy;
}

/** A fresh (uncached) toon material, for things whose color animates. */
export function toonUnique(color: THREE.ColorRepresentation): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color, gradientMap: gradientMap() });
}

export function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, shadow = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}

export function roundedBox(w: number, h: number, d: number, r = 0.06): THREE.BufferGeometry {
  // Cheap rounded box: an extruded rounded rectangle, centered.
  const shape = new THREE.Shape();
  const x = -w / 2;
  const y = -d / 2;
  r = Math.min(r, w / 2, d / 2);
  shape.moveTo(x + r, y);
  shape.lineTo(x + w - r, y);
  shape.quadraticCurveTo(x + w, y, x + w, y + r);
  shape.lineTo(x + w, y + d - r);
  shape.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  shape.lineTo(x + r, y + d);
  shape.quadraticCurveTo(x, y + d, x, y + d - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 4 });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, -h / 2, 0);
  geo.computeVertexNormals();
  return geo;
}

type TextOpts = { color?: string; bg?: string; size?: number; border?: string };
const TEXT_SCALE = 0.0055;

/**
 * A text label drawn to a texture; `w`/`h` are the canvas size in pixels. A sign that's part of the
 * world (textPlane) is a painted pill with an ink outline; a label that floats over someone
 * (textSprite) is `glass`, like the interface: see world/glass.ts.
 */
function textTexture(text: string, opts: TextOpts, glass = false) {
  const size = opts.size ?? 48;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const font = glass ? `600 ${size}px ${GLASS_FONT}` : `800 ${size}px Nunito, ui-rounded, system-ui, sans-serif`;
  ctx.font = font;
  // One of the interface's pixels, at this label's size, and the room its shadow needs all round
  // (the same on every side, so the label stays centered where it was).
  const u = size / 34;
  const m = glass && opts.bg ? glassMargin(u) : 0;
  const w = Math.ceil(ctx.measureText(text).width) + size + 2 * m;
  const h = Math.ceil(size * 1.6) + 2 * m;
  canvas.width = w;
  canvas.height = h;
  ctx.font = font;
  const tone = glass && opts.bg ? glassTone(opts.bg) : null;
  if (tone) {
    ctx.beginPath();
    ctx.roundRect(m + 3, m + 3, w - 2 * m - 6, h - 2 * m - 6, size * 0.56);
    paintGlass(ctx, tone, m, h - m, u, glassRing(opts.border));
  } else if (opts.bg) {
    ctx.fillStyle = opts.bg;
    const r = h / 2;
    ctx.beginPath();
    ctx.roundRect(3, 3, w - 6, h - 6, r - 3);
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = opts.border ?? '#2b2d42';
    ctx.stroke();
  }
  ctx.fillStyle = glass ? glassInk(opts.color, tone) : (opts.color ?? '#2b2d42');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2 + size * (glass ? 0.02 : 0.05));
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { tex, w, h };
}

/** A camera-facing text label, on glass: a name tag, a bubble, a score. */
export function textSprite(text: string, opts: TextOpts = {}): THREE.Sprite {
  const { tex, w, h } = textTexture(text, opts, true);
  const mat = new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(w * TEXT_SCALE, h * TEXT_SCALE, 1);
  sprite.renderOrder = 10;
  return sprite;
}

/** A flat text sign facing +Z, for mounting on a wall (a sprite would swing into the wall). */
export function textPlane(text: string, opts: TextOpts = {}): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
  const { tex, w, h } = textTexture(text, opts);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.05 });
  return new THREE.Mesh(new THREE.PlaneGeometry(w * TEXT_SCALE, h * TEXT_SCALE), mat);
}

export interface CardOpts {
  /** A small pill across the top edge, e.g. "⌨️ WORKING". */
  chip?: { text: string; bg: string; color: string };
  title: string;
  body?: string;
  /** Its color: the card is glass tinted with it (see world/glass.ts). */
  bg: string;
  /** The outline's color, when it means something: a pull request's, a worker asking. */
  border?: string;
  /** Widest a line of text may get, in textSprite `size` pixels. */
  maxWidth?: number;
}

/** Cards are drawn at twice the pixels of other labels so their smaller text stays crisp up close. */
const CARD_RES = 2;

/**
 * A speech-bubble card of glass: status pill, bold title (up to 2 lines) and a smaller body (up to
 * 3), with a tail pointing down. Its position is the tip of the tail, so it sits right on top of
 * what it's about.
 */
export function cardSprite(o: CardOpts): THREE.Sprite {
  const R = CARD_RES;
  const maxW = (o.maxWidth ?? 400) * R;
  const pad = 16 * R;
  const lw = 5 * R;
  const tail = 12 * R;
  // The room the card's shadow needs, all round it.
  const m = glassMargin(R);
  const chipFont = `700 ${18 * R}px ${GLASS_FONT}`;
  const chipH = 30 * R;
  const titleFont = `700 ${29 * R}px ${GLASS_FONT}`;
  const titleLH = 36 * R;
  const bodyFont = `600 ${22 * R}px ${GLASS_FONT}`;
  const bodyLH = 29 * R;

  const ctx = document.createElement('canvas').getContext('2d')!;
  ctx.font = titleFont;
  const title = wrap(ctx, o.title, maxW, 2);
  const titleW = Math.max(...title.map((l) => ctx.measureText(l).width));
  ctx.font = bodyFont;
  const body = o.body ? wrap(ctx, o.body, maxW, 3) : [];
  const bodyW = body.length ? Math.max(...body.map((l) => ctx.measureText(l).width)) : 0;
  ctx.font = chipFont;
  const chipW = o.chip ? ctx.measureText(o.chip.text).width + 24 * R : 0;

  const w = Math.ceil(Math.max(titleW, bodyW, chipW + 2 * pad) + 2 * pad) + 2 * m;
  const top = m + (o.chip ? chipH / 2 : lw);
  const titleY = top + (o.chip ? chipH / 2 + 6 * R : pad);
  const bodyY = titleY + title.length * titleLH + 4 * R;
  const bottom = bodyY + body.length * bodyLH + pad * 0.7;
  const h = Math.ceil(bottom + tail + lw) + m;

  const canvas = ctx.canvas;
  canvas.width = w;
  canvas.height = h;
  // One outline for the card and its tail, so the hairline runs unbroken down the tail.
  const x0 = m + lw / 2;
  const x1 = w - m - lw / 2;
  const cx = w / 2;
  const r = 16 * R;
  ctx.beginPath();
  ctx.moveTo(x0 + r, top);
  ctx.arcTo(x1, top, x1, bottom, r);
  ctx.arcTo(x1, bottom, x0, bottom, r);
  ctx.lineTo(cx + tail, bottom);
  ctx.lineTo(cx, bottom + tail);
  ctx.lineTo(cx - tail, bottom);
  ctx.arcTo(x0, bottom, x0, top, r);
  ctx.arcTo(x0, top, x1, top, r);
  ctx.closePath();
  paintGlass(ctx, glassTone(o.bg), top, bottom, R, glassRing(o.border));

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (o.chip) {
    // The pill sits across the card's top edge: solid under its glass, so the edge doesn't show through it.
    const chip = glassTone(o.chip.bg);
    ctx.beginPath();
    ctx.roundRect(cx - chipW / 2, m + lw / 2, chipW, chipH, chipH / 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    paintGlass(ctx, chip, m + lw / 2, m + lw / 2 + chipH, R * 0.7);
    ctx.font = chipFont;
    ctx.fillStyle = glassInk(o.chip.color, chip);
    ctx.fillText(o.chip.text, cx, m + lw / 2 + chipH / 2 + R);
  }
  ctx.font = titleFont;
  ctx.fillStyle = GLASS_INK;
  title.forEach((l, i) => ctx.fillText(l, cx, titleY + (i + 0.5) * titleLH));
  ctx.font = bodyFont;
  ctx.fillStyle = GLASS_MUTED;
  body.forEach((l, i) => ctx.fillText(l, cx, bodyY + (i + 0.5) * bodyLH));

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
  sprite.scale.set((w / R) * TEXT_SCALE, (h / R) * TEXT_SCALE, 1);
  // The tip of the tail is where the sprite is, as it was before the card had a shadow's margin under it.
  sprite.center.set(0.5, m / h);
  sprite.renderOrder = 10;
  return sprite;
}

/** Greedy word wrap to at most `maxLines`, ending in "…" when the text doesn't fit. */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const fits = (s: string) => ctx.measureText(s).width <= maxW;
  const lines: string[] = [];
  let line = '';
  for (let word of text.split(/\s+/).filter(Boolean)) {
    // A word wider than a whole line gets cut where it has to be.
    while (!fits(word)) {
      let n = word.length - 1;
      while (n > 1 && !fits(word.slice(0, n))) n--;
      if (line) lines.push(line);
      lines.push(word.slice(0, n));
      line = '';
      word = word.slice(n);
    }
    const next = line ? `${line} ${word}` : word;
    if (fits(next)) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1];
  while (last && !fits(`${last}…`)) last = last.slice(0, -1).trimEnd();
  kept[maxLines - 1] = `${last.replace(/[\s,.;:—-]+$/, '')}…`;
  return kept;
}

export function disposeSprite(s: THREE.Sprite) {
  s.material.map?.dispose();
  s.material.dispose();
}

/**
 * Merges every (untextured) mesh under `root` into one per material, keeping which ones cast
 * shadows: a few draw calls instead of dozens, for things that never move on their own.
 */
export function mergeByMaterial(root: THREE.Object3D): THREE.Group {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const byKey = new Map<string, { mat: THREE.Material; cast: boolean; geos: THREE.BufferGeometry[] }>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const geo = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal') geo.deleteAttribute(k);
    geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    const mat = m.material as THREE.Material;
    const key = `${mat.uuid}${m.castShadow ? '+' : '-'}`;
    if (!byKey.has(key)) byKey.set(key, { mat, cast: m.castShadow, geos: [] });
    byKey.get(key)!.geos.push(geo);
  });
  const out = new THREE.Group();
  for (const { mat, cast, geos } of byKey.values()) {
    out.add(mesh(mergeGeometries(geos)!, mat, 0, 0, 0, cast));
    for (const geo of geos) geo.dispose();
  }
  return out;
}

let painted: THREE.MeshToonMaterial | null = null;

/**
 * Like mergeByMaterial, but every plain toon mesh under `root` (one color, no texture, no glow, not
 * see-through) goes into one mesh whatever its color, the colors kept in its vertices: one draw call
 * for a whole wood of trees in a dozen greens. Anything else is merged by its material as usual.
 */
export function mergeByColor(root: THREE.Object3D): THREE.Group {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const geos = { cast: [] as THREE.BufferGeometry[], still: [] as THREE.BufferGeometry[] };
  const other = new THREE.Group();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const rel = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
    const mat = m.material as THREE.Material;
    const plain = mat instanceof THREE.MeshToonMaterial && !mat.map && !mat.transparent && !mat.vertexColors && mat.emissive.getHex() === 0 && mat.side === THREE.FrontSide;
    if (!plain) {
      const copy = new THREE.Mesh(m.geometry, mat);
      copy.applyMatrix4(rel);
      copy.castShadow = m.castShadow;
      other.add(copy);
      return;
    }
    const geo = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal') geo.deleteAttribute(k);
    geo.applyMatrix4(rel);
    const n = geo.attributes.position.count;
    const c = mat.color;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i += 3) {
      col[i] = c.r;
      col[i + 1] = c.g;
      col[i + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    (m.castShadow ? geos.cast : geos.still).push(geo);
  });
  const out = other.children.length ? mergeByMaterial(other) : new THREE.Group();
  painted ??= new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: gradientMap() });
  for (const [list, cast] of [
    [geos.cast, true],
    [geos.still, false],
  ] as const) {
    if (!list.length) continue;
    out.add(mesh(mergeGeometries(list)!, painted, 0, 0, 0, cast));
    for (const geo of list) geo.dispose();
  }
  return out;
}
