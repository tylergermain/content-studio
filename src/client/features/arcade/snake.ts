import { FONT, H, W, banner, best, setBest, type ScreenGame } from './game';

/**
 * Snake for the boss's monitor (ui.ts): it never stops, the arrows turn it, every apple makes it one
 * longer and a little quicker, and a wall or its own tail ends it.
 */
const CELL = 30;
const COLS = W / CELL;
const ROWS = H / CELL;
/** Seconds a step: where it starts, how much quicker each apple makes it, and as quick as it gets. */
const PACE = 0.14;
const QUICKER = 0.002;
const QUICKEST = 0.07;
/** How long it starts out. */
const LONG = 3;
const WAITING = 'rgba(79, 134, 247, 0.88)';

interface Cell {
  x: number;
  y: number;
}

const LEFT: Cell = { x: -1, y: 0 };
const RIGHT: Cell = { x: 1, y: 0 };
const UP: Cell = { x: 0, y: -1 };
const DOWN: Cell = { x: 0, y: 1 };
const DIRS: Record<string, Cell> = { ArrowLeft: LEFT, KeyA: LEFT, ArrowRight: RIGHT, KeyD: RIGHT, ArrowUp: UP, KeyW: UP, ArrowDown: DOWN, KeyS: DOWN };

export class Snake implements ScreenGame {
  readonly id = 'snake';
  readonly icon = '🐍';
  readonly name = 'Snake';
  readonly tip = 'Arrows or W A S D turn · eat the apples, mind the walls';
  /** Where it is, head first. */
  private body: Cell[] = [];
  private dir = RIGHT;
  /** Turns waiting for the steps they're for: two at most, so a quick corner isn't lost. */
  private turns: Cell[] = [];
  private apple: Cell = { x: 0, y: 0 };
  /** Waiting for a key (before the first move, and when you come back to it), moving, or done. */
  state: 'ready' | 'play' | 'paused' | 'over' = 'ready';
  /** Seconds until the next step. */
  private wait = 0;
  private top = best(this.id);

  constructor(private readonly rng: () => number = Math.random) {
    this.reset();
  }

  get head(): Cell {
    return this.body[0];
  }

  get food(): Cell {
    return this.apple;
  }

  get length(): number {
    return this.body.length;
  }

  reset() {
    const y = Math.floor(ROWS / 2);
    this.body = Array.from({ length: LONG }, (_, i) => ({ x: COLS / 2 - i, y }));
    this.dir = RIGHT;
    this.turns = [];
    this.wait = 0;
    this.state = 'ready';
    this.feed();
  }

  /** Sitting down to it: the game as you left it, waiting for a key, or a new one after one that ended. */
  start() {
    if (this.state === 'over') this.reset();
  }

  /** Stepped away: it stops where it is until you're back. */
  leave() {
    if (this.state === 'play') this.state = 'paused';
  }

  key(code: string, down: boolean): boolean {
    const dir = DIRS[code];
    const go = code === 'Enter' || code === 'Space';
    if (!dir && !go) return false;
    if (!down) return true;
    if (this.state === 'over') {
      if (go) this.reset();
      return true;
    }
    // Straight back into itself isn't a turn, and neither is the way it's going already.
    const going = this.turns.at(-1) ?? this.dir;
    if (dir && this.turns.length < 2 && dir.x !== going.x && dir.y !== going.y) this.turns.push(dir);
    // Any of its keys sets it off, or carries on.
    this.state = 'play';
    return true;
  }

  /** A step at a time, however long it's been (a frame that took a while is still one step). */
  update(dt: number): boolean {
    if (this.state !== 'play') return false;
    this.wait -= dt;
    if (this.wait > 0) return false;
    this.wait = Math.max(QUICKEST, PACE - (this.body.length - LONG) * QUICKER);
    this.step();
    return true;
  }

  paint(g: CanvasRenderingContext2D) {
    g.fillStyle = '#16202e';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#1a2636';
    for (let i = 0; i < COLS * ROWS; i++) {
      const x = i % COLS;
      const y = Math.floor(i / COLS);
      if ((x + y) % 2) g.fillRect(x * CELL, y * CELL, CELL, CELL);
    }
    // How long it is, and your longest here, written big across the grass behind it.
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = 'rgba(241, 237, 228, 0.07)';
    g.font = `900 260px ${FONT}`;
    g.fillText(String(this.body.length), W / 2, H / 2 - 10);
    g.fillStyle = 'rgba(241, 237, 228, 0.16)';
    g.font = `900 26px ${FONT}`;
    g.fillText(`LONGEST HERE ${Math.max(this.top, this.body.length)}`, W / 2, H - 46);

    // The apple, with its leaf.
    const ax = (this.apple.x + 0.5) * CELL;
    const ay = (this.apple.y + 0.5) * CELL;
    g.fillStyle = '#ef476f';
    g.beginPath();
    g.arc(ax, ay + 2, 11, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255, 255, 255, 0.4)';
    g.beginPath();
    g.arc(ax - 4, ay - 2, 3, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#06d6a0';
    g.beginPath();
    g.ellipse(ax + 4, ay - 10, 6, 3, -0.6, 0, Math.PI * 2);
    g.fill();

    // Tail first, so the head is on top where it ran into itself.
    const dead = this.state === 'over';
    for (let i = this.body.length - 1; i >= 0; i--) {
      const c = this.body[i];
      g.fillStyle = dead ? (i ? '#6f7f95' : '#8d99ae') : i === 0 ? '#9be7c4' : i % 2 ? '#06d6a0' : '#05b889';
      g.beginPath();
      g.roundRect(c.x * CELL + 2, c.y * CELL + 2, CELL - 4, CELL - 4, i ? 8 : 10);
      g.fill();
    }
    // Its eyes, either side of the way it's going.
    const cx = (this.head.x + 0.5) * CELL;
    const cy = (this.head.y + 0.5) * CELL;
    g.fillStyle = '#16202e';
    for (const side of [-1, 1]) {
      g.beginPath();
      g.arc(cx + this.dir.x * 5 - this.dir.y * side * 6, cy + this.dir.y * 5 + this.dir.x * side * 6, 3, 0, Math.PI * 2);
      g.fill();
    }

    // Waiting for a key: said low on the screen, clear of where the snake sets off from.
    if (this.state === 'ready') banner(g, 'Snake', 'Press an arrow to set off', WAITING, H - 120);
    else if (this.state === 'paused') banner(g, 'Paused', 'Press an arrow to carry on', WAITING, H - 120);
    else if (dead) banner(g, this.body.length === COLS * ROWS ? 'Nowhere left to go!' : 'Ouch!', `${this.body.length} long · Enter for a new game`, 'rgba(230, 57, 70, 0.92)');
  }

  private step() {
    this.dir = this.turns.shift() ?? this.dir;
    const head = { x: this.head.x + this.dir.x, y: this.head.y + this.dir.y };
    const eats = head.x === this.apple.x && head.y === this.apple.y;
    // The tail moves out of the way as the head moves in, unless it just ate.
    const tail = eats ? this.body : this.body.slice(0, -1);
    if (head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS || tail.some((c) => c.x === head.x && c.y === head.y)) return this.end();
    this.body.unshift(head);
    if (eats) this.feed();
    else this.body.pop();
  }

  /** A new apple, anywhere the snake isn't. With nowhere left, it has the whole screen: that's the game. */
  private feed() {
    const taken = new Set(this.body.map((c) => c.y * COLS + c.x));
    const free: number[] = [];
    for (let i = 0; i < COLS * ROWS; i++) if (!taken.has(i)) free.push(i);
    if (!free.length) return this.end();
    const i = free[Math.floor(this.rng() * free.length)];
    this.apple = { x: i % COLS, y: Math.floor(i / COLS) };
  }

  private end() {
    this.state = 'over';
    if (this.body.length <= this.top) return;
    this.top = this.body.length;
    setBest(this.id, this.top);
  }
}
