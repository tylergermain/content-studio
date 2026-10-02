import * as THREE from 'three';
import { DEFAULT_FURNITURE, kindDef, pieceAway, pieceCollider, pieceRadius, pieceScale, pieceSeat, pieceY, type FurnitureKind, type Piece } from '../../../shared/furniture';
import { PAINTING } from '../../../shared/hangings';
import type { Collider, Interactable } from '../types';
import type { Fixture } from './fixture';
import { buildPiece, disposePiece } from './furniture';
import type { ScreenMesh } from './furniture-kit';

// The furniture on the floor: the lounge, the rugs, the plants and whatever else the office builder
// put there (see shared/furniture.ts). It's built as the office comes, and then stands wherever the
// floor you're on has it (see features/office-builder), a piece at a time: what moved is moved, what's
// new is built, what's gone is taken away. A piece with `level: 1` stands upstairs, on the floor's loft
// or mezzanine (see pieceY): what you bump into of it starts at that floor, and what you sit on or use
// of it is up there.

/** A piece of furniture as it stands on the floor. */
export interface PieceView {
  piece: Piece;
  group: THREE.Group;
  /** What you bump into of it, while it's out. */
  collider?: Collider;
  /** The seat it is, to walk up to and sit on. */
  seat?: Interactable;
  /** What you use it by, when it's something to play with (see KindDef.play, and features/playthings). */
  play?: Interactable;
  /** What you watch it by, when it has a screen that plays the floor's videos (see KindDef.plays, and features/screens). */
  watch?: Interactable;
  /**
   * Its screen: a team desk's monitor (features/workstation), a video screen's face (features/screens),
   * a painting's picture (features/hanging). It's a new one whenever the piece is built again (see rebuilt).
   */
  screen?: ScreenMesh;
  /** A stock ticker's faces (features/studio), and the part of a punching bag that swings (features/playthings). */
  ticker?: ScreenMesh[];
  swing?: THREE.Object3D;
  /** Put away: in the way into the back office while that's built out. */
  away: boolean;
}

/** What a feature built that's furniture too (the whiteboard, the jukebox, the hoop): what the builder moves about of it. */
export interface Adopted {
  group: THREE.Group;
  /** What you bump into of it, and what you use it by: both the feature's own, moved with it. */
  collider?: Collider;
  use?: Interactable;
  /**
   * It's somewhere else now, or (with no piece) the floor doesn't have it: for whatever else goes by
   * where it is (where its sound comes from) or whether it's there at all (the ball that goes with the hoop).
   */
  moved?(p: Piece | undefined): void;
}

export interface FurnitureView {
  /** Stands the floor's furniture where `pieces` has it, on a floor built out `wing` rows. */
  set(pieces: readonly Piece[], wing: number): void;
  /**
   * Hands the furniture something a feature of the office built, to stand where the floor has it: the
   * piece of that kind (see KindDef.fixed). The feature keeps everything else about it.
   */
  adopt(kind: FurnitureKind, parts: Adopted): void;
  /** Everything of the furniture's that's in the room, for the builder to pick up by (each group's userData.piece is its id). */
  roots(): THREE.Group[];
  get(id: string): PieceView | undefined;
  all(): IterableIterator<PieceView>;
}

declare module '../types' {
  interface OfficeHandles {
    /** The furniture the office builder arranges (see shared/furniture.ts). */
    furniture: FurnitureView;
    /** The potted plants the office comes with, in their order. At Christmas world/holiday.ts hides their leaves (plantLeaves()) and stands a little tree in each pot. */
    plants: THREE.Group[];
  }
}

/** Nothing flat (a sign's letters, a screen) and nothing unlit gets the toon outline (see core/outline.ts, which did the rest of the office). */
function noOutline(obj: THREE.Object3D) {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const flat = m.geometry instanceof THREE.PlaneGeometry || m.geometry instanceof THREE.CircleGeometry;
    const mat = m.material as THREE.Material;
    if (flat || mat instanceof THREE.MeshBasicMaterial) mat.userData.outlineParameters = { visible: false };
  });
}

/** What a painting is built to: its frame, its size and shape, and how high it hangs (each its own, or what a painting has until it's set). */
const hung = (p: Piece) => (kindDef(p.kind).shows ? [p.frame ?? PAINTING.frame, p.size ?? PAINTING.size, p.aspect ?? PAINTING.aspect, p.lift ?? PAINTING.lift].join('|') : '');

/**
 * Whether a piece has to be built again to look like `next`: its paint or what it says changed, the
 * floor it's on (a neon sign upstairs hangs on no wires), or what a painting is built to. Not its
 * picture: whoever shows that swaps the image on the same canvas (see PieceView.screen).
 */
const rebuilt = (was: Piece, next: Piece) => was.kind !== next.kind || was.color !== next.color || was.text !== next.text || was.level !== next.level || hung(was) !== hung(next);

export const furniture: Fixture<'furniture' | 'plants'> = (site) => {
  const views = new Map<string, PieceView>();
  /** What the office's own features built (see adopt), by kind, and how the floor's arranged now. */
  const adopted = new Map<string, Adopted>();
  let now: { pieces: readonly Piece[]; wing: number } = { pieces: DEFAULT_FURNITURE, wing: 0 };

  /**
   * Stands something a feature built where `p` has it: it's put away, moved and turned, not built or
   * taken down. With no piece the floor doesn't have it: it's put away. What hangs on a wall (see
   * KindDef.pinned) is left where the feature built it.
   */
  function stand(a: Adopted, p: Piece | undefined, wing: number) {
    const away = !p || pieceAway(p, wing);
    a.group.visible = !away;
    if (p) a.group.userData.piece = p.id;
    if (p && !kindDef(p.kind).pinned) {
      a.group.position.set(p.x, a.group.position.y, p.z);
      a.group.rotation.y = p.rotY;
      const box = pieceCollider(p);
      if (box && a.collider) Object.assign(a.collider, box);
      if (a.use) {
        const front = kindDef(p.kind).use?.z ?? 1.2;
        a.use.x = p.x + Math.sin(p.rotY) * front;
        a.use.z = p.z + Math.cos(p.rotY) * front;
      }
    }
    if (a.collider) {
      // Put away, every copy of it goes: the feature's own fixture hands the office the same collider
      // once it's built (see buildOffice), after it was adopted here, so it can be in the list twice.
      if (away) for (let i = site.colliders.indexOf(a.collider); i >= 0; i = site.colliders.indexOf(a.collider)) site.colliders.splice(i, 1);
      else if (!site.colliders.includes(a.collider)) site.colliders.push(a.collider);
    }
    if (a.use) a.use.off = away;
    a.moved?.(away ? undefined : p);
  }

  function add(p: Piece, index: number): PieceView {
    const built = buildPiece(p, index);
    noOutline(built.group);
    // What the office builder picks it up by.
    built.group.userData.piece = p.id;
    site.group.add(built.group);
    const v: PieceView = { piece: { ...p }, group: built.group, screen: built.screen, ticker: built.ticker, swing: built.swing, away: false };
    views.set(p.id, v);
    return v;
  }

  function remove(v: PieceView) {
    v.group.removeFromParent();
    disposePiece(v.group);
    if (v.collider) drop(site.colliders, v.collider);
    if (v.seat) drop(site.interactables, v.seat);
    if (v.play) drop(site.interactables, v.play);
    if (v.watch) drop(site.interactables, v.watch);
    views.delete(v.piece.id);
  }

  function drop<T>(list: T[], item: T) {
    const i = list.indexOf(item);
    if (i >= 0) list.splice(i, 1);
  }

  /** Stands it where `p` has it: its group, what you bump into, and where you walk up to sit on it. */
  function place(v: PieceView, p: Piece, wing: number) {
    // A copy: whoever's list this is may change the piece itself next (the builder's draft does), and
    // what it was is how a new color or new words are noticed (see rebuilt).
    v.piece = { ...p };
    v.away = pieceAway(p, wing);
    v.group.position.set(p.x, pieceY(p), p.z);
    v.group.rotation.y = p.rotY;
    v.group.scale.setScalar(pieceScale(p));
    v.group.visible = !v.away;

    const box = v.away ? undefined : pieceCollider(p);
    if (box) {
      if (!v.collider) site.colliders.push((v.collider = { ...box }));
      else {
        Object.assign(v.collider, box);
        // Only a piece upstairs has a floor of its own to start at (see pieceCollider): on the office floor it keeps none.
        v.collider.bottom = box.bottom;
      }
    } else if (v.collider) {
      drop(site.colliders, v.collider);
      v.collider = undefined;
    }

    const seat = v.away ? undefined : pieceSeat(p);
    if (seat) {
      const k = kindDef(p.kind);
      const reach = k.r !== undefined ? pieceRadius(p) : Math.max(k.w ?? 0, k.d ?? 0) / 2;
      const at = { x: seat.x, y: seat.y, z: seat.z, radius: Math.max(1.4, reach + 0.4) };
      if (!v.seat) site.interactables.push((v.seat = { kind: 'seat', seatId: p.id, ...at }));
      else Object.assign(v.seat, at);
      v.group.userData.interact = v.seat;
    } else if (v.seat) {
      drop(site.interactables, v.seat);
      v.seat = undefined;
      delete v.group.userData.interact;
    }

    // Something to play with: walk up to its front.
    const k = kindDef(p.kind);
    if (k.play && k.use && !v.away) {
      const at = { x: p.x + Math.sin(p.rotY) * k.use.z, y: pieceY(p), z: p.z + Math.cos(p.rotY) * k.use.z, radius: k.use.radius };
      if (!v.play) site.interactables.push((v.play = { kind: 'plaything', pieceId: p.id, ...at }));
      else Object.assign(v.play, at);
      v.group.userData.interact = v.play;
    } else if (v.play) {
      drop(site.interactables, v.play);
      v.play = undefined;
      delete v.group.userData.interact;
    }

    // A screen that plays: walk up to its front, or look at it, to watch what's on it.
    if (k.plays && !v.away) {
      const use = k.use ?? { z: (k.d ?? 0) / 2 + 1, radius: 1.9 };
      const at = { x: p.x + Math.sin(p.rotY) * use.z, y: pieceY(p), z: p.z + Math.cos(p.rotY) * use.z, radius: use.radius };
      if (!v.watch) site.interactables.push((v.watch = { kind: 'screen', pieceId: p.id, ...at }));
      else Object.assign(v.watch, at);
      v.group.userData.interact = v.watch;
    } else if (v.watch) {
      drop(site.interactables, v.watch);
      v.watch = undefined;
      delete v.group.userData.interact;
    }
  }

  const view: FurnitureView = {
    set(pieces, wing) {
      now = { pieces, wing };
      const kept = new Set<string>();
      // What the office comes with: where this floor has each, or put away on a floor that doesn't have it.
      for (const [kind, a] of adopted) stand(a, pieces.find((p) => p.kind === kind), wing);
      pieces.forEach((p, i) => {
        if (kindDef(p.kind).fixed) return;
        kept.add(p.id);
        let v = views.get(p.id);
        if (v && rebuilt(v.piece, p)) {
          remove(v);
          v = undefined;
        }
        place(v ?? add(p, i), p, wing);
      });
      for (const v of [...views.values()]) if (!kept.has(v.piece.id)) remove(v);
    },
    adopt(kind, parts) {
      adopted.set(kind, parts);
      stand(parts, now.pieces.find((q) => q.kind === kind), now.wing);
    },
    roots: () => [...[...views.values()].map((v) => v.group), ...[...adopted.values()].map((a) => a.group)],
    get: (id) => views.get(id),
    all: () => views.values(),
  };

  view.set(DEFAULT_FURNITURE, 0);
  const plants = DEFAULT_FURNITURE.filter((p) => kindDef(p.kind).group === 'Plants').map((p) => views.get(p.id)!.group);
  return { handle: { furniture: view, plants } };
};
