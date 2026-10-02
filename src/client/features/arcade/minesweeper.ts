import { FONT, H, W, banner, type Press, type ScreenGame } from './game';

/**
 * Minesweeper for the boss's monitor (ui.ts): the rules, what the mouse does on the board, and a
 * painter that draws the whole screen in fixed 960×540 units, so the same picture goes on the monitor
 * and on the board you click.
 */
export { H, W };

/** 16 × 9 cells, the shape of the screen, with a mine under about one in seven. */
const COLS = 16;
const ROWS = 9;
const MINES = 22;
const CELL = 52;
const X0 = (W - COLS * CELL) / 2;
const Y0 = 62;
const FACE = { x: W / 2, y: 31, r: 23 };
/** The classic colors for 1 to 8 mines around. */
const NUMBER = ['', '#1f6feb', '#2a9d4b', '#e63946', '#3a3a9f', '#9d2a2a', '#1a9c9c', '#2b2d42', '#7a6f65'];

interface Cell {
  mine: boolean;
  open: boolean;
  flag: boolean;
  /** Mines in the 8 cells around it. */
  near: number;
}

export class Minesweeper implements ScreenGame {
  readonly id = 'minesweeper';
  readonly icon = '💣';
  readonly name = 'Minesweeper';
  readonly tip = 'Click to dig · right-click to flag';
  private cells: Cell[] = [];
  state: 'ready' | 'playing' | 'won' | 'lost' = 'ready';
  /** The mine that went off. */
  private boom = -1;
  /** Time played, counted only while someone's at the monitor (see tick). */
  private ms = 0;
  /** The cell under a held-down click, drawn pushed in. */
  private pressed = -1;
  /** The cell under the mouse. */
  private hover = -1;
  /** The left button is down on the board: it digs where it comes back up. */
  private holding = false;

  constructor() {
    this.reset();
  }

  reset() {
    this.cells = Array.from({ length: COLS * ROWS }, () => ({ mine: false, open: false, flag: false, near: 0 }));
    this.state = 'ready';
    this.boom = -1;
    this.ms = 0;
  }

  /** Sitting down to it: a finished game stays as it ended until then. */
  start() {
    if (this.over) this.reset();
  }

  leave() {
    this.holding = false;
    this.hover = this.pressed = -1;
  }

  /** The clock only runs while someone's at the monitor. */
  update(dt: number): boolean {
    return this.tick(dt * 1000);
  }

  pointer(kind: Press, x: number, y: number, e: { button: number; flag: boolean }): boolean {
    const i = this.cellAt(x, y);
    if (kind === 'down') {
      // Right-click flags, and so do Ctrl- and Shift-click for a trackpad. The middle button chords.
      if (e.flag) this.flag(i);
      else if (e.button === 1) this.chord(i);
      else if (e.button === 0 && this.onFace(x, y)) this.reset();
      else if (e.button === 0) {
        // It digs when you let go, wherever you let go, like the original.
        this.holding = true;
        this.pressed = i;
      }
      return true;
    }
    if (kind === 'move') {
      if (i === this.hover) return false;
      this.hover = i;
      if (this.holding) this.pressed = i;
      return true;
    }
    if (kind === 'up') {
      if (e.button !== 0 || !this.holding) return false;
      this.holding = false;
      const at = this.pressed;
      this.pressed = -1;
      // A click on a number digs around it, once its mines are all flagged.
      if (this.isOpen(at)) this.chord(at);
      else this.open(at);
      return true;
    }
    // Off the board with the button still down: it's still held (the board keeps hearing the mouse).
    if (this.holding) return false;
    this.hover = -1;
    return true;
  }

  /** The cell at a point on the screen, or -1. */
  cellAt(x: number, y: number): number {
    const c = Math.floor((x - X0) / CELL);
    const r = Math.floor((y - Y0) / CELL);
    return c >= 0 && c < COLS && r >= 0 && r < ROWS ? r * COLS + c : -1;
  }

  onFace(x: number, y: number): boolean {
    return Math.hypot(x - FACE.x, y - FACE.y) <= FACE.r + 4;
  }

  isOpen(i: number): boolean {
    return this.cells[i]?.open ?? false;
  }

  /** Digs up a cell. The first dig of a game is never a mine, and neither is anything around it. */
  open(i: number) {
    const first = this.cells[i];
    if (this.over || !first || first.open || first.flag) return;
    if (this.state === 'ready') this.lay(i);
    if (first.mine) {
      this.boom = i;
      this.state = 'lost';
      return;
    }
    // Empty cells open their neighbors too, out to the numbered edge.
    const todo = [i];
    while (todo.length) {
      const j = todo.pop()!;
      const cell = this.cells[j];
      if (cell.open || cell.flag) continue;
      cell.open = true;
      if (cell.near === 0) todo.push(...neighbors(j));
    }
    if (this.cells.every((c) => c.open || c.mine)) {
      this.state = 'won';
      for (const c of this.cells) if (c.mine) c.flag = true;
    }
  }

  flag(i: number) {
    if (this.over || i < 0 || this.cells[i].open) return;
    this.cells[i].flag = !this.cells[i].flag;
  }

  /** On a number with that many flags around it: digs up everything else around it. */
  chord(i: number) {
    const cell = this.cells[i];
    if (this.over || !cell?.open || !cell.near) return;
    const around = neighbors(i);
    if (around.filter((j) => this.cells[j].flag).length !== cell.near) return;
    for (const j of around) this.open(j);
  }

  /** Counts `dt` ms of play. True when the clock's seconds changed, so it needs drawing again. */
  tick(dt: number): boolean {
    if (this.state !== 'playing') return false;
    const before = Math.floor(this.ms / 1000);
    this.ms += dt;
    return Math.floor(this.ms / 1000) !== before;
  }

  /** Draws the whole screen. */
  paint(g: CanvasRenderingContext2D) {
    g.fillStyle = '#1b2433';
    g.fillRect(0, 0, W, H);
    g.textAlign = 'center';
    g.textBaseline = 'middle';

    // The top bar: mines left, the face (a new game), and the clock.
    const left = MINES - this.cells.filter((c) => c.flag).length;
    readout(g, X0, `💣 ${left}`);
    readout(g, W - X0 - 150, `⏱ ${Math.min(999, Math.floor(this.ms / 1000))}`);
    g.fillStyle = '#ffd166';
    g.beginPath();
    g.arc(FACE.x, FACE.y, FACE.r, 0, Math.PI * 2);
    g.fill();
    g.font = `30px ${FONT}`;
    const face = this.state === 'won' ? '😎' : this.state === 'lost' ? '😵' : this.pressed >= 0 ? '😮' : '🙂';
    g.fillText(face, FACE.x, FACE.y + 2);

    for (let i = 0; i < this.cells.length; i++) this.paintCell(g, i);

    if (this.over) {
      const won = this.state === 'won';
      banner(g, won ? `Cleared in ${Math.floor(this.ms / 1000)}s!` : 'Boom!', 'Click the face for a new game', won ? 'rgba(42, 157, 75, 0.92)' : 'rgba(230, 57, 70, 0.92)');
    }
  }

  private get over(): boolean {
    return this.state === 'won' || this.state === 'lost';
  }

  /** Puts the mines down, anywhere but `safe` and the cells around it. */
  private lay(safe: number) {
    const keep = new Set([safe, ...neighbors(safe)]);
    const spots = this.cells.map((_, i) => i).filter((i) => !keep.has(i));
    for (let n = 0; n < MINES; n++) {
      const k = n + Math.floor(Math.random() * (spots.length - n));
      [spots[n], spots[k]] = [spots[k], spots[n]];
      this.cells[spots[n]].mine = true;
    }
    this.cells.forEach((c, i) => (c.near = neighbors(i).filter((j) => this.cells[j].mine).length));
    this.state = 'playing';
  }

  private paintCell(g: CanvasRenderingContext2D, i: number) {
    const cell = this.cells[i];
    const x = X0 + (i % COLS) * CELL;
    const y = Y0 + Math.floor(i / COLS) * CELL;
    const cx = x + CELL / 2;
    const cy = y + CELL / 2 + 2;
    const lost = this.state === 'lost';
    const shown = cell.open || (lost && cell.mine && !cell.flag);
    if (shown || (i === this.pressed && !cell.flag)) {
      g.fillStyle = i === this.boom ? '#ff5a5f' : '#f1ede4';
      g.fillRect(x, y, CELL, CELL);
      g.strokeStyle = '#cfc6b4';
      g.lineWidth = 1;
      g.strokeRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1);
    } else {
      // A raised tile: light on the top and left, dark on the bottom and right.
      g.fillStyle = '#5a93b0';
      g.fillRect(x, y, CELL, CELL);
      g.fillStyle = '#c4e4f2';
      g.fillRect(x, y, CELL - 4, CELL - 4);
      g.fillStyle = i === this.hover && !this.over ? '#a9dcf0' : '#8ecae6';
      g.fillRect(x + 4, y + 4, CELL - 8, CELL - 8);
    }
    if (cell.flag) {
      g.font = `26px ${FONT}`;
      g.fillText('🚩', cx, cy);
      if (lost && !cell.mine) cross(g, cx, cy - 2);
    } else if (shown && cell.mine) {
      g.font = `28px ${FONT}`;
      g.fillText('💣', cx, cy);
    } else if (cell.open && cell.near) {
      g.fillStyle = NUMBER[cell.near];
      g.font = `900 32px ${FONT}`;
      g.fillText(String(cell.near), cx, cy);
    }
  }
}

function neighbors(i: number): number[] {
  const c = i % COLS;
  const r = Math.floor(i / COLS);
  const out: number[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const nr = r + dr;
      const nc = c + dc;
      if ((dr || dc) && nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS) out.push(nr * COLS + nc);
    }
  }
  return out;
}

/** A dark box of LED-red text in the top bar, 150 wide. */
function readout(g: CanvasRenderingContext2D, x: number, text: string) {
  g.fillStyle = '#0b1320';
  roundRect(g, x, 10, 150, 42, 10);
  g.fill();
  g.fillStyle = '#ff5a5f';
  g.font = `900 28px ${FONT}`;
  g.fillText(text, x + 75, 33);
}

/** A red ✕ over a flag that was wrong. */
function cross(g: CanvasRenderingContext2D, x: number, y: number) {
  g.strokeStyle = '#e63946';
  g.lineWidth = 5;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(x - 14, y - 14);
  g.lineTo(x + 14, y + 14);
  g.moveTo(x + 14, y - 14);
  g.lineTo(x - 14, y + 14);
  g.stroke();
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}
