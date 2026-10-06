import { randomBytes } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ReviewItem, ReviewState } from '../../shared/review-queue.js';
import { WORKSPACE_TABS } from '../../shared/workspace.js';

// The review queue's items, office-wide, in <office data>/review-queue.json: each finished task, and what became of
// it. One item a worker at a time is waiting: finishing again while it waits brings that one up to date rather than
// queueing another. Decided items are kept a while, so the queue can show what was done.

const KEEP_DECIDED = 300;
const STATES: readonly ReviewState[] = ['waiting', 'approved', 'notes', 'dismissed'];

export class ReviewStore {
  private file: string;
  private items: ReviewItem[];

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'review-queue.json');
    this.items = this.load();
  }

  private load(): ReviewItem[] {
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as { items?: unknown };
      return (Array.isArray(raw.items) ? raw.items : []).filter((i): i is ReviewItem => {
        const x = i as ReviewItem;
        return !!x && typeof x.id === 'string' && typeof x.workerId === 'string' && typeof x.floor === 'string' && STATES.includes(x.state) && (WORKSPACE_TABS as readonly string[]).includes(x.app) && Array.isArray(x.files);
      });
    } catch {
      return [];
    }
  }

  private save() {
    const waiting = this.items.filter((i) => i.state === 'waiting');
    const decided = this.items.filter((i) => i.state !== 'waiting').sort((a, b) => (b.decidedAt ?? 0) - (a.decidedAt ?? 0)).slice(0, KEEP_DECIDED);
    this.items = [...waiting, ...decided];
    try {
      writeFileSync(`${this.file}.tmp`, JSON.stringify({ items: this.items }), { mode: 0o600 });
      renameSync(`${this.file}.tmp`, this.file);
    } catch {
      // the queue in memory carries on; it's written again on the next change
    }
  }

  list(): readonly ReviewItem[] {
    return this.items;
  }

  get(id: string): ReviewItem | undefined {
    return this.items.find((i) => i.id === id);
  }

  /** The item waiting for this worker, if one is. */
  waitingFor(floor: string, workerId: string): ReviewItem | undefined {
    return this.items.find((i) => i.state === 'waiting' && i.floor === floor && i.workerId === workerId);
  }

  /** A finished task: a new item, or the worker's waiting one brought up to date. */
  add(item: Omit<ReviewItem, 'id' | 'state' | 'at' | 'updatedAt'>, now = Date.now()): ReviewItem {
    const was = this.waitingFor(item.floor, item.workerId);
    if (was) {
      Object.assign(was, item, { updatedAt: now });
      this.save();
      return was;
    }
    const made: ReviewItem = { ...item, id: `rq${now.toString(36)}${randomBytes(3).toString('hex')}`, state: 'waiting', at: now, updatedAt: now };
    this.items.unshift(made);
    this.save();
    return made;
  }

  decide(id: string, state: ReviewState, by: string, now = Date.now()): ReviewItem | undefined {
    const item = this.get(id);
    if (!item) return undefined;
    item.state = state;
    if (state === 'waiting') {
      delete item.decidedAt;
      delete item.decidedBy;
    } else {
      item.decidedAt = now;
      item.decidedBy = by;
    }
    this.save();
    return item;
  }

  /** A worker that's gone home leaves nothing waiting: its items go as dismissed. */
  workerGone(floor: string, workerId: string, now = Date.now()) {
    let changed = false;
    for (const i of this.items) {
      if (i.state !== 'waiting' || i.floor !== floor || i.workerId !== workerId) continue;
      i.state = 'dismissed';
      i.decidedAt = now;
      i.decidedBy = 'Went home';
      changed = true;
    }
    if (changed) this.save();
  }
}
