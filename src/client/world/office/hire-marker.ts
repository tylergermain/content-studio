import * as THREE from 'three';
import { glassMargin, glassTone, paintGlass } from '../glass';

// The "+" over a free seat, where a worker can be hired: a small disc of glass like the labels that
// float over people (world/glass.ts), with the interface's green plus on it. It starts out of sight;
// features/workers/hire-markers.ts fades it in near you, on the desk you look at, and everywhere in
// the office builder or with the Workers list open.

/** How wide the disc is, in meters (the old solid plus was 0.28 m across). */
export const MARKER_SIZE = 0.22;
/** The plus: the interface's green (--good in styles/base.css). */
const PLUS = '#34c759';
/** The glass: frosted white, with a breath of the plus's green. */
const GLASS = '#eefaf1';
/** Canvas pixels to one of the interface's, and the disc's width in them. */
const U = 2;
const DISC = 96;

let drawn: { tex: THREE.CanvasTexture; scale: number } | null = null;

/** The disc and its plus, drawn once for every marker to share; `scale` is the sprite's size, its shadow's margin and all. */
function plusTexture() {
  if (drawn) return drawn;
  const m = glassMargin(U);
  const w = DISC + 2 * m;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = w;
  const ctx = canvas.getContext('2d')!;
  const c = w / 2;
  const r = DISC / 2 - 2;
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  paintGlass(ctx, glassTone(GLASS), c - r, c + r, U);
  const arm = r * 0.42;
  ctx.beginPath();
  ctx.moveTo(c - arm, c);
  ctx.lineTo(c + arm, c);
  ctx.moveTo(c, c - arm);
  ctx.lineTo(c, c + arm);
  ctx.lineCap = 'round';
  ctx.lineWidth = r * 0.22;
  ctx.strokeStyle = PLUS;
  ctx.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  drawn = { tex, scale: (MARKER_SIZE * w) / DISC };
  return drawn;
}

/** Each vacancy group's "+", for features/workers/hire-markers.ts to find. */
const markers = new WeakMap<THREE.Object3D, THREE.Sprite>();

/** The floating "+" over an empty seat, `y` up: a group (what bobs) with the disc in it, out of sight until shown. */
export function vacancyMarker(y: number): THREE.Group {
  const vacancy = new THREE.Group();
  const { tex, scale } = plusTexture();
  const plus = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true, opacity: 0 }));
  plus.scale.set(scale, scale, 1);
  plus.renderOrder = 10;
  plus.visible = false;
  vacancy.add(plus);
  vacancy.position.set(0, y, 0);
  markers.set(vacancy, plus);
  return vacancy;
}

/** The "+" in a seat's `vacancy`: a desk's or a bean bag's, none at a kiosk or a meeting chair. */
export const markerIn = (vacancy: THREE.Object3D): THREE.Sprite | undefined => markers.get(vacancy);

/** Shows a "+" at `opacity`, from 0 (not drawn at all) to 1, and `grow` times its size. */
export function showMarker(plus: THREE.Sprite, opacity: number, grow = 1) {
  plus.material.opacity = opacity;
  plus.visible = opacity > 0;
  const size = plusTexture().scale * grow;
  plus.scale.set(size, size, 1);
}
