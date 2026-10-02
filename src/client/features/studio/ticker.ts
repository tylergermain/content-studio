import * as THREE from 'three';
import type { TickerState } from '../../../shared/studio';
import type { PieceView } from '../../world/office/furnish';
import type { ScreenMesh } from '../../world/office/furniture-kit';
import { BOARD_ROWS, TICKER_NOTES, boardPages, fitStrip, stripU, tickerShow, type TickerItem, type TickerShow } from './ticker-format';

// The stock ticker, wherever the floor has one: the market's prices sliding along both faces of every
// ticker bar the office builder hung (the `ticker` kind in shared/furniture.ts), and up as a table on
// every market board (`ticker-screen`). Which prices is the floor's own (see TickerSetup in
// shared/studio.ts); a floor with no symbols set has a dim line on each saying where to set them, and
// a floor with symbols and neither piece shows nothing.

const COLORS = { face: '#0c1018', text: '#f6f7f9', up: '#2df08c', down: '#ff5566', dim: '#647284', head: '#131a26', rule: '#1a2230' } as const;
const font = (weight: number, px: number) => `${weight} ${px}px 'SF Mono', ui-monospace, Menlo, Consolas, monospace`;

/** A canvas's face on a piece's material: lit by nothing, and as bright as it's painted. */
function show(mesh: ScreenMesh, texture: THREE.Texture) {
  const mat = mesh.material;
  if (mat.map === texture) return;
  // The first picture on it changes what the material's built as; the next ones don't.
  if (!mat.map) mat.needsUpdate = true;
  mat.map = texture;
  mat.color.set('#ffffff');
  mat.toneMapped = false;
}

/** An arrow head `w` wide with its middle at (x, y): up, or down. */
function arrow(g: CanvasRenderingContext2D, x: number, y: number, w: number, up: boolean) {
  const h = (w * 0.9 * (up ? 1 : -1)) / 2;
  g.beginPath();
  g.moveTo(x - w / 2, y + h);
  g.lineTo(x + w / 2, y + h);
  g.lineTo(x, y - h);
  g.closePath();
  g.fill();
}

/** Something tiled over a canvas: the gaps between a bar's LEDs, a screen's scanlines. */
function tile(g: CanvasRenderingContext2D, w: number, h: number, draw: (t: CanvasRenderingContext2D) => void, mode: GlobalCompositeOperation) {
  const cell = document.createElement('canvas');
  cell.width = w;
  cell.height = h;
  draw(cell.getContext('2d')!);
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = mode;
  g.fillStyle = g.createPattern(cell, 'repeat')!;
  g.fillRect(0, 0, g.canvas.width, g.canvas.height);
  g.restore();
}

// ---- The bar: one line of prices, sliding ----------------------------------------------------------

/**
 * How the line's painted: `px` high for a face `height` m high, in LEDs `led` px apart, each price
 * `gap` px from the next, sliding `speed` m/s (and a line that's only a note, slower).
 */
const LINE = { px: 128, height: 0.3, led: 4, size: 100, gap: 110, speed: 0.6, idle: 0.3 } as const;

/** A stretch of the line: some letters, an arrow, or room (with a dot in the middle of it, between two prices). */
type Part = { text: string; weight: number; color: string } | { arrow: boolean; color: string } | { room: number; dot?: boolean };

function parts(what: TickerShow): Part[] {
  if ('note' in what) return [{ text: what.note, weight: 600, color: COLORS.dim }, { room: LINE.gap * 3, dot: true }];
  return what.items.flatMap((it: TickerItem): Part[] => {
    const color = it.up ? COLORS.up : COLORS.down;
    return [{ text: it.name, weight: 800, color: COLORS.text }, { room: 30 }, { text: it.price, weight: 500, color: COLORS.text }, { room: 30 }, { arrow: it.up, color }, { room: 16 }, { text: it.pct, weight: 700, color }, { room: LINE.gap, dot: true }];
  });
}

const ARROW = 44;

class Line {
  private canvas = document.createElement('canvas');
  private texture: THREE.CanvasTexture | null = null;
  /** How many times as long as it's high one pass of the line is. */
  private aspect = 1;
  /** How far along it's slid, in passes. */
  private slid = 0;
  private speed: number = LINE.speed;
  private what: TickerShow = { note: TICKER_NOTES.idle };
  private stale = true;
  /** The faces already laid along the line, and how long a pass was on each when they were: a face is new again when its bar is built again. */
  private laid = new WeakMap<THREE.BufferGeometry, number>();

  /** `limit` is the longest a texture may be. */
  constructor(private limit: number) {}

  set(what: TickerShow) {
    this.what = what;
    this.stale = true;
  }

  private paint() {
    this.stale = false;
    const what = this.what;
    const list = parts(what);
    const g = this.canvas.getContext('2d')!;
    const widths = list.map((p) => {
      if ('room' in p) return p.room;
      if ('arrow' in p) return ARROW;
      g.font = font(p.weight, LINE.size);
      return g.measureText(p.text).width;
    });
    const total = widths.reduce((a, b) => a + b, 0);
    // One pass of every price is the whole texture, and it's as long as they take: it comes round with no seam.
    const { width, height } = fitStrip(total, LINE.px, this.limit, LINE.led);
    this.canvas.width = width;
    this.canvas.height = height;
    g.fillStyle = COLORS.face;
    g.fillRect(0, 0, width, height);
    g.setTransform(width / total, 0, 0, height / LINE.px, 0, 0);
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    const y = LINE.px / 2 + LINE.size * 0.06;
    // The seam falls in the room after the last price, clear of the dot there and of the first letter's glow.
    let x = 24;
    list.forEach((p, i) => {
      if ('room' in p) {
        if (p.dot) {
          g.shadowBlur = 0;
          g.fillStyle = COLORS.dim;
          g.fillRect(x + p.room / 2 - 6, LINE.px / 2 - 6, 12, 12);
        }
      } else {
        // Lit letters glow a little.
        g.shadowColor = p.color;
        g.shadowBlur = 16;
        g.fillStyle = p.color;
        if ('arrow' in p) arrow(g, x + ARROW / 2, LINE.px / 2, ARROW, p.arrow);
        else {
          g.font = font(p.weight, LINE.size);
          g.fillText(p.text, x, y);
        }
      }
      x += widths[i];
    });
    g.shadowBlur = 0;
    // The LEDs it's made of: a round dot each, and the dark between them.
    tile(
      g,
      LINE.led,
      LINE.led,
      (t) => {
        t.fillStyle = '#707070';
        t.fillRect(0, 0, LINE.led, LINE.led);
        t.fillStyle = '#ffffff';
        t.beginPath();
        t.arc(LINE.led / 2, LINE.led / 2, LINE.led * 0.46, 0, Math.PI * 2);
        t.fill();
      },
      'multiply',
    );
    // A canvas that changed size is a new texture: the old one's storage is the size it was made.
    this.texture?.dispose();
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.wrapS = THREE.RepeatWrapping;
    this.texture.anisotropy = 8;
    this.texture.offset.x = this.slid;
    this.aspect = width / height;
    this.speed = 'note' in what ? LINE.idle : LINE.speed;
  }

  /** Puts the line on a face of a bar: the stretch of it that fits the face's length, reading left to right. */
  dress(face: ScreenMesh) {
    if (this.stale) this.paint();
    show(face, this.texture!);
    const geo = face.geometry;
    const span = this.aspect * geo.parameters.height;
    if (this.laid.get(geo) === span) return;
    this.laid.set(geo, span);
    face.updateWorldMatrix(true, false);
    const mirrored = face.matrixWorld.determinant() < 0;
    const { position, uv } = geo.attributes;
    for (let i = 0; i < uv.count; i++) uv.setX(i, stripU(position.getX(i), geo.parameters.width, span, mirrored));
    uv.needsUpdate = true;
  }

  slide(dt: number) {
    if (!this.texture) return;
    this.slid = (this.slid + (dt * this.speed) / (this.aspect * LINE.height)) % 1;
    this.texture.offset.x = this.slid;
  }
}

// ---- The market board: the same prices as a table ---------------------------------------------------

/** The board's canvas, its heading and its columns' names, and how long a page stays up when there's more than one (s). */
const BOARD = { w: 1152, h: 640, head: 78, cols: 40, pad: 40, flip: 6 } as const;
/** Where each column ends (the name's starts), from the left. */
const COLUMN = { name: BOARD.pad, price: 650, change: 880, pct: BOARD.w - BOARD.pad } as const;

class Board {
  private canvas = document.createElement('canvas');
  readonly texture: THREE.CanvasTexture;
  private what: TickerShow = { note: TICKER_NOTES.idle };
  private stale = true;
  private page = 0;
  private pages = 1;
  private clock = 0;

  constructor() {
    this.canvas.width = BOARD.w;
    this.canvas.height = BOARD.h;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
  }

  set(what: TickerShow) {
    this.what = what;
    this.stale = true;
  }

  private paint() {
    this.stale = false;
    const what = this.what;
    const g = this.canvas.getContext('2d')!;
    const { w, h, head, pad } = BOARD;
    g.fillStyle = COLORS.face;
    g.fillRect(0, 0, w, h);
    g.fillStyle = COLORS.head;
    g.fillRect(0, 0, w, head);
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.font = font(800, 38);
    g.fillStyle = COLORS.text;
    g.fillText('MARKETS', pad, head / 2 + 2);
    if ('note' in what) {
      this.pages = 1;
      g.textAlign = 'center';
      g.fillStyle = COLORS.dim;
      // As big as fits across it.
      g.font = font(600, 40);
      g.font = font(600, Math.floor(Math.min(40, (40 * (w - pad * 2)) / g.measureText(what.note).width)));
      g.fillText(what.note, w / 2, head + (h - head) / 2);
    } else {
      const pages = boardPages(what.items);
      this.pages = pages.length;
      this.page %= pages.length;
      g.textAlign = 'right';
      g.font = font(500, 26);
      g.fillStyle = COLORS.dim;
      if (what.at) g.fillText(`as of ${new Date(what.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`, w - pad, head / 2 + 2);
      // Which page this is, when the prices take more than one.
      if (pages.length > 1) pages.forEach((_, i) => g.fillRect(w / 2 + (i - pages.length / 2) * 26 + 6, head / 2 - 4, 14, i === this.page ? 8 : 3));
      g.font = font(600, 22);
      const top = head + BOARD.cols;
      for (const [label, x] of [['SYMBOL', COLUMN.name], ['LAST', COLUMN.price], ['CHANGE', COLUMN.change], ['% CHANGE', COLUMN.pct]] as const) {
        g.textAlign = x === COLUMN.name ? 'left' : 'right';
        g.fillText(label, x, head + BOARD.cols / 2 + 2);
      }
      // Every page's rows are as high as the fullest one's, so nothing jumps as the pages turn.
      const row = Math.min(92, (h - top - 10) / Math.min(BOARD_ROWS, pages[0].length));
      const size = Math.round(Math.min(46, row * 0.58));
      pages[this.page].forEach((it, i) => {
        const y = top + i * row;
        const color = it.up ? COLORS.up : COLORS.down;
        g.fillStyle = i % 2 ? COLORS.face : COLORS.head;
        g.fillRect(0, y, w, row);
        g.fillStyle = COLORS.rule;
        g.fillRect(0, y, w, 2);
        g.fillStyle = color;
        g.fillRect(0, y + 2, 8, row - 2);
        const mid = y + row / 2 + 3;
        g.textAlign = 'left';
        g.font = font(800, size);
        g.fillStyle = COLORS.text;
        g.fillText(it.name, COLUMN.name, mid);
        g.textAlign = 'right';
        g.font = font(500, size);
        g.fillText(it.price, COLUMN.price, mid);
        g.fillStyle = color;
        g.fillText(`${it.up ? '+' : '−'}${it.change}`, COLUMN.change, mid);
        g.font = font(700, size);
        g.fillText(it.pct, COLUMN.pct, mid);
        arrow(g, COLUMN.pct - g.measureText(it.pct).width - size * 0.55, mid - 3, size * 0.6, it.up);
      });
    }
    // A screen's scanlines, faintly.
    tile(g, 1, 4, (t) => ((t.fillStyle = 'rgba(0, 0, 0, 0.2)'), t.fillRect(0, 3, 1, 1)), 'source-over');
    this.texture.needsUpdate = true;
  }

  dress(screen: ScreenMesh) {
    if (this.stale) this.paint();
    show(screen, this.texture);
  }

  /** Turns to the next page, when its time's up and there is one. */
  turn(dt: number) {
    this.clock += dt;
    if (this.clock < BOARD.flip) return;
    this.clock = 0;
    if (this.pages < 2) return;
    this.page = (this.page + 1) % this.pages;
    this.stale = true;
  }
}

// ---- Both, on whatever the floor has of them --------------------------------------------------------

export class MarketTicker {
  private line: Line;
  private board = new Board();
  /** What's up on the bars and on the boards, to tell when either has to be painted again. */
  private shown = { line: '', board: '' };

  /** `limit` is the longest texture the renderer takes (its capabilities.maxTextureSize). */
  constructor(limit: number) {
    this.line = new Line(Math.min(limit, 16384));
  }

  /** The floor's prices, and the symbols it asked for them by: what every bar and board shows from now on. */
  set(state: TickerState, symbols: readonly string[]) {
    const what = tickerShow(state, symbols);
    // The bar doesn't say when the prices were read, so it's only painted again when one of them moved.
    const line = JSON.stringify('note' in what ? what : what.items);
    const board = JSON.stringify(what);
    if (line !== this.shown.line) this.line.set(what);
    if (board !== this.shown.board) this.board.set(what);
    this.shown = { line, board };
  }

  /**
   * Each frame: puts the prices on every ticker piece that's out on the floor, and moves them on. A
   * piece is looked at afresh every time, since the builder adds, takes away and builds them again.
   */
  update(dt: number, pieces: Iterable<PieceView>) {
    let bars = false;
    let boards = false;
    for (const v of pieces) {
      if (v.away) continue;
      if (v.ticker) {
        for (const face of v.ticker) this.line.dress(face);
        bars = true;
      } else if (v.screen && v.piece.kind === 'ticker-screen') {
        this.board.dress(v.screen);
        boards = true;
      }
    }
    if (bars) this.line.slide(dt);
    if (boards) this.board.turn(dt);
  }
}
