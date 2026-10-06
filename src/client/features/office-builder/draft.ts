/**
 * The layout being worked on in the builder: the floor's desks, furniture, paint and room as you've
 * changed them so far, what each change can be undone to, and the changes themselves. A change that
 * leaves something where it can't stand is put back, with why (see shared/office-builder.ts). A wall
 * takes the paintings on its faces with it, wherever it goes (see drag.ts).
 */
import { FACTORY_ROOM, softwareFactory } from '../../../shared/software-factory';
import { DEFAULT_FURNITURE, MAX_PIECES, canGoUp, isRound, kindDef, newPieceId, pieceBox, pieceRadius, type Box, type FurnitureKind, type Piece } from '../../../shared/furniture';
import { cleanRoom, type RoomOptions } from '../../../shared/floorplan';
import { PAINTING, hangSize } from '../../../shared/hangings';
import { deckOf, structureKey } from '../../../shared/mezzanine';
import { starterRooms } from '../../../shared/mezzanine-rooms';
import { ORIGINAL_DESKS, SNAP, deskRect, layoutProblems, problemAt, structureProblem, type DeskLayout, type DeskPose } from '../../../shared/office-builder';
import { wallFaces, type WallFace } from '../../../shared/wall-faces';
import { carry, dragPose, hungOn, otherSide, snap } from './drag';
import type { Arrangement } from './sync';

export interface Draft {
  desks: DeskLayout;
  furniture: Piece[];
  look?: number;
  room?: RoomOptions;
}

export { snap };
/** A layout of the draft's own, to change without changing the one it came from. */
export const draftOf = (a: Arrangement): Draft => JSON.parse(JSON.stringify({ desks: a.desks, furniture: a.furniture, look: a.look, room: a.room })) as Draft;

const TAU = Math.PI * 2;
/** How far off the floor under it a picture's frame keeps (see LIFT in shared/furniture.ts). */
const LIFT_CLEAR = 0.15;

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

  /** The draft as text: to compare it by, and to come back to (see restore). Always in the one order, whatever was set last. */
  key(): string {
    const { desks, furniture, look, room } = this.now;
    return JSON.stringify({ desks, furniture, look, room });
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

  /** Which level the desk or the piece `id` is on: 1 is upstairs. */
  levelOf(id: string): 0 | 1 {
    return this.piece(id)?.level ?? 0;
  }

  /** Where the desk or the piece `id` stands, or undefined if there's no such thing. */
  pose(id: string): DeskPose | undefined {
    return this.isDesk(id) ? (this.now.desks[id] ?? ORIGINAL_DESKS.find((d) => d.id === id)) : this.piece(id);
  }

  /** Stands the desk or the piece `id` there. A wall's paintings go with it. */
  setPose(id: string, x: number, z: number, rotY: number) {
    if (this.isDesk(id)) {
      this.now.desks[id] = { x, z, rotY };
      return;
    }
    const p = this.piece(id);
    if (!p) return;
    carry(this.hung(p), p, { x, z, rotY });
    Object.assign(p, { x, z, rotY });
  }

  /** The faces a painting on `level` can hang on, in the room as the draft has it. */
  private faces(level: number): WallFace[] {
    return wallFaces(this.now.furniture, level, this.now.room);
  }

  /** The paintings on the faces of the wall `p`. */
  private hung(p: Piece): Piece[] {
    return hungOn(p, this.now.furniture, this.now.room);
  }

  /** The floor a desk (with its chair) or a piece takes up, and how far round it reaches if it's round. */
  footprint(id: string | null): { box: Box; radius?: number } | null {
    const pose = id ? this.pose(id) : undefined;
    if (!id || !pose) return null;
    if (this.isDesk(id)) return { box: deskRect(pose, true) };
    const p = pose as Piece;
    return { box: pieceBox(p), ...(isRound(p) ? { radius: pieceRadius(p) } : {}) };
  }

  /**
   * What's wrong with where `id` stands in the room as the draft has it (with its upstairs and its
   * stairs, or without), or nothing. For a wall, with where it leaves the paintings on it.
   */
  problem(id: string): string | undefined {
    const why = problemAt(this.now, id, this.now.room);
    if (why) return why;
    const p = this.piece(id);
    for (const r of p ? this.hung(p) : []) {
      const theirs = problemAt(this.now, r.id, this.now.room);
      if (theirs) return theirs;
    }
    return undefined;
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
   * changed, or anything at all): then it's put back, and this is why. A change to the room's structure
   * is such a change while something stands where the new one has no place for it, and the reason
   * says what to clear first (see structureProblem).
   */
  edit(change: (d: Draft) => void, check?: string | null): string | undefined {
    const before = this.key();
    const was = this.now.room ?? {};
    change(this.now);
    const room = this.now.room ?? {};
    const why = (structureKey(was) !== structureKey(room) && structureProblem(this.now, was, room)) || (check ? this.problem(check) : (layoutProblems(this.now, room).values().next().value as string | undefined));
    if (why) this.restore(before);
    else this.remember(before);
    return why;
  }

  /**
   * Changes some of the room's own fittings. They go over what the floor has saved for itself, not over
   * the room worked out in full, so a floor that goes from one level back to the corner loft has the
   * boss's office in it again. What's kept is only what isn't the office's own (see cleanRoom).
   */
  setRoom(patch: RoomOptions): string | undefined {
    return this.edit((d) => {
      const room = cleanRoom({ ...(d.room ?? {}), ...patch });
      if (Object.keys(room).length) d.room = room;
      else delete d.room;
    });
  }

  /** Changes what the piece `id` is like: its paint, its words, its picture and the rest (a key with nothing takes that away). */
  repiece(id: string, patch: Partial<Piece>): string | undefined {
    return this.edit(() => {
      const p = this.piece(id) as Record<string, unknown> | undefined;
      if (!p) return;
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) delete p[key];
        else p[key] = value;
      }
      const piece = p as unknown as Piece;
      // A picture that's grown keeps its frame off the floor, as the office will have it (see cleanFurniture).
      if (kindDef(piece.kind).shows) piece.lift = Math.max(piece.lift ?? PAINTING.lift, Math.round(Math.ceil((hangSize(piece).h / 2 + LIFT_CLEAR) / 0.05 - 1e-9) * 50) / 1000);
    }, id);
  }

  /**
   * A quarter turn for a desk or a piece (an eighth for something round), one way or the other. A
   * painting goes round to the other side of its wall instead.
   */
  turn(id: string, way: 1 | -1): string | undefined {
    const p = this.pose(id);
    if (!p) return undefined;
    const piece = this.piece(id);
    if (piece && kindDef(piece.kind).hangs) {
      const to = otherSide(piece, this.faces(piece.level ?? 0));
      if (!to) return 'It hangs on one of the room’s own walls: there’s no other side to turn it to';
      return this.edit(() => this.setPose(id, to.x, to.z, to.rotY), id);
    }
    const by = piece && isRound(piece) ? Math.PI / 4 : Math.PI / 2;
    return this.edit(() => this.setPose(id, p.x, p.z, (((p.rotY + way * by) % TAU) + TAU) % TAU), id);
  }

  /**
   * Drags the desk or the piece `id` to `at`, wherever that lands it (see dragPose): whether it moved.
   * `within` is how near a wall a painting has to be to go onto it. Nothing's checked or remembered yet.
   */
  dragTo(id: string, at: { x: number; z: number }, alt: boolean, within?: number): boolean {
    const p = this.pose(id);
    if (!p) return false;
    const piece = this.piece(id);
    const level = piece?.level ?? 0;
    const to = dragPose(at, piece, piece && kindDef(piece.kind).hangs ? this.faces(level) : [], level ? deckOf(this.now.room) : undefined, alt, within);
    const rotY = to.rotY ?? p.rotY;
    if (to.x === p.x && to.z === p.z && rotY === p.rotY) return false;
    this.setPose(id, to.x, to.z, rotY);
    return true;
  }

  /** A new piece of `kind` at (x, z), wherever that is, upstairs with `level` 1 if its kind goes up there: its id. Nothing's remembered yet (see remember). */
  spawn(kind: FurnitureKind, x: number, z: number, level = 0): string {
    const k = kindDef(kind);
    // What the office has one of goes by its kind's name, and goes back where the office had it.
    const home = k.fixed ? DEFAULT_FURNITURE.find((p) => p.id === kind) : undefined;
    const piece: Piece = home
      ? { ...home }
      : {
          id: newPieceId(this.now.furniture),
          kind,
          x,
          z,
          rotY: 0,
          ...(k.color ? { color: k.color } : {}),
          ...(k.sizes ? { scale: 1 } : {}),
          ...(k.text !== undefined ? { text: k.text } : {}),
          ...(level === 1 && canGoUp(kind) ? { level: 1 as const } : {}),
          ...(k.shows ? { frame: PAINTING.frame, size: PAINTING.size, aspect: PAINTING.aspect, lift: PAINTING.lift } : {}),
        };
    this.now.furniture.push(piece);
    return piece.id;
  }

  /** Whether the painting `p` hangs over another one, on the same wall. */
  private covers(p: Piece): boolean {
    const mine = pieceBox(p);
    return this.now.furniture.some((o) => {
      if (o === p || !kindDef(o.kind).hangs || (o.level ?? 0) !== (p.level ?? 0)) return false;
      const b = pieceBox(o);
      return mine.minX < b.maxX && mine.maxX > b.minX && mine.minZ < b.maxZ && mine.maxZ > b.minZ;
    });
  }

  /**
   * Stands the piece `id` somewhere near (x, z) it can stand, working outward a ring at a time: whether
   * there was anywhere. Upstairs that's on the deck; for a painting, on the nearest wall with room for it.
   */
  private settle(id: string, x: number, z: number): boolean {
    const p = this.piece(id)!;
    const hangs = !!kindDef(p.kind).hangs;
    const faces = hangs ? this.faces(p.level ?? 0) : [];
    const deck = p.level ? deckOf(this.now.room) : undefined;
    for (let ring = 0; ring <= 30; ring++) {
      for (let i = 0; i < (ring ? 16 : 1); i++) {
        const a = (i / 16) * TAU;
        const to = dragPose({ x: x + Math.cos(a) * ring * 0.5, z: z + Math.sin(a) * ring * 0.5 }, p, faces, deck, false, Infinity);
        this.setPose(id, to.x, to.z, to.rotY ?? p.rotY);
        if (!this.problem(id) && !(hangs && this.covers(p))) return true;
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

  /**
   * A new piece of `kind` near (x, z), on `level`: its id, or null when there's no room for it. What
   * the office has one of goes back where it was, if it can. A painting goes on the nearest wall.
   */
  add(kind: FurnitureKind, x: number, z: number, level = 0): string | null {
    const k = kindDef(kind);
    if (!k.fixed) return this.place(() => this.spawn(kind, x, z, level), x, z);
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

  /** Takes the piece `id` away, and with a wall the paintings on it: how many of those went. */
  remove(id: string): number {
    const p = this.piece(id);
    const gone = new Set([id, ...(p ? this.hung(p) : []).map((r) => r.id)]);
    this.edit((d) => (d.furniture = d.furniture.filter((q) => !gone.has(q.id))));
    return this.piece(id) ? 0 : gone.size - 1;
  }

  /**
   * Moves the piece `id` to the other level, as near where it stood as it can stand there (a wall
   * with its paintings, a painting onto the nearest wall): why it couldn't, if it couldn't.
   */
  relevel(id: string): string | undefined {
    const p = this.piece(id);
    if (!p) return undefined;
    const up = !p.level;
    const label = kindDef(p.kind).label;
    if (up && !canGoUp(p.kind)) return `The ${label.toLowerCase()} only stands on the office floor`;
    if (up && !deckOf(this.now.room)?.floor) return 'This floor has no upstairs to furnish';
    const before = this.key();
    for (const q of [p, ...this.hung(p)]) {
      if (up) q.level = 1;
      else delete q.level;
    }
    if (!this.settle(id, p.x, p.z)) {
      this.restore(before);
      return up ? `There’s no room for the ${label.toLowerCase()} upstairs` : `There’s no room for the ${label.toLowerCase()} on the office floor: clear some first`;
    }
    this.remember(before);
    return undefined;
  }

  /** How many pieces are upstairs. */
  get upstairs(): number {
    return this.now.furniture.filter((p) => p.level).length;
  }

  /** Stands the starter rooms on the big mezzanine (see shared/mezzanine-rooms.ts): why they couldn't be, if they couldn't. */
  starter(): string | undefined {
    const rooms = starterRooms(this.now.furniture);
    if (this.now.furniture.length + rooms.length > MAX_PIECES) return `A floor takes at most ${MAX_PIECES} pieces of furniture: take some away first`;
    return this.edit((d) => d.furniture.push(...rooms));
  }

  /**
   * The Software Factory (shared/software-factory.ts): its rooms, hallway and conference tables in place of the
   * floor's furniture, and the floor seated at the tables. Undo brings the floor back.
   */
  factory(): string | undefined {
    return this.edit((d) => {
      d.furniture = softwareFactory();
      d.room = { ...FACTORY_ROOM };
    });
  }

  /** Takes everything upstairs away. */
  clearUp() {
    this.edit((d) => (d.furniture = d.furniture.filter((p) => !p.level)));
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
