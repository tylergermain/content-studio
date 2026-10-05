// Putt Street's records, kept in the office's minigolf.json (a PuttBoard): the course record for a full
// nine holes, the best anyone's done each hole in, the holes in one, and the last few rounds. A tie
// goes to whoever got there first. A file that won't read is logged and set aside (renamed
// minigolf.json.corrupt-<ms>) before anything is written over it, and the records start afresh; a bad
// entry in a good file is dropped. Writes go to a temporary file and are renamed into place, so the
// file is never half written.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PUTT_RULES, emptyPuttBoard, type PuttAce, type PuttBest, type PuttBoard, type PuttCard, type PuttRecord } from '../../shared/protocol.js';

/** How many holes in one are kept, newest first. */
export const ACES_KEPT = 50;
/** The most strokes a hole can count for, and a round. */
const MOST = PUTT_RULES.picked;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const nameOk = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const whenOk = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
const intIn = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
const name24 = (s: string) => s.trim().slice(0, 24);

/** What a finished round did to the records. */
export interface RoundNews {
  /** Its card went on the last rounds (someone went the whole nine). */
  kept: boolean;
  /** A new course record, if one was set. */
  record?: PuttRecord;
}

export class PuttRecords {
  private data: PuttBoard = emptyPuttBoard();
  /** The file on disk couldn't be read: it's set aside before the first write. */
  private unreadable = false;
  readonly file: string;

  constructor(
    dataDir: string,
    private now = () => Date.now(),
  ) {
    this.file = path.join(dataDir, 'minigolf.json');
    this.load();
  }

  /** The records, as everyone sees them. */
  board(): PuttBoard {
    return this.data;
  }

  /**
   * `name` holed out on `hole` (0..8) in `strokes`: their best there if it's the best yet (a tie
   * keeps the earlier one), and a hole in one if it took one. Says which it was, if either.
   */
  holedOut(name: string, hole: number, strokes: number): { best: boolean; ace: boolean } {
    if (!intIn(hole, 0, PUTT_RULES.holes - 1) || !intIn(strokes, 1, MOST)) return { best: false, ace: false };
    const at = this.now();
    const was = this.data.best[hole];
    const best = !was || strokes < was.strokes;
    if (best) this.data.best[hole] = { strokes, name: name24(name), at };
    const ace = strokes === 1;
    if (ace) this.data.aces = [{ name: name24(name), hole, at }, ...this.data.aces].slice(0, ACES_KEPT);
    if (best || ace) this.save();
    return { best, ace };
  }

  /**
   * A round's over: everyone who went the whole nine (`cards`, in the order they played) goes on the
   * last rounds, and the lowest total of them is the course record if it beats the one there (a tie
   * keeps the one that was there first, and the first to play of two tied in the round).
   */
  roundOver(cards: { name: string; total: number }[]): RoundNews {
    const full = cards.filter((c) => intIn(c.total, PUTT_RULES.holes, PUTT_RULES.holes * MOST));
    if (!full.length) return { kept: false };
    const at = this.now();
    const card: PuttCard = { names: full.map((c) => name24(c.name)), totals: full.map((c) => c.total), at };
    this.data.rounds = [card, ...this.data.rounds].slice(0, PUTT_RULES.kept);
    let news: RoundNews = { kept: true };
    const low = full.reduce((a, b) => (b.total < a.total ? b : a));
    if (!this.data.record || low.total < this.data.record.total) {
      this.data.record = { total: low.total, name: name24(low.name), at };
      news = { kept: true, record: this.data.record };
    }
    this.save();
    return news;
  }

  private load() {
    if (!existsSync(this.file)) return;
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(this.file, 'utf8'));
    } catch (err) {
      return this.cantRead((err as Error).message);
    }
    if (!isObj(raw)) return this.cantRead('it is not a record of Putt Street');
    const dropped: string[] = [];
    const board = emptyPuttBoard();
    const rec = raw.record;
    if (isObj(rec) && intIn(rec.total, PUTT_RULES.holes, PUTT_RULES.holes * MOST) && nameOk(rec.name) && whenOk(rec.at)) board.record = { total: rec.total, name: name24(rec.name), at: rec.at };
    else if (rec !== null && rec !== undefined) dropped.push('the course record');
    if (Array.isArray(raw.best)) {
      raw.best.slice(0, PUTT_RULES.holes).forEach((b, i) => {
        if (isObj(b) && intIn(b.strokes, 1, MOST) && nameOk(b.name) && whenOk(b.at)) board.best[i] = { strokes: b.strokes, name: name24(b.name), at: b.at } satisfies PuttBest;
        else if (b !== null) dropped.push(`the best on hole ${i + 1}`);
      });
    }
    if (Array.isArray(raw.aces)) {
      for (const a of raw.aces) {
        if (isObj(a) && nameOk(a.name) && intIn(a.hole, 0, PUTT_RULES.holes - 1) && whenOk(a.at)) board.aces.push({ name: name24(a.name), hole: a.hole, at: a.at } satisfies PuttAce);
        else dropped.push('a hole in one');
      }
      board.aces = board.aces.slice(0, ACES_KEPT);
    }
    if (Array.isArray(raw.rounds)) {
      for (const r of raw.rounds) {
        const ok = isObj(r) && Array.isArray(r.names) && Array.isArray(r.totals) && r.names.length === r.totals.length && r.names.length > 0 && r.names.every(nameOk) && r.totals.every((t) => intIn(t, PUTT_RULES.holes, PUTT_RULES.holes * MOST)) && whenOk(r.at);
        if (ok) board.rounds.push({ names: (r.names as string[]).map(name24), totals: [...(r.totals as number[])], at: r.at as number });
        else dropped.push('a round');
      }
      board.rounds = board.rounds.slice(0, PUTT_RULES.kept);
    }
    if (dropped.length) console.error(`agent-office: dropped from ${this.file}, which didn't make sense: ${dropped.join(', ')}`);
    this.data = board;
  }

  private cantRead(why: string) {
    this.unreadable = true;
    console.error(`agent-office: couldn't read ${this.file} (${why}): Putt Street's records start afresh, and it's set aside before they're saved`);
  }

  private save() {
    try {
      // Set aside whatever couldn't be read, rather than writing over it.
      if (this.unreadable && existsSync(this.file)) renameSync(this.file, `${this.file}.corrupt-${this.now()}`);
      this.unreadable = false;
      const tmp = `${this.file}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
      renameSync(tmp, this.file);
    } catch (err) {
      console.error(`agent-office: couldn't save ${this.file}: ${(err as Error).message}`);
    }
  }
}
