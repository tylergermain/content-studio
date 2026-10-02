import type { HighScore } from '../../../shared/cabinet';
import { Blocks, H as SCREEN_H, W as SCREEN_W, paintScreen } from '../cabinet/blocks';
import { H, W, best, setBest, type ScreenGame } from './game';

/** Keys for the game, by `code`: the arcade cabinet's (see features/cabinet/ui.ts). */
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

/** The cabinet's 800×600 screen, as big as it goes on the monitor's 960×540 and centered. */
const SCALE = H / SCREEN_H;
const LEFT = (W - SCREEN_W * SCALE) / 2;

/**
 * BLOCKFALL on the boss's monitor (ui.ts): the arcade cabinet's own game and its picture
 * (features/cabinet/blocks.ts), played here on your own. It isn't the cabinet's: nobody watches it
 * there, it makes no sound in the lounge, and it's off the building's high-score table, so what it
 * keeps is your best in this browser.
 */
export class Blockfall implements ScreenGame {
  readonly id = 'blockfall';
  readonly icon = '🧱';
  readonly name = 'Blockfall';
  readonly tip = '← → move · ↑ turn · ↓ faster · Space drop · C hold · P pause';
  private blocks = new Blocks();
  private top = best(this.id);
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

  /** A new game after one that ended, or one you never got going. Any other is as you left it, paused. */
  start() {
    const b = this.blocks;
    if (b.over || (b.state === 'paused' && !b.pieces && !b.score)) this.blocks = new Blocks();
  }

  /** Stepped away: your game waits, paused. */
  leave() {
    this.blocks.pause(true);
    this.keep();
  }

  update(dt: number): boolean {
    this.blocks.update(dt);
    if (this.blocks.over) this.keep();
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
      if (k === 'go' || k === 'drop') this.blocks = new Blocks();
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
    if (this.blocks.over) this.keep();
    return true;
  }

  paint(g: CanvasRenderingContext2D) {
    this.drawn = this.blocks.version;
    // Either side of the cabinet's screen: its own backdrop carried on, scan lines and all.
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
    // Where the cabinet has the building's table, this has the one row: your best here, this game counted.
    const scores: HighScore[] = [{ game: 'best', name: 'Best here', color: '#ffd166', score: Math.max(this.top, this.blocks.score), lines: 0, level: 1, at: 0 }];
    g.save();
    g.translate(LEFT, 0);
    g.scale(SCALE, SCALE);
    paintScreen(g, { frame: this.blocks.frame(), scores, t: 0, prompt: 'ENTER: NEW GAME', note: 'P or Enter to carry on' });
    g.restore();
  }

  /** Your score so far is your best here, if it beats it. */
  private keep() {
    if (this.blocks.score <= this.top) return;
    this.top = this.blocks.score;
    setBest(this.id, this.top);
  }
}
