import * as THREE from 'three';
import { DEFAULT_FURNITURE, kindDef, pieceAway, pieceCollider, pieceRadius, pieceScale, pieceSeat, type FurnitureKind, type Piece } from '../../../shared/furniture';
import type { Collider, Interactable } from '../types';
import type { Fixture } from './fixture';
import { buildPiece, disposePiece } from './furniture';

// The furniture on the floor: the lounge, the rugs, the plants and whatever else the office builder
// put there (see shared/furniture.ts). It's built as the office comes, and then stands wherever the
// floor you're on has it (see features/office-builder), a piece at a time: what moved is moved, what's
// new is built, what's gone is taken away.

/** A piece of furniture as it stands on the floor. */
export interface PieceView {
  piece: Piece;
  group: THREE.Group;
  /** What you bump into of it, while it's out. */
  collider?: Collider;
  /** The seat it is, to walk up to and sit on. */
  seat?: Interactable;
  /** A team desk's monitor, which shows the screen of whoever sits there (features/workstation). */
  screen?: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  /** Put away: in the way into the back office while that's built out. */
  away: boolean;
}

/** What a feature built that's furniture too (the whiteboard, the jukebox): what the builder moves about of it. */
export interface Adopted {
  group: THREE.Group;
  /** What you bump into of it, and what you use it by: both the feature's own, moved with it. */
  collider: Collider;
  use: Interactable;
  /** It's somewhere else now, for whatever else goes by where it is (where its sound comes from). */
  moved?(p: Piece): void;
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

/** Whether a piece has to be built again to look like `next`: its paint or what it says changed. */
const rebuilt = (was: Piece, next: Piece) => was.kind !== next.kind || was.color !== next.color || was.text !== next.text;

export const furniture: Fixture<'furniture' | 'plants'> = (site) => {
  const views = new Map<string, PieceView>();
  /** What the office's own features built (see adopt), by kind, and how the floor's arranged now. */
  const adopted = new Map<string, Adopted>();
  let now: { pieces: readonly Piece[]; wing: number } = { pieces: DEFAULT_FURNITURE, wing: 0 };

  /** Stands something a feature built where `p` has it: it's put away, moved and turned, not built or taken down. */
  function stand(a: Adopted, p: Piece, wing: number) {
    const away = pieceAway(p, wing);
    a.group.userData.piece = p.id;
    a.group.position.set(p.x, a.group.position.y, p.z);
    a.group.rotation.y = p.rotY;
    a.group.visible = !away;
    const box = pieceCollider(p);
    if (box) Object.assign(a.collider, box);
    const i = site.colliders.indexOf(a.collider);
    if (away && i >= 0) site.colliders.splice(i, 1);
    else if (!away && i < 0) site.colliders.push(a.collider);
    const front = kindDef(p.kind).use?.z ?? 1.2;
    a.use.x = p.x + Math.sin(p.rotY) * front;
    a.use.z = p.z + Math.cos(p.rotY) * front;
    a.use.off = away;
    a.moved?.(p);
  }

  function add(p: Piece, index: number): PieceView {
    const built = buildPiece(p, index);
    noOutline(built.group);
    // What the office builder picks it up by.
    built.group.userData.piece = p.id;
    site.group.add(built.group);
    const v: PieceView = { piece: { ...p }, group: built.group, screen: built.screen, away: false };
    views.set(p.id, v);
    return v;
  }

  function remove(v: PieceView) {
    v.group.removeFromParent();
    disposePiece(v.piece.kind, v.group);
    if (v.collider) drop(site.colliders, v.collider);
    if (v.seat) drop(site.interactables, v.seat);
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
    v.group.position.set(p.x, 0, p.z);
    v.group.rotation.y = p.rotY;
    v.group.scale.setScalar(pieceScale(p));
    v.group.visible = !v.away;

    const box = v.away ? undefined : pieceCollider(p);
    if (box) {
      if (!v.collider) site.colliders.push((v.collider = { ...box }));
      else Object.assign(v.collider, box);
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
  }

  const view: FurnitureView = {
    set(pieces, wing) {
      now = { pieces, wing };
      const kept = new Set<string>();
      pieces.forEach((p, i) => {
        if (kindDef(p.kind).fixed) {
          const a = adopted.get(p.kind);
          if (a) stand(a, p, wing);
          return;
        }
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
      const p = now.pieces.find((q) => q.kind === kind);
      if (p) stand(parts, p, now.wing);
    },
    roots: () => [...[...views.values()].map((v) => v.group), ...[...adopted.values()].map((a) => a.group)],
    get: (id) => views.get(id),
    all: () => views.values(),
  };

  view.set(DEFAULT_FURNITURE, 0);
  const plants = DEFAULT_FURNITURE.filter((p) => kindDef(p.kind).group === 'Plants').map((p) => views.get(p.id)!.group);
  return { handle: { furniture: view, plants } };
};
