import * as THREE from 'three';
import { kindDef, type FurnitureKind, type Piece } from '../../../shared/furniture';
import { mesh, toon } from '../toon';

// What the furniture's builders share (furniture.ts and the files beside it, one per part of the
// catalog): what a built piece is, and a few shapes most of them use.

export type ScreenMesh = THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;

/** What a piece is built as: its group, and the parts of it something else drives. */
export interface BuiltPiece {
  group: THREE.Group;
  /** A screen on it: a team desk's monitor (features/workstation), a video screen's face (features/screens). */
  screen?: ScreenMesh;
  /** The face on the other side of a screen that has two (a table screen), showing what the front does. */
  screenBack?: ScreenMesh;
  /** The faces of a stock ticker, which the market's prices slide along (features/studio). UV 0 to 1 across each. */
  ticker?: ScreenMesh[];
  /** The part of it that swings when it's hit (a punching bag), about its own origin (features/playthings). */
  swing?: THREE.Object3D;
  /** It's a door that opens by itself for anyone who comes up to it (an automatic door): how open it looks, 0 shut to 1 open. */
  door?: { show(open: number): void };
}

/**
 * Builds one kind of furniture at the origin, its front toward +z, standing on the floor: `color` is
 * the piece's paint (or its kind's), and `lift` a hair of height that keeps things lying flat on the
 * floor (rugs) from fighting where two overlap. A bare group will do when nothing else drives it.
 */
export type Builder = (p: Piece, color: string, lift: number) => BuiltPiece | THREE.Group;
export type Builders = Partial<Record<FurnitureKind, Builder>>;

export const LEG = '#8d99ae';
export const DARK_WOOD = '#8a5a3b';
export const BLACK = '#2b2d42';

/** Four legs under a top `w` by `d`, its underside `h` up. */
export function legs(g: THREE.Group, w: number, d: number, h: number, inset = 0.12, color: string = LEG, r = 0.035) {
  const mat = toon(color);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(mesh(new THREE.CylinderGeometry(r, r, h, 8), mat, sx * (w / 2 - inset), h / 2, sz * (d / 2 - inset)));
}

/** A flat face that shows a picture or a canvas: unlit, and left out of the toon outline. */
export function screenMesh(w: number, h: number, color = '#1b1d2e'): ScreenMesh {
  const mat = new THREE.MeshBasicMaterial({ color });
  mat.userData.outlineParameters = { visible: false };
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
}

/** A stand-in for a kind nothing builds yet: a box the size of its footprint, in its color. */
export function placeholder(p: Piece, color: string): THREE.Group {
  const k = kindDef(p.kind);
  const g = new THREE.Group();
  const h = k.top || 0.04;
  const geo = k.r !== undefined ? new THREE.CylinderGeometry(k.r, k.r, h, 24) : new THREE.BoxGeometry(k.w ?? 1, h, k.d ?? 1);
  g.add(mesh(geo, toon(color), 0, h / 2, 0));
  return g;
}
