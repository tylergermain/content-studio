// Main Street's businesses, kept in the office's data folder's street.json (see protocol/street.ts):
// one registry for the building, reached through streetOf(ctx), so the office's core knows nothing
// of it. A missing file is no businesses, so every plot is for lease.
//
// The file is read when it's first needed, and again whenever it changes on disk (its mtime and size,
// as accounts.json is), so a command can edit it while the office runs. One that won't read (not JSON,
// another version, no list of businesses) is logged and taken as no businesses, and a business in it
// that won't do is logged and left out; either way the file is moved aside (street.json.corrupt-<ms>)
// before the office first writes over it, so nothing in it is lost. Writes go to a file of their own
// that's renamed into place, so nobody ever reads half of one.
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PLOTS, type Claimable } from '../../shared/mainstreet.js';
import { BUSINESS_LIMITS, type BusinessCard, type BusinessDef, type PlotLook, type StreetFile, type StreetView } from '../../shared/protocol.js';
import type { Ctx } from '../office/context.js';
import { businessId, cardOf, defFrom } from './look.js';

/** What a change to the street came to: the business as it is now, or why it didn't happen. */
export type StreetChange = { def: BusinessDef } | { error: string };

/** Main Street as the office keeps it. */
export interface StreetRegistry {
  /** Every business's public card: what's standing on each claimed plot. */
  cards(): readonly BusinessCard[];
  /** Main Street as everyone is sent it (FloorView.street, and `street`). */
  view(): StreetView;
  /** Every business as street.json has it, quotas and all: for the office's own use, never sent as it is. */
  defs(): readonly BusinessDef[];
  /** The business on `plot`, if it's claimed. */
  onPlot(plot: Claimable): BusinessDef | undefined;
  /**
   * Claims `plot`, which must be for lease, for a new business with `look`, by street admin `by`: a
   * hosted business (BUSINESS_LIMITS' default quotas, untrusted) whose id is made from its name.
   */
  claim(plot: Claimable, look: PlotLook, by: string, at?: number): StreetChange;
  /** Changes what stands on `plot` (its id never changes). `id`: only if that's still the business there. */
  edit(plot: Claimable, look: Partial<PlotLook>, id?: string): StreetChange;
  /** Gives `plot` back: it's for lease again. `id`: only if that's still the business there. */
  release(plot: Claimable, id?: string): StreetChange;
}

/** Told to an admin whose window was showing a business that has since gone from the plot. */
export const changedHands = (plot: Claimable) => `🏙 ${PLOTS[plot].name} changed while you were looking: have another look`;

class Registry implements StreetRegistry {
  private readonly file: string;
  /** The file's mtime and size when it was last read or written; '' while there's none, undefined before the first look. */
  private stamp: string | undefined;
  private list: BusinessDef[] = [];
  private cardList: readonly BusinessCard[] = [];
  /** The file had something in it the office couldn't use: move it aside before writing over it. */
  private keepAside = false;

  constructor(readonly dataDir: string) {
    this.file = path.join(dataDir, 'street.json');
  }

  cards(): readonly BusinessCard[] {
    this.sync();
    return this.cardList;
  }

  view(): StreetView {
    return { cards: [...this.cards()] };
  }

  defs(): readonly BusinessDef[] {
    this.sync();
    return this.list;
  }

  onPlot(plot: Claimable): BusinessDef | undefined {
    return this.defs().find((d) => d.plot === plot);
  }

  claim(plot: Claimable, look: PlotLook, by: string, at = Date.now()): StreetChange {
    const was = this.onPlot(plot);
    if (was) return { error: `🏙 ${PLOTS[plot].name} is ${was.name}'s already` };
    const def: BusinessDef = {
      id: businessId(look.name, plot, this.list.map((d) => d.id)),
      name: look.name,
      plot,
      accent: look.accent,
      skin: look.skin,
      stage: look.stage,
      planned: look.planned,
      home: 'hosted',
      maxFloors: BUSINESS_LIMITS.defaultFloors,
      maxWorkers: BUSINESS_LIMITS.defaultWorkers,
      by,
      at,
    };
    return this.save([...this.list, def]) ?? { def };
  }

  edit(plot: Claimable, look: Partial<PlotLook>, id?: string): StreetChange {
    const was = this.onPlot(plot);
    if (!was) return { error: `🏙 ${PLOTS[plot].name} is for lease: claim it first` };
    if (id !== undefined && id !== was.id) return { error: changedHands(plot) };
    const def: BusinessDef = { ...was, ...look };
    if (JSON.stringify(def) === JSON.stringify(was)) return { def: was };
    return this.save(this.list.map((d) => (d === was ? def : d))) ?? { def };
  }

  release(plot: Claimable, id?: string): StreetChange {
    const was = this.onPlot(plot);
    if (!was) return { error: `🏙 ${PLOTS[plot].name} is for lease already` };
    if (id !== undefined && id !== was.id) return { error: changedHands(plot) };
    return this.save(this.list.filter((d) => d !== was)) ?? { def: was };
  }

  /** Takes `list` as the businesses on the street, and the cards everyone's sent with it. */
  private take(list: BusinessDef[]) {
    this.list = list;
    this.cardList = Object.freeze(list.map(cardOf));
  }

  /** Reads the file again if it changed since it was last read or written (or hasn't been read yet). */
  private sync() {
    let stamp = '';
    try {
      const st = statSync(this.file);
      stamp = `${st.mtimeMs}:${st.size}`;
    } catch {
      // No street.json: nobody has claimed a plot yet.
    }
    if (stamp === this.stamp) return;
    this.stamp = stamp;
    this.keepAside = false;
    if (!stamp) return this.take([]);
    let saved: unknown;
    try {
      saved = JSON.parse(readFileSync(this.file, 'utf8'));
    } catch (err) {
      return this.unreadable((err as Error).message);
    }
    const f = saved as Partial<Record<keyof StreetFile, unknown>> | null;
    if (!f || typeof f !== 'object' || Array.isArray(f)) return this.unreadable("it isn't an object");
    if (f.version !== 1) return this.unreadable(`it's version ${JSON.stringify(f.version)}, and this office reads version 1`);
    if (!Array.isArray(f.businesses)) return this.unreadable('its businesses are not a list');
    const kept: BusinessDef[] = [];
    f.businesses.forEach((raw: unknown, i) => {
      const r = defFrom(raw, kept);
      if ('error' in r) {
        console.error(`agent-office: left business ${i + 1} out of ${this.file}: ${r.error}`);
        this.keepAside = true;
        return;
      }
      if (r.fixed.length) {
        console.error(`agent-office: ${r.def.id} in ${this.file} had ${r.fixed.join(', ')} the office couldn't use: left off, or the default`);
        this.keepAside = true;
      }
      kept.push(r.def);
    });
    this.take(kept);
  }

  /** The file is there but can't be read: Main Street has no businesses until it's fixed, and it's kept, not written over. */
  private unreadable(why: string) {
    console.error(`agent-office: couldn't read ${this.file}: ${why}. Main Street has no businesses until it's fixed; it's moved aside before anything is saved over it`);
    this.keepAside = true;
    this.take([]);
  }

  /** Writes `list` to the file, whole, and takes it as the street: nothing, or why it couldn't. */
  private save(list: BusinessDef[]): { error: string } | undefined {
    const file: StreetFile = { version: 1, businesses: list };
    const tmp = `${this.file}.${process.pid}.tmp`;
    try {
      mkdirSync(this.dataDir, { recursive: true });
      if (this.keepAside) {
        const aside = `${this.file}.corrupt-${Date.now()}`;
        try {
          renameSync(this.file, aside);
          console.error(`agent-office: moved ${this.file} aside to ${aside}, keeping what the office couldn't read`);
        } catch (err) {
          // Already gone (moved by hand): there's nothing left to keep.
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
        }
        this.keepAside = false;
      }
      writeFileSync(tmp, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
      renameSync(tmp, this.file);
    } catch (err) {
      console.error(`agent-office: couldn't save ${this.file}: ${(err as Error).message}`);
      return { error: `🏙 Couldn't save Main Street: ${(err as Error).message}` };
    }
    this.take(list);
    try {
      const st = statSync(this.file);
      this.stamp = `${st.mtimeMs}:${st.size}`;
    } catch {
      this.stamp = undefined;
    }
    return undefined;
  }
}

/** Each office's street. */
const STREETS = new WeakMap<Ctx, StreetRegistry>();

/** The office's Main Street, made the first time it's asked for. */
export function streetOf(ctx: Ctx): StreetRegistry {
  let street = STREETS.get(ctx);
  if (!street) STREETS.set(ctx, (street = new Registry(ctx.cfg.dataDir)));
  return street;
}

/** A Main Street of its own over `dataDir`, outside any office: for the tests, and a command that edits street.json. */
export const streetIn = (dataDir: string): StreetRegistry => new Registry(dataDir);
