import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { validateLayout, type DeskLayout } from '../shared/office-builder.js';
import { canLabel, cleanLabel, cleanPlan, rowDesks, signColor, type DeskLabel, type FloorPlan } from '../shared/floorplan.js';
import { DESK_BY_ID, WING } from '../shared/layout.js';

/**
 * A floor's own layout: the signs over its desks, and how far its back office is built out. Saved in
 * .agent-office/floorplan.json.
 */
export class FloorPlanStore {
  private plan: FloorPlan;
  private file: string;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'floorplan.json');
    this.plan = this.load();
  }

  state(): FloorPlan {
    return { ...this.plan, labels: { ...this.plan.labels }, ...(this.plan.desks ? { desks: structuredClone(this.plan.desks) } : {}) };
  }

  get wing(): number {
    return this.plan.wing;
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

  layout(raw: unknown, revision: number, taken: (id: string) => boolean): string | undefined {
    if (revision !== (this.plan.layoutRevision ?? 0)) return 'The layout changed while you were editing. Reopen the builder to load it';
    const desks = validateLayout(raw);
    if (typeof desks === 'string') return desks;
    const before = this.plan.desks ?? {};
    const moved = new Set([...Object.keys(before), ...Object.keys(desks)]);
    for (const id of moved) if (JSON.stringify(before[id]) !== JSON.stringify(desks[id]) && taken(id)) return 'Send a worker home before moving its desk';
    const next = { ...this.plan, desks: desks as DeskLayout, layoutRevision: revision + 1 };
    try {
      writeFileSync(this.file + '.tmp', JSON.stringify(next, null, 2), { mode: 0o600 });
      renameSync(this.file + '.tmp', this.file);
      this.plan = next;
    } catch { return 'The layout could not be saved to disk. Your current office is unchanged'; }
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
