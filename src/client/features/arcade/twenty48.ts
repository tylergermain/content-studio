import { FONT, H, W, banner, best, setBest, type Press, type ScreenGame } from './game';

/**
 * 2048 for the boss's monitor (ui.ts): the arrows slide every tile as far as it goes, two of the same
 * that meet become one of twice as much, and a new tile comes in after every move that moved anything.
 */
const N = 4;
const CELL = 110;
const GAP = 12;
const SIZE = N * CELL + (N + 1) * GAP;
const X0 = (W - SIZE) / 2;
const Y0 = (H - SIZE) / 2;
/** The columns either side of the board: your score on the left, your best and a new game on the right. */
const LEFT = X0 / 2;
const RIGHT = W - X0 / 2;
const AGAIN = { x: RIGHT - 82, y: 318, w: 164, h: 48 };
/** How long a tile that just came in, or was just made of two, takes to pop up to its size (seconds). */
const POP = 0.14;
const TEXT = '#f1ede4';
const DIM = '#8d99ae';
const INK = '#2b2d42';
/** A tile's color by what it's worth, 2 first. Past the end they're all the last one. */
const TILE = ['#f1ede4', '#f4dfb0', '#ffd166', '#ffb25b', '#ff8a5b', '#ef476f', '#8ecae6', '#4cc9f0', '#4f86f7', '#b388eb', '#06d6a0', '#0b1320'];
/** The ones pale enough to want dark numbers. */
const PALE = new Set([0, 1, 2, 3, 6, 7, 10]);
/** Which way each key slides the tiles: across, then down. */
const DIRS: Record<string, readonly [number, number]> = {
  ArrowLeft: [-1, 0],
  KeyA: [-1, 0],
  ArrowRight: [1, 0],
  KeyD: [1, 0],
  ArrowUp: [0, -1],
  KeyW: [0, -1],
  ArrowDown: [0, 1],
  KeyS: [0, 1],
};

/**
 * One row slid toward its start: tiles close up, and two of the same that meet become one, each tile
 * once a move (2 2 2 2 is 4 4, not 8). `gained` is what the new tiles are worth, and `merged` where they are.
 */
export function slide(row: number[]): { row: number[]; gained: number; merged: number[] } {
  const tiles = row.filter(Boolean);
  const out: number[] = [];
  const merged: number[] = [];
  let gained = 0;
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] === tiles[i + 1]) {
      merged.push(out.length);
      out.push(tiles[i] * 2);
      gained += tiles[i] * 2;
      i++;
    } else out.push(tiles[i]);
  }
  while (out.length < row.length) out.push(0);
  return { row: out, gained, merged };
}

/** The cells of line `n` from the edge the tiles slide toward: a row for left and right, a column for up and down. */
function line(n: number, dx: number, dy: number): number[] {
  return Array.from({ length: N }, (_, k) => {
    const at = dx + dy > 0 ? N - 1 - k : k;
    return dx ? n * N + at : at * N + n;
  });
}

export class Twenty48 implements ScreenGame {
  readonly id = '2048';
  readonly icon = '🔢';
  readonly name = '2048';
  readonly tip = 'Arrows or W A S D slide the tiles · same tiles merge';
  /** Row by row from the top: 0 for an empty cell, else the tile's number. */
  private tiles: number[] = [];
  /** For each cell, how long ago its tile came in or was made (seconds), while it's still popping. */
  private age: number[] = [];
  score = 0;
  /** No move left that moves anything. */
  stuck = false;
  private top = best(this.id);
  /** The mouse is on the new-game button. */
  private aimed = false;

  constructor(private readonly rng: () => number = Math.random) {
    this.reset();
  }

  /** The board as it stands. */
  get cells(): readonly number[] {
    return this.tiles;
  }

  reset() {
    this.keep();
    this.tiles = new Array<number>(N * N).fill(0);
    this.age = new Array<number>(N * N).fill(POP);
    this.score = 0;
    this.stuck = false;
    this.add();
    this.add();
  }

  /** Sitting down to it: the game as you left it, or a new one after one with no moves left. */
  start() {
    if (this.stuck) this.reset();
  }

  leave() {
    this.aimed = false;
    this.keep();
  }

  /** Slides every tile that way. False when nothing moved, which isn't a move: no new tile comes in. */
  move(dx: number, dy: number): boolean {
    if (this.stuck) return false;
    let moved = false;
    for (let n = 0; n < N; n++) {
      const at = line(n, dx, dy);
      const { row, gained, merged } = slide(at.map((i) => this.tiles[i]));
      at.forEach((i, k) => {
        if (this.tiles[i] !== row[k]) moved = true;
        this.tiles[i] = row[k];
      });
      for (const k of merged) this.age[at[k]] = 0;
      this.score += gained;
    }
    if (!moved) return false;
    this.add();
    this.stuck = !this.movable();
    if (this.stuck) this.keep();
    return true;
  }

  key(code: string, down: boolean): boolean {
    const dir = DIRS[code];
    if (!dir && code !== 'Enter') return false;
    if (!down) return true;
    if (dir) this.move(dir[0], dir[1]);
    else if (this.stuck) this.reset();
    return true;
  }

  pointer(kind: Press, x: number, y: number, e: { button: number }): boolean {
    const on = kind !== 'leave' && x >= AGAIN.x && x <= AGAIN.x + AGAIN.w && y >= AGAIN.y && y <= AGAIN.y + AGAIN.h;
    if (kind === 'down' && on && e.button === 0) {
      this.reset();
      return true;
    }
    if (on === this.aimed) return false;
    this.aimed = on;
    return true;
  }

  /** The tiles that just came in or merged pop up to their size. */
  update(dt: number): boolean {
    let popping = false;
    for (let i = 0; i < this.age.length; i++) {
      if (this.age[i] >= POP) continue;
      this.age[i] = Math.min(POP, this.age[i] + dt);
      popping = true;
    }
    return popping;
  }

  paint(g: CanvasRenderingContext2D) {
    g.fillStyle = '#1b2433';
    g.fillRect(0, 0, W, H);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#2b3a52';
    plate(g, X0, Y0, SIZE, SIZE, 18);
    for (let i = 0; i < this.tiles.length; i++) {
      const x = X0 + GAP + (i % N) * (CELL + GAP);
      const y = Y0 + GAP + Math.floor(i / N) * (CELL + GAP);
      g.fillStyle = '#34465f';
      plate(g, x, y, CELL, CELL, 12);
      if (this.tiles[i]) this.paintTile(g, i, x + CELL / 2, y + CELL / 2);
    }

    g.fillStyle = '#ffd166';
    g.font = `900 64px ${FONT}`;
    g.fillText('2048', LEFT, 110);
    readout(g, 'SCORE', this.score, LEFT);
    readout(g, 'BEST', Math.max(this.top, this.score), RIGHT);
    if (this.tiles.some((n) => n >= 2048)) {
      g.fillStyle = '#06d6a0';
      g.font = `800 20px ${FONT}`;
      g.fillText('🎉 You made 2048!', LEFT, 330);
    }
    g.fillStyle = this.aimed ? '#4a6183' : '#34465f';
    plate(g, AGAIN.x, AGAIN.y, AGAIN.w, AGAIN.h, 14);
    g.fillStyle = TEXT;
    g.font = `800 20px ${FONT}`;
    g.fillText('New game', RIGHT, AGAIN.y + AGAIN.h / 2 + 1);

    if (this.stuck) banner(g, 'No moves left', 'Enter for a new game', 'rgba(230, 57, 70, 0.92)');
  }

  private paintTile(g: CanvasRenderingContext2D, i: number, cx: number, cy: number) {
    const n = this.tiles[i];
    const rank = Math.min(TILE.length - 1, Math.log2(n) - 1);
    // Popping: from a little small up to its size, quick at first.
    const p = Math.min(1, this.age[i] / POP);
    const size = CELL * (0.7 + 0.3 * p * (2 - p));
    g.fillStyle = TILE[rank];
    plate(g, cx - size / 2, cy - size / 2, size, size, 12);
    const digits = String(n).length;
    g.fillStyle = PALE.has(rank) ? INK : '#ffffff';
    g.font = `900 ${digits <= 2 ? 54 : digits === 3 ? 44 : digits === 4 ? 36 : 28}px ${FONT}`;
    g.fillText(String(n), cx, cy + 3);
  }

  /** A 2, or now and then a 4, on a cell that's empty. */
  private add() {
    const free = this.tiles.flatMap((n, i) => (n ? [] : [i]));
    if (!free.length) return;
    const i = free[Math.floor(this.rng() * free.length)];
    this.tiles[i] = this.rng() < 0.9 ? 2 : 4;
    this.age[i] = 0;
  }

  /** Whether any move would move anything: an empty cell, or two of the same side by side. */
  private movable(): boolean {
    return this.tiles.some((n, i) => !n || (i % N < N - 1 && n === this.tiles[i + 1]) || (i + N < N * N && n === this.tiles[i + N]));
  }

  /** Your score so far is your best here, if it beats it. */
  private keep() {
    if (this.score <= this.top) return;
    this.top = this.score;
    setBest(this.id, this.top);
  }
}

function plate(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
  g.fill();
}

/** A number under its name, in one of the columns beside the board. */
function readout(g: CanvasRenderingContext2D, name: string, n: number, cx: number) {
  g.fillStyle = '#2b3a52';
  plate(g, cx - 82, 190, 164, 96, 14);
  g.fillStyle = DIM;
  g.font = `900 16px ${FONT}`;
  g.fillText(name, cx, 216);
  g.fillStyle = TEXT;
  g.font = `900 ${n < 100000 ? 38 : 30}px ${FONT}`;
  g.fillText(n.toLocaleString('en-US'), cx, 254);
}
