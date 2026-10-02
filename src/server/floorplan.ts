import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { floorSeat, type Piece } from '../shared/furniture.js';
import { layoutFurniture, mezzanineProblem, validateLayout, type DeskLayout } from '../shared/office-builder.js';
import { hasLoft } from '../shared/office-fixed.js';
import { canLabel, cleanLabel, cleanLook, cleanPlan, cleanRoom, roomOf, rowDesks, signColor, type DeskLabel, type FloorPlan, type RoomOptions } from '../shared/floorplan.js';
import { DESK_BY_ID, WING, type SeatDef } from '../shared/layout.js';

/**
 * A floor's own layout: the signs over its desks, how far its back office is built out, and where its
 * desks and furniture stand once the office builder's rearranged them. Saved in .agent-office/floorplan.json.
 */
export class FloorPlanStore {
  private plan: FloorPlan;
  private file: string;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'floorplan.json');
    this.plan = this.load();
  }

  state(): FloorPlan {
    return structuredClone(this.plan);
  }

  get wing(): number {
    return this.plan.wing;
  }

  /** How the floor's arranged now, and the room it's in, for whoever gets round it (the dog): not copies, so not to be changed. */
  layoutNow(): { desks: DeskLayout; furniture: readonly Piece[]; room: Required<RoomOptions>; revision: number } {
    return { desks: this.plan.desks ?? {}, furniture: layoutFurniture(this.plan), room: roomOf(this.plan), revision: this.plan.layoutRevision ?? 0 };
  }

  /** The seat called `id` on this floor (see floorSeat), for whoever sits down: none of the loft's on a floor without one. */
  seat(id: string): SeatDef | undefined {
    return floorSeat(layoutFurniture(this.plan), this.plan.wing, id, roomOf(this.plan));
  }

  /** Hangs a sign over a desk, or takes it down (no text). What it did, for the toast, or why it couldn't. */
  label(deskId: string, text: unknown, color: unknown, by: string): { label?: DeskLabel; old?: DeskLabel } | string {
    if (!canLabel(deskId)) return 'Only a desk can have a sign over it';
    const clean = cleanLabel(text);
    const old = this.plan.labels[deskId];
    if (!clean) {
      if (!old) return {};
      delete this.plan.labels[deskId];
      this.save();
      return { old };
    }
    const label: DeskLabel = { text: clean, color: signColor(color), by, at: Date.now() };
    this.plan.labels[deskId] = label;
    this.save();
    return { label, old };
  }

  /** Knocks the back office out another row: the ids of the desks that came with it, or why not. */
  expand(): string[] | string {
    if (this.plan.wing >= WING.rows) return "The back office can't go back any further";
    this.plan.wing++;
    this.save();
    return rowDesks(this.plan.wing).map((d) => d.id);
  }

  /** Walls up the back office's last row, unless someone's working there (`taken`). What went, or why not. */
  shrink(taken: (deskId: string) => boolean): string[] | string {
    if (this.plan.wing <= 0) return 'There is no back office to wall up';
    const desks = rowDesks(this.plan.wing);
    const busy = desks.find((d) => taken(d.id));
    if (busy) return `Someone's at ${DESK_BY_ID.get(busy.id)?.label ?? 'a desk'} back there: send them home first`;
    this.plan.wing--;
    this.save();
    return desks.map((d) => d.id);
  }

  /**
   * Saves the floor as the office builder arranged it: its desks, its furniture, its paint and its room
   * (the layout's checked against the room it's saved with: furniture can stand where the stairs were
   * on a floor that's all one level, and has to be off them before the mezzanine comes back). `revision`
   * is the layout it was arranged from, so one saved meanwhile isn't lost. A desk with a worker at it
   * (`taken`) stays where it is. Why it couldn't, or nothing.
   */
  layout(raw: { desks?: unknown; furniture?: unknown; look?: unknown; room?: unknown }, revision: number, taken: (id: string) => boolean): string | undefined {
    if (revision !== (this.plan.layoutRevision ?? 0)) return 'The layout changed while you were editing. Reload it in the builder';
    const room = cleanRoom(raw.room);
    const layout = validateLayout(raw.desks, raw.furniture, room);
    if (typeof layout === 'string') {
      // Bringing the mezzanine back to a floor that was all one level: what's in its way says so.
      const flat = hasLoft(room) && !hasLoft(this.plan.room) ? validateLayout(raw.desks, raw.furniture, { ...room, loft: false }) : undefined;
      return (typeof flat === 'object' && mezzanineProblem(flat, room)) || layout;
    }
    const before = this.plan.desks ?? {};
    const moved = new Set([...Object.keys(before), ...Object.keys(layout.desks)]);
    for (const id of moved) if (JSON.stringify(before[id]) !== JSON.stringify(layout.desks[id]) && taken(id)) return 'Send a worker home before moving its desk';
    const look = cleanLook(raw.look);
    const { look: _was, room: _had, ...rest } = this.plan;
    const next: FloorPlan = { ...rest, ...(look !== undefined ? { look } : {}), ...(Object.keys(room).length ? { room } : {}), desks: layout.desks, furniture: layout.furniture, layoutRevision: revision + 1 };
    try {
      writeFileSync(this.file + '.tmp', JSON.stringify(next, null, 2), { mode: 0o600 });
      renameSync(this.file + '.tmp', this.file);
      this.plan = next;
    } catch {
      return 'The layout could not be saved to disk. Your current office is unchanged';
    }
  }

  private load(): FloorPlan {
    if (!existsSync(this.file)) return cleanPlan(undefined);
    try {
      return cleanPlan(JSON.parse(readFileSync(this.file, 'utf8')));
    } catch {
      // a broken file just means the office as it comes
      return cleanPlan(undefined);
    }
  }

  private save() {
    try {
      writeFileSync(this.file, JSON.stringify(this.plan, null, 2), { mode: 0o600 });
    } catch {
      // disk issues shouldn't take the office down
    }
  }
}
