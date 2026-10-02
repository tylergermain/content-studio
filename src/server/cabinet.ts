import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CLEAR_POINTS, GAME_TITLES, SNAKE_START, WELL_ROWS, beats, checkFrame, checkScore, ended, levelFor, tableOf, tables, titleOf, type Frames, type GameFrame, type GameTitle, type HighScore } from '../shared/cabinet.js';

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * The arcade's high-score tables: one per game for the whole building, on every floor's cabinet and
 * on the boss's monitor, saved in the office's .agent-office/arcade.json so they're still there after
 * a restart. The file is one list, as it was when Blockfall was the only game: each score says which
 * game it's at, and one that doesn't is Blockfall's, so the scores from before carry over as its table.
 */
export class HighScores {
  private list: HighScore[] = [];
  private file: string;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'arcade.json');
    this.load();
  }

  /** Every game's table, one after another (in GAME_TITLES order), each best first. */
  top(): HighScore[] {
    return this.list;
  }

  /**
   * Games' scores as they stand, saved together. Each goes on its game's table if it's good enough,
   * and the same game again only ever betters its own score (nobody else's). Says whether a table
   * changed, and which game just took first place on its table from another one, if one did.
   */
  record(...scores: Omit<HighScore, 'at'>[]): { changed: boolean; first: HighScore | null } {
    const before = this.list;
    let next = before;
    for (const s of scores) {
      const was = next.find((e) => e.game === s.game);
      if (s.score <= 0 || (was && (was.name !== s.name || !beats(titleOf(s), s.score, was.score)))) continue;
      const after = tables([...next.filter((e) => e !== was), { ...s, at: Date.now() }]);
      if (after.some((e) => e.game === s.game)) next = after;
    }
    if (next === before) return { changed: false, first: null };
    this.list = next;
    this.save();
    const leader = (list: HighScore[], t: GameTitle): HighScore | undefined => tableOf(list, t)[0];
    const first = GAME_TITLES.map((t) => leader(next, t)).find((l) => l && l.game !== leader(before, titleOf(l))?.game && scores.some((s) => s.game === l.game));
    return { changed: true, first: first ?? null };
  }

  private load() {
    if (!existsSync(this.file)) return;
    try {
      const saved = JSON.parse(readFileSync(this.file, 'utf8')) as unknown;
      if (!Array.isArray(saved)) return;
      for (const e of saved as Partial<HighScore>[]) {
        const s = e && typeof e === 'object' ? checkScore(e) : null;
        if (!s || typeof e.name !== 'string' || !e.name || typeof e.at !== 'number' || !Number.isFinite(e.at)) continue;
        this.list.push({ ...s, name: e.name.slice(0, 24), color: typeof e.color === 'string' && COLOR_RE.test(e.color) ? e.color : '#4f86f7', at: e.at });
      }
      this.list = tables(this.list);
    } catch {
      // a broken file just means a fresh table
    }
  }

  private save() {
    try {
      writeFileSync(this.file, JSON.stringify(this.list, null, 2), { mode: 0o600 });
    } catch {
      // disk issues shouldn't take the office down
    }
  }
}

/**
 * The fastest a player lands pieces, per second, over all their games: about as fast as anyone keeps
 * it up on these keys (a line a second, if every one went in a four-line clear). And how many more
 * they can land in a burst on top of that.
 */
export const PIECES_PER_SECOND = 2.5;
export const PIECE_BURST = 10;
/** The same for 2048's moves (a key press each) and Snake's steps (its quickest is one every 70 ms). */
export const MOVES_PER_SECOND = 8;
export const MOVE_BURST = 16;
export const STEPS_PER_SECOND = 15;
export const STEP_BURST = 30;
/** The fastest anyone clears Minesweeper's field, in seconds, and how far (ms) the office's clock lets a browser's run behind it. */
export const WIN_FLOOR = 3;
export const CLOCK_SLACK = 1500;
/** New games of one title a player can start in a row that go on its table, and how often (ms) another one can after that. */
export const GAME_BURST = 3;
export const GAME_EVERY = 20_000;
/**
 * The most a piece scores on its way down: the one before it soft-dropped the whole well (a point a
 * row) and then held, and this one hard-dropped the whole well (2 a row).
 */
export const DROP_POINTS = 3 * (WELL_ROWS + 2);
/** The high-score tables change (arcade.json written, every floor told) at most this often, in ms. */
export const RECORD_EVERY = 2000;
/** Games kept waiting for their players to come back to them, at most. */
const GAMES_KEPT = 100;
/** Players an Allowance keeps track of before it forgets the ones back to a full allowance. */
const PLAYERS_KEPT = 256;

/** Whose game it is (an account, or a name on the shared password) and how it shows on the table. */
export interface Player {
  owner: string;
  name: string;
  color: string;
  /** The connection it's played over: a new name on it is the same player to the office. */
  connection?: string;
}

/**
 * The most `lines` lines can score, cleared by `pieces` pieces landing after `before` lines: each
 * landing clears up to four at once, for their CLEAR_POINTS times the level it's on then. -Infinity
 * if that many pieces can't clear that many lines.
 */
export function clearPoints(before: number, lines: number, pieces: number): number {
  if (!lines) return 0;
  if (lines > pieces * 4) return -Infinity;
  // most[n]: the most the first n of the lines score, cleared in `landings` landings exactly.
  let most = [0, ...new Array<number>(lines).fill(-Infinity)];
  let best = -Infinity;
  for (let landings = 1; landings <= Math.min(pieces, lines); landings++) {
    const was = most;
    most = was.map((_, n) => {
      let m = -Infinity;
      for (let k = 1; k <= Math.min(4, n); k++) m = Math.max(m, was[n - k] + CLEAR_POINTS[k] * levelFor(before + n - k));
      return m;
    });
    best = Math.max(best, most[lines]);
  }
  return best;
}

/** The most 2048's tiles can have scored: each as if made of nothing but 2s, every merge on the way counted. */
export function tilePoints(tiles: readonly number[]): number {
  return tiles.reduce((sum, n) => sum + (n ? n * (Math.log2(n) - 1) : 0), 0);
}

/**
 * Something a player can only do so often: `burst` times in a row, and then again as it comes back
 * at `perSecond`. It's kept under each thing they go by (their account or name, and their
 * connection), so a new game, a new name or a new connection doesn't start them over.
 */
class Allowance {
  private readonly used = new Map<string, { left: number; at: number }>();

  constructor(
    private readonly burst: number,
    private readonly perSecond: number,
  ) {}

  /** What's left for the player going by `keys`: the least under any of them. */
  left(keys: readonly string[]): number {
    const now = Date.now();
    return Math.min(...keys.map((k) => this.leftAt(k, now)));
  }

  take(keys: readonly string[], n: number) {
    if (!n) return;
    const now = Date.now();
    for (const k of keys) this.used.set(k, { left: this.leftAt(k, now) - n, at: now });
    // Anyone back to a full allowance is the same as someone never seen.
    if (this.used.size > PLAYERS_KEPT) for (const k of [...this.used.keys()]) if (this.leftAt(k, now) >= this.burst) this.used.delete(k);
  }

  private leftAt(key: string, now: number): number {
    const u = this.used.get(key);
    return u ? Math.min(this.burst, u.left + ((now - u.at) / 1000) * this.perSecond) : this.burst;
  }
}

/** How a game stands, from its last frame that added up. */
interface Progress {
  /** As its table counts it (see TITLES): 0 for nothing to show yet. */
  score: number;
  /** What takes its player time: pieces landed, tiles slid, steps the snake took. */
  steps: number;
  /** Blockfall's lines and level, and the most its cleared lines could have scored between them. */
  lines: number;
  level: number;
  clears: number;
}

interface Game extends Player, Progress {
  id: string;
  title: GameTitle;
  /** What its player goes by, for their allowances. */
  keys: string[];
  /** Minesweeper's clock, which is the office's own: ms in play before this sitting, and when this sitting's play began. */
  ms: number;
  since: number | null;
  /** Someone's at it; otherwise it waits for its player to come back to it. */
  playing: boolean;
  /** One too many new games in a row: it's followed like any other, but it never goes on the table. */
  counts: boolean;
  /** The score last put up for the table. */
  offered: number;
}

/** What the office made of a frame: it added up, it didn't (and its game is off the table for good), or there's no game of theirs to follow. */
export type Verdict = 'ok' | 'void' | 'none';

/**
 * The office's side of the arcade, for the cabinet and the boss's monitor alike. It starts every
 * game, follows each one frame by frame and puts the scores on the high-score tables itself, so a
 * browser can't post a score it didn't play for, or one at a game the office doesn't know.
 *
 * A Blockfall frame adds up when nothing in it went down, its level is the one its lines make, it
 * hasn't cleared more lines than its pieces could fill or scored more than they (and the lines,
 * cleared the best way they could have been) could, and its player has landed no more pieces than
 * PIECES_PER_SECOND lets them, give or take a PIECE_BURST, across all their games. The others are held
 * the same way to what they are: 2048 scores no more than its tiles are worth, has no more on the
 * board than its moves brought in, and moves no faster than MOVES_PER_SECOND; a snake is no longer
 * than its steps could have fed it, at STEPS_PER_SECOND; and a Minesweeper win takes as long as the
 * office's own clock saw it take, WIN_FLOOR at the least. A game with a frame that doesn't add up
 * never goes on the table again, and nor does one started after GAME_BURST others of its title in a
 * row (a Minesweeper is counted when it's won: most are over in a click or two). However many games
 * end at once, the tables change at most every RECORD_EVERY ms.
 */
export class Arcade {
  private readonly games = new Map<string, Game>();
  /** Scores waiting to go on the table, by game, with the floor each was played on. */
  private readonly pending = new Map<string, { score: Omit<HighScore, 'at'>; floor: string }>();
  private readonly paces: Record<GameTitle, Allowance | null> = {
    blockfall: new Allowance(PIECE_BURST, PIECES_PER_SECOND),
    '2048': new Allowance(MOVE_BURST, MOVES_PER_SECOND),
    snake: new Allowance(STEP_BURST, STEPS_PER_SECOND),
    minesweeper: null,
  };
  private readonly starts = Object.fromEntries(GAME_TITLES.map((t) => [t, new Allowance(GAME_BURST, 1000 / GAME_EVERY)])) as Record<GameTitle, Allowance>;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private recordedAt = -Infinity;

  constructor(
    private readonly table: HighScores,
    /** A table changed. `first` is a game that just took first place on its own, and the floor it was played on. */
    private readonly changed: (first: { score: HighScore; floor: string } | null) => void,
  ) {}

  /** `player` sits down to `title`: back to game `resume` if it's theirs, that game, and waiting for them, else a new game. Says which. */
  start(player: Player, resume?: unknown, title: GameTitle = 'blockfall'): string {
    const keys = [player.owner, ...(player.connection ? [`connection:${player.connection}`] : [])];
    const was = typeof resume === 'string' ? this.games.get(resume) : undefined;
    if (was && was.owner === player.owner && was.title === title && !was.playing) {
      was.playing = true;
      was.keys = keys;
      // Played again: the last to go when there are too many.
      this.games.delete(was.id);
      this.games.set(was.id, was);
      return was.id;
    }
    this.prune();
    const id = randomBytes(8).toString('hex');
    const late = title === 'minesweeper';
    const counts = late || this.starts[title].left(keys) >= 1;
    if (counts && !late) this.starts[title].take(keys, 1);
    this.games.set(id, { ...player, id, title, keys, score: 0, steps: 0, lines: 0, level: 1, clears: 0, ms: 0, since: null, playing: true, counts, offered: 0 });
    return id;
  }

  /** Whether game `id` can go on the table: false for one started after too many others in a row (and one that's gone). */
  counts(id: string | undefined): boolean {
    return !!(id && this.games.get(id)?.counts);
  }

  /** A frame from the player of game `id`, on `floor`. A game's last frame puts its score up for the table. */
  frame(id: string | undefined, raw: GameFrame, floor: string): Verdict {
    const g = id === undefined ? undefined : this.games.get(id);
    if (!g || !g.playing) return 'none';
    // Whatever it was sent as, it's only followed as a frame of the game it's for.
    const f = checkFrame(raw, g.title);
    const next = f && this.adds(g, f);
    if (!f || !next) {
      this.games.delete(g.id);
      return 'void';
    }
    this.paces[g.title]?.take(g.keys, next.steps - g.steps);
    Object.assign(g, next);
    if (ended(f)) {
      this.offer(g, floor);
      this.games.delete(g.id);
    }
    return 'ok';
  }

  /** The player of game `id` stepped away from it on `floor` (or left the office): it waits for them, with its score so far up for the table. */
  leave(id: string | undefined, floor: string) {
    const g = id === undefined ? undefined : this.games.get(id);
    if (!g || !g.playing) return;
    g.playing = false;
    // Its clock stops while nobody's at it.
    if (g.since !== null) g.ms += Date.now() - g.since;
    g.since = null;
    this.offer(g, floor);
  }

  /** Puts the scores waiting on the table now. */
  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.pending.size) return;
    this.recordedAt = Date.now();
    const waiting = [...this.pending.values()];
    this.pending.clear();
    const { changed, first } = this.table.record(...waiting.map((w) => w.score));
    if (changed) this.changed(first && { score: first, floor: waiting.find((w) => w.score.game === first.game)!.floor });
  }

  /** How game `g` stands after frame `f`, if it adds up from where it stood. */
  private adds(g: Game, f: GameFrame): Progress | null {
    const left = this.paces[g.title]?.left(g.keys) ?? Infinity;
    if (g.title === 'blockfall') {
      const b = f as Frames['blockfall'];
      const pieces = b.pieces - g.steps;
      const lines = b.lines - g.lines;
      if (pieces < 0 || lines < 0 || b.score < g.score || pieces > left || b.lines * 10 > b.pieces * 4 || b.level !== levelFor(b.lines)) return null;
      const clears = g.clears + clearPoints(g.lines, lines, pieces);
      return b.score > DROP_POINTS * (b.pieces + 1) + clears ? null : { score: b.score, steps: b.pieces, lines: b.lines, level: b.level, clears };
    }
    const same = { lines: 0, level: 1, clears: 0 };
    if (g.title === '2048') {
      const t = f as Frames['2048'];
      const moves = t.moves - g.steps;
      // Two tiles to start with and one more a move, a 4 at the most.
      const worth = t.tiles.reduce((a, b) => a + b, 0);
      if (moves < 0 || moves > left || t.score < g.score || worth > 4 * (t.moves + 2) || t.score > tilePoints(t.tiles)) return null;
      return { ...same, score: t.score, steps: t.moves };
    }
    if (g.title === 'snake') {
      const s = f as Frames['snake'];
      const steps = s.steps - g.steps;
      const long = s.body.length;
      // An apple a step at the most, and it never gets shorter. One that hasn't eaten has nothing to show.
      if (steps < 0 || steps > left || long < g.score || long - SNAKE_START > s.steps) return null;
      return { ...same, score: long > SNAKE_START ? long : 0, steps: s.steps };
    }
    const m = f as Frames['minesweeper'];
    const now = Date.now();
    if (m.state === 'playing' && g.since === null) g.since = now;
    if (m.state !== 'won') return { ...same, score: 0, steps: 0 };
    // Won: this is when it counts as a new game, and it took what the office's clock says it took.
    if (g.counts && this.starts[g.title].left(g.keys) < 1) g.counts = false;
    else if (g.counts) this.starts[g.title].take(g.keys, 1);
    const took = g.ms + (g.since === null ? 0 : now - g.since);
    return { ...same, score: Math.max(m.seconds, WIN_FLOOR, Math.floor((took - CLOCK_SLACK) / 1000)), steps: 0 };
  }

  private offer(g: Game, floor: string) {
    if (!g.counts || !g.score || g.score === g.offered) return;
    g.offered = g.score;
    const score = { game: g.id, ...(g.title === 'blockfall' ? {} : { title: g.title }), name: g.name, color: g.color, score: g.score, lines: g.lines, level: g.level };
    this.pending.set(g.id, { score, floor });
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), Math.max(0, this.recordedAt + RECORD_EVERY - Date.now()));
    this.timer.unref?.();
  }

  /** Makes room for a new game, by dropping the ones left waiting longest. */
  private prune() {
    for (const g of this.games.values()) {
      if (this.games.size < GAMES_KEPT) return;
      if (!g.playing) this.games.delete(g.id);
    }
  }
}
