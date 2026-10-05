import type { CabinetFrame, GameFrame } from '../../../shared/cabinet';
import { Blocks, H as SCREEN_H, W as SCREEN_W, paintScreen } from '../cabinet/blocks';
import { H, W, rank, setBest, table, type GameSound, type ScreenGame } from './game';

/** Keys for the game, by `code`. */
const KEYS: Record<string, 'left' | 'right' | 'down' | 'turn' | 'back' | 'drop' | 'hold' | 'pause' | 'go'> = {
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  ArrowDown: 'down',
  KeyS: 'down',
  ArrowUp: 'turn',
  KeyW: 'turn',
  KeyX: 'turn',
  KeyZ: 'back',
  Space: 'drop',
  KeyC: 'hold',
  ShiftLeft: 'hold',
  ShiftRight: 'hold',
  KeyP: 'pause',
  Enter: 'go',
};

/** Its own 800×600 screen, as big as it goes on a 960×540 one and centered. */
const SCALE = H / SCREEN_H;
const LEFT = (W - SCREEN_W * SCALE) / 2;

/**
 * BLOCKFALL (see game.ts): the falling-blocks engine and its picture (features/cabinet/blocks.ts),
 * which was made for the cabinet's 4:3 tube and fills it there (`paintTube`); on the boss's monitor
 * the same picture sits in the middle. Either way it shows the building's Blockfall table, with the
 * game that's on picked out on it.
 */
export class Blockfall implements ScreenGame {
  readonly id = 'blockfall';
  office = '';
  sound?: GameSound;
  readonly icon = '🧱';
  readonly name = 'Blockfall';
  readonly tip = '← → move · ↑ turn · ↓ faster · Space drop · C hold · P pause';
  private blocks = this.fresh();
  /** Someone else's game to show instead (see `show`). */
  private shown: CabinetFrame | null = null;
  /** Its game-over sound has played. */
  private ended = false;
  /** The picture that's been drawn (see Blocks.version). */
  private drawn = -1;

  get over(): boolean {
    return this.blocks.over;
  }

  get paused(): boolean {
    return this.blocks.state === 'paused';
  }

  get score(): number {
    return this.blocks.score;
  }

  get left(): number | null {
    const b = this.blocks;
    return !b.over && (b.pieces || b.score) ? b.score : null;
  }

  /** A new game after one that ended, or one you never got going. Any other is as you left it, paused. */
  start() {
    const b = this.blocks;
    if (b.over) return this.reset();
    if (b.state !== 'paused' || b.pieces || b.score) return;
    // Never begun: its blocks start over, but to the office it's the game it was, with nothing played.
    this.blocks = this.fresh();
  }

  reset() {
    this.blocks = this.fresh();
    this.office = '';
    this.ended = false;
  }

  /** Stepped away: your game waits, paused. */
  leave() {
    this.blocks.pause(true);
  }

  update(dt: number): boolean {
    this.blocks.update(dt);
    this.finish();
    return this.blocks.version !== this.drawn;
  }

  key(code: string, down: boolean): boolean {
    const k = KEYS[code];
    const b = this.blocks;
    if (!k) return false;
    if (!down) {
      if (k === 'left') b.release(-1);
      else if (k === 'right') b.release(1);
      else if (k === 'down') b.softDrop(false);
    } else if (b.over) {
      if (k === 'go' || k === 'drop') this.reset();
    } else if (b.state === 'paused') {
      if (k === 'pause' || k === 'go') b.pause(false);
    } else if (k === 'left') b.press(-1);
    else if (k === 'right') b.press(1);
    else if (k === 'down') b.softDrop(true);
    else if (k === 'turn') b.rotate(1);
    else if (k === 'back') b.rotate(-1);
    else if (k === 'drop') b.hardDrop();
    else if (k === 'hold') b.hold();
    else if (k === 'pause') b.pause(true);
    this.finish();
    return true;
  }

  paint(g: CanvasRenderingContext2D) {
    // Either side of its own screen: the backdrop carried on, scan lines and all.
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#1b1d3a');
    bg.addColorStop(1, '#0b1320');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(0, 0, 0, 0.12)';
    for (let y = 0; y < SCREEN_H; y += 4) {
      g.fillRect(0, y * SCALE, LEFT, 1.5 * SCALE);
      g.fillRect(W - LEFT, y * SCALE, LEFT, 1.5 * SCALE);
    }
    g.save();
    g.translate(LEFT, 0);
    g.scale(SCALE, SCALE);
    this.paintTube(g);
    g.restore();
  }

  paintTube(g: CanvasRenderingContext2D, player?: string) {
    this.drawn = this.blocks.version;
    const place = rank(this.id, this.office);
    const prompt = place ? `🏆 #${place} on the table! Enter: again` : 'ENTER: NEW GAME';
    paintScreen(g, { frame: this.shown ?? this.blocks.frame(), player, scores: table(this.id), mine: this.office, prompt: this.shown ? undefined : prompt, note: this.shown ? 'Back in a moment' : 'P or Enter to carry on' });
  }

  frame(): CabinetFrame {
    return this.blocks.frame();
  }

  show(frame: GameFrame) {
    this.shown = frame as CabinetFrame;
  }

  private fresh(): Blocks {
    const b = new Blocks();
    b.onLand = (lines) => this.sound?.(lines ? 'clear' : 'land', lines);
    return b;
  }

  /** Over: it says so once, and its score is your best here if it beats it. */
  private finish() {
    if (!this.blocks.over || this.ended) return;
    this.ended = true;
    this.sound?.('over');
    setBest(this.id, this.blocks.score);
  }
}
