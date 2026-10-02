/**
 * The layout being worked on in the builder: the floor's desks, furniture and paint as you've changed
 * them so far, what each change can be undone to, and the changes themselves. A change that leaves
 * something where it can't stand is put back, with why (see shared/office-builder.ts).
 */
import { DEFAULT_FURNITURE, isRound, kindDef, newPieceId, pieceBox, pieceRadius, type Box, type FurnitureKind, type Piece } from '../../../shared/furniture';
import { ORIGINAL_DESKS, SNAP, deskRect, layoutProblems, problemAt, type DeskLayout, type DeskPose } from '../../../shared/office-builder';
import type { RoomOptions } from '../../../shared/floorplan';
import type { Arrangement } from './sync';

export interface Draft {
  desks: DeskLayout;
  furniture: Piece[];
  look?: number;
  room?: RoomOptions;
}

export const snap = (n: number, step: number) => Math.round(n / step) * step;
/** A layout of the draft's own, to change without changing the one it came from. */
export const draftOf = (a: Arrangement): Draft => JSON.parse(JSON.stringify({ desks: a.desks, furniture: a.furniture, look: a.look, room: a.room })) as Draft;

const TAU = Math.PI * 2;

export class DraftLayout {
  now: Draft;
  private readonly undone: string[] = [];
  private readonly redone: string[] = [];

  constructor(
    from: Arrangement,
    private readonly deskIds: readonly string[],
  ) {
    this.now = draftOf(from);
  }

  /** The draft as text: to compare it by, and to come back to (see restore). */
  key(): string {
    return JSON.stringify(this.now);
  }

  restore(key: string) {
    this.now = JSON.parse(key) as Draft;
  }

  /** Starts over from `from`, with nothing to undo. */
  load(from: Arrangement) {
    this.now = draftOf(from);
    this.undone.length = this.redone.length = 0;
  }

  isDesk(id: string): boolean {
    return this.deskIds.includes(id);
  }

  piece(id: string): Piece | undefined {
    return this.now.furniture.find((p) => p.id === id);
  }

  /** Where the desk or the piece `id` stands, or undefined if there's no such thing. */
  pose(id: string): DeskPose | undefined {
    return this.isDesk(id) ? (this.now.desks[id] ?? ORIGINAL_DESKS.find((d) => d.id === id)) : this.piece(id);
  }

  setPose(id: string, x: number, z: number, rotY: number) {
    if (this.isDesk(id)) this.now.desks[id] = { x, z, rotY };
    else Object.assign(this.piece(id) ?? {}, { x, z, rotY });
  }

  /** The floor a desk (with its chair) or a piece takes up, and how far round it reaches if it's round. */
  footprint(id: string | null): { box: Box; radius?: number } | null {
    const pose = id ? this.pose(id) : undefined;
    if (!id || !pose) return null;
    if (this.isDesk(id)) return { box: deskRect(pose, true) };
    const p = pose as Piece;
    return { box: pieceBox(p), ...(isRound(p) ? { radius: pieceRadius(p) } : {}) };
  }

  /** What's wrong with where `id` stands, or nothing. */
  problem(id: string): string | undefined {
    return problemAt(this.now, id);
  }

  /** `before` is what Undo goes back to, if the draft's changed since. */
  remember(before: string) {
    if (this.key() === before) return;
    this.undone.push(before);
    if (this.undone.length > 200) this.undone.shift();
    this.redone.length = 0;
  }

  get canUndo(): boolean {
    return this.undone.length > 0;
  }

  get canRedo(): boolean {
    return this.redone.length > 0;
  }

  /** Back to before the last change (or, with `again`, on to the one just undone): whether there was one. */
  step(again = false): boolean {
    const [from, to] = again ? [this.redone, this.undone] : [this.undone, this.redone];
    const next = from.pop();
    if (!next) return false;
    to.push(this.key());
    this.restore(next);
    return true;
  }

  /**
   * Changes the draft, unless that leaves something where it can't stand (`check`, the one thing that
   * changed, or anything at all): then it's put back, and this is why.
   */
  edit(change: (d: Draft) => void, check?: string | null): string | undefined {
    const before = this.key();
    change(this.now);
    const why = check ? this.problem(check) : (layoutProblems(this.now).values().next().value as string | undefined);
    if (why) this.restore(before);
    else this.remember(before);
    return why;
  }

  /** A quarter turn for a desk or a piece (an eighth for something round), one way or the other. */
  turn(id: string, way: 1 | -1): string | undefined {
    const p = this.pose(id);
    if (!p) return undefined;
    const piece = this.piece(id);
    const by = piece && isRound(piece) ? Math.PI / 4 : Math.PI / 2;
    return this.edit(() => this.setPose(id, p.x, p.z, (((p.rotY + way * by) % TAU) + TAU) % TAU), id);
  }

  /** A new piece of `kind` at (x, z), wherever that is: its id. Nothing's remembered yet (see remember). */
  spawn(kind: FurnitureKind, x: number, z: number): string {
    const k = kindDef(kind);
    // What the office has one of goes by its kind's name, and goes back where the office had it.
    const home = k.fixed ? DEFAULT_FURNITURE.find((p) => p.id === kind) : undefined;
    const piece: Piece = home ? { ...home } : { id: newPieceId(this.now.furniture), kind, x, z, rotY: 0, ...(k.color ? { color: k.color } : {}), ...(k.sizes ? { scale: 1 } : {}), ...(k.text !== undefined ? { text: k.text } : {}) };
    this.now.furniture.push(piece);
    return piece.id;
  }

  /** Stands the piece `id` somewhere near (x, z) it can stand, working outward a ring at a time: whether there was anywhere. */
  private settle(id: string, x: number, z: number): boolean {
    const p = this.piece(id)!;
    for (let ring = 0; ring <= 30; ring++) {
      for (let i = 0; i < (ring ? 16 : 1); i++) {
        const a = (i / 16) * TAU;
        p.x = snap(x + Math.cos(a) * ring * 0.5, SNAP);
        p.z = snap(z + Math.sin(a) * ring * 0.5, SNAP);
        if (!this.problem(id)) return true;
      }
    }
    return false;
  }

  /** Adds `piece` near (x, z), wherever there's room: its id, or null when there's none. */
  private place(make: () => string, x: number, z: number): string | null {
    const before = this.key();
    const id = make();
    if (!this.settle(id, x, z)) {
      this.restore(before);
      return null;
    }
    this.remember(before);
    return id;
  }

  /** A new piece of `kind` near (x, z): its id, or null when there's no room for it. What the office has one of goes back where it was, if it can. */
  add(kind: FurnitureKind, x: number, z: number): string | null {
    const k = kindDef(kind);
    if (!k.fixed) return this.place(() => this.spawn(kind, x, z), x, z);
    const before = this.key();
    const id = this.spawn(kind, x, z);
    if (!this.problem(id)) {
      this.remember(before);
      return id;
    }
    this.restore(before);
    return k.pinned ? null : this.place(() => this.spawn(kind, x, z), x, z);
  }

  /** Another piece like `id`, beside it: its id, or null when there's no room (or no such piece). */
  duplicate(id: string): string | null {
    const p = this.piece(id);
    if (!p) return null;
    return this.place(() => {
      const copy = { ...p, id: newPieceId(this.now.furniture) };
      this.now.furniture.push(copy);
      return copy.id;
    }, p.x + 1, p.z + 1);
  }

  remove(id: string) {
    this.edit((d) => (d.furniture = d.furniture.filter((p) => p.id !== id)));
  }

  /** The office as it comes, but for `keep`: the desks that have to stay where they're saved (a worker's at each). */
  reset(keep: DeskLayout): string | undefined {
    return this.edit((d) => {
      d.desks = { ...keep };
      d.furniture = DEFAULT_FURNITURE.map((p) => ({ ...p }));
      delete d.look;
      delete d.room;
    });
  }
}
