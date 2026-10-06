import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { cleanPieceText, floorSeat, pieceBox, type Piece } from '../shared/furniture.js';
import { layoutFurniture, structureProblem, validateLayout, type DeskLayout } from '../shared/office-builder.js';
import { structureKey } from '../shared/mezzanine.js';
import { canLabel, cleanLabel, cleanLook, cleanPlan, cleanRoom, roomOf, rowDesks, signColor, type DeskLabel, type FloorPlan, type FloorRoom } from '../shared/floorplan.js';
import { DESK_BY_ID, MEETING_SEATS, SEATS, WING, type SeatDef } from '../shared/layout.js';
import { seatingOf, type Seating } from '../shared/table-seats.js';
import { meetingOf } from '../shared/meeting-place.js';
import type { ProjectLink, WorkerProject } from '../shared/project-rooms.js';
import { checkProjects, deskProject } from './project-rooms.js';

/**
 * A floor's own layout: the signs over its desks, how far its back office is built out, and where its
 * desks and furniture stand once the office builder's rearranged them. Saved in .agent-office/floorplan.json.
 */
export class FloorPlanStore {
  private plan: FloorPlan;
  private file: string;
  /** The floor's own folder, which its project rooms' folders are checked against (see checkProjects). */
  private floorDir: string;

  /** `home` is the folder a project room's folder has to be inside (see checkProjects): whoever runs the office's own. */
  constructor(dataDir: string, private home?: string) {
    this.file = path.join(dataDir, 'floorplan.json');
    this.floorDir = path.dirname(dataDir);
    this.plan = this.load();
  }

  state(): FloorPlan {
    return structuredClone(this.plan);
  }

  get wing(): number {
    return this.plan.wing;
  }

  /** The paint the office builder gave the floor over its own (one of FLOOR_PALETTES), if it did. */
  get look(): number | undefined {
    return this.plan.look;
  }

  /** How the floor's arranged now, and the room it's in, for whoever gets round it (the dog): not copies, so not to be changed. */
  layoutNow(): { desks: DeskLayout; furniture: readonly Piece[]; room: FloorRoom; revision: number } {
    return { desks: this.plan.desks ?? {}, furniture: layoutFurniture(this.plan), room: roomOf(this.plan), revision: this.plan.layoutRevision ?? 0 };
  }

  /** The seat called `id` on this floor (see floorSeat), for whoever sits down: none of the loft's on a floor without the boss's office. */
  seat(id: string): SeatDef | undefined {
    return floorSeat(layoutFurniture(this.plan), this.plan.wing, id, roomOf(this.plan));
  }

  /** Where its workers sit beyond its desks: the chairs at its conference tables, and whether those are all (see shared/table-seats.ts). */
  seating(): Seating {
    return seatingOf({ furniture: layoutFurniture(this.plan), room: this.plan.room });
  }

  /** The project room the desk `deskId` is in, as a worker hired there keeps it (see shared/project-rooms.ts). */
  deskProject(deskId: string): WorkerProject | undefined {
    return deskProject({ desks: this.plan.desks ?? {}, furniture: layoutFurniture(this.plan) }, deskId);
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
   * on a floor that's all one level, and has to be off them before the mezzanine comes back; what's
   * upstairs has to come down before its deck goes). `revision`
   * is the layout it was arranged from, so one saved meanwhile isn't lost. A desk with a worker at it
   * (`taken`) stays where it is, and so does the meeting place while anyone's sat at it for a meeting.
   * Why it couldn't, or nothing.
   */
  layout(raw: { desks?: unknown; furniture?: unknown; look?: unknown; room?: unknown }, revision: number, taken: (id: string) => boolean): string | undefined {
    if (revision !== (this.plan.layoutRevision ?? 0)) return 'The layout changed while you were editing. Reload it in the builder';
    const room = cleanRoom(raw.room);
    const layout = validateLayout(raw.desks, raw.furniture, room);
    if (typeof layout === 'string') {
      // The room itself is changing (a mezzanine coming or going, the kitchen back) and the layout was
      // fine in the one it has: what's in the new one's way says which, and what to clear first.
      const had = this.plan.room ?? {};
      if (structureKey(room) !== structureKey(had)) {
        const under = validateLayout(raw.desks, raw.furniture, had);
        if (typeof under === 'object') return structureProblem(under, had, room) ?? layout;
      }
      return layout;
    }
    const before = this.plan.desks ?? {};
    const moved = new Set([...Object.keys(before), ...Object.keys(layout.desks)]);
    for (const id of moved) if (JSON.stringify(before[id]) !== JSON.stringify(layout.desks[id]) && taken(id)) return 'Send a worker home before moving its desk';
    // Nobody's left at a desk on a floor seated at tables, or at a table that's gone (one moved takes its workers with it).
    if (room.seating === 'tables' && SEATS.some((d) => taken(d.id))) return 'Send the workers at desks and bean bags home before seating the floor at its tables';
    const chairs = seatingOf({ furniture: layout.furniture, room }).tables;
    if ([...this.seating().tables.keys()].some((id) => taken(id) && !chairs.has(id))) return 'Send its workers home before taking a conference table away';
    // The meeting's seats are the meeting place's: it doesn't move out from under whoever's in one.
    if (meetingOf(room) !== meetingOf(this.plan.room) && MEETING_SEATS.some((d) => taken(d.id))) return 'Clear the meeting room before moving the meeting place';
    const project = checkProjects(layout.furniture, this.floorDir, this.home);
    if (project) return project;
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

  /**
   * Names a project room, and gives it its project or takes that away (`project: null`): what a room set up for a
   * repository has (server/factory-rooms.ts). The room keeps where it is; its folder is checked as the builder's
   * are (checkProjects). The room as it is now, or why not.
   */
  setRoom(id: string, patch: { name?: string; project?: ProjectLink | null }): Piece | string {
    const furniture = layoutFurniture(this.plan).map((p) => ({ ...p, ...(p.project ? { project: { ...p.project } } : {}) }));
    const room = furniture.find((p) => p.id === id && p.kind === 'project-room');
    if (!room) return 'There is no such room on this floor';
    if (patch.name !== undefined) {
      const was = room.text;
      room.text = cleanPieceText(patch.name) || room.text;
      // Its doorway's sign, when it was named for the room (as the Software Factory's are), goes by the new name too.
      const b = pieceBox(room);
      for (const d of furniture) {
        if (d.kind !== 'doorway' || !was || d.text !== was) continue;
        const db = pieceBox(d);
        if (db.maxX > b.minX - 0.5 && db.minX < b.maxX + 0.5 && db.maxZ > b.minZ - 0.5 && db.minZ < b.maxZ + 0.5) d.text = room.text;
      }
    }
    if (patch.project === null) delete room.project;
    else if (patch.project) room.project = { ...room.project, ...patch.project };
    const problem = checkProjects(furniture, this.floorDir, this.home);
    if (problem) return problem;
    const next: FloorPlan = { ...this.plan, furniture, layoutRevision: (this.plan.layoutRevision ?? 0) + 1 };
    try {
      writeFileSync(this.file + '.tmp', JSON.stringify(next, null, 2), { mode: 0o600 });
      renameSync(this.file + '.tmp', this.file);
      this.plan = next;
    } catch {
      return 'The room could not be saved to disk';
    }
    return room;
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
