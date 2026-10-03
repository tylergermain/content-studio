/**
 * What the things to play with share: what one is to the feature (its hint, what E does, what it does
 * each frame), where a piece is as its own frame sees you, and what each keeps between frames.
 */
import type * as THREE from 'three';
import type { Frame } from '../../core/registry';
import type { Pos } from '../../sound/places';
import type { PieceView } from '../../world/office/furnish';

/** One kind of thing to play with, as index.ts drives it. */
export interface Toy {
  /** What the hint bar says once you're at one, after its name: `k` changes whenever that does. */
  hint?(v: PieceView): { k: string; parts: (HTMLElement | string)[] };
  /** E at one. */
  use?(v: PieceView): void;
  /** Each frame, with every piece of its kind that's out on the floor (none, on a floor without any). */
  tick?(views: readonly PieceView[], f: Frame): void;
}

/** Where (x, z) on the floor is in a piece's own frame: +z out of its front, +x to your right as you face it. */
export function localOf(v: PieceView, x: number, z: number): { x: number; z: number } {
  const dx = x - v.piece.x;
  const dz = z - v.piece.z;
  const sin = Math.sin(v.piece.rotY);
  const cos = Math.cos(v.piece.rotY);
  return { x: dx * cos - dz * sin, z: dx * sin + dz * cos };
}

/** Where a point in a piece's own frame is in the room, `y` up: for where its sounds come from. */
export function roomOf(v: PieceView, x: number, y: number, z: number): Pos {
  const sin = Math.sin(v.piece.rotY);
  const cos = Math.cos(v.piece.rotY);
  return { x: v.piece.x + x * cos + z * sin, y, z: v.piece.z - x * sin + z * cos };
}

/**
 * What each piece keeps between frames, by the group it's built as: a piece that's painted or taken
 * away is built again (see world/office/furnish.ts), and starts over with it.
 */
export function keep<S>(make: (v: PieceView) => S): (v: PieceView) => S {
  const kept = new WeakMap<THREE.Group, S>();
  return (v) => {
    let s = kept.get(v.group);
    if (!s) kept.set(v.group, (s = make(v)));
    return s;
  };
}

/** What you've done best at each, kept in this browser. */
const BESTS_KEY = 'agent-office.playthings';

export function readBests(): Record<string, number> {
  try {
    const r = JSON.parse(localStorage.getItem(BESTS_KEY) ?? '{}') as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(r)) if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    return out;
  } catch {
    return {};
  }
}

export function saveBests(bests: Record<string, number>) {
  try {
    localStorage.setItem(BESTS_KEY, JSON.stringify(bests));
  } catch {
    // private window: it's only for this visit then
  }
}
