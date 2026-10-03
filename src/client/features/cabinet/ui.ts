import * as THREE from 'three';
import { ended, scoreOf, type CabinetFrame, type GameFrame, type GameTitle } from '../../../shared/cabinet';
import type { WorkerInfo } from '../../../shared/protocol';
import { store } from '../../state';
import { h, setDoing, toast } from '../../ui/dom';
import { openBoard, type Board } from '../arcade/board';
import type { GameSound, Press, ScreenGame } from '../arcade/game';
import type { Link } from '../arcade/link';
import { ScreenZoom } from '../arcade/ui';
import { H, W, paintCard, paintGame, paintPicker, rowAt, toGame } from './tube';

/** The keys that move the picker, by `code`. */
const STEPS: Record<string, number> = { ArrowUp: -1, KeyW: -1, ArrowDown: 1, KeyS: 1 };

/**
 * The arcade cabinet in the lounge. With nobody on it, its screen lists the arcade's games (the same
 * ones the boss's monitor plays, see features/arcade) with each one's top score. Press E there and
 * the camera glides up to the screen, where that list is the picker: choose one and it plays right
 * there, on the keyboard and the mouse. One person at a time, from your first game until you step
 * away (back at the list for another, it's still yours): everyone else on the floor sees your game on
 * the cabinet as you play, and can walk up and press E to watch it up close. One of your workers
 * needing input stops the game and says who; walking away leaves it waiting for when you come back,
 * here or on the boss's monitor. The office follows the game for the building's high scores (see Link).
 */
export class Cabinet {
  private mode: 'pick' | 'play' | 'watch' | null = null;
  private board: Board | null = null;
  private readonly view: ScreenZoom;
  /** The game you have on. */
  private game: ScreenGame | null = null;
  /** The cabinet's yours: you have a game on, or had one and are back at the list for another. */
  private held = false;
  /** The row the picker's on: the game you played here last. */
  private sel = 0;
  /** The worker whose question stopped your game. */
  private waiting: WorkerInfo | null = null;
  /** Who you're watching. */
  private watching = '';
  /** What the cabinet in the office shows. */
  private readonly picture = document.createElement('canvas');
  private readonly texture = new THREE.CanvasTexture(this.picture);
  /** Over the screen while a worker waits on you: who, and a way to its terminal. */
  private call: HTMLElement | null = null;
  /** In the bar under a game: back to the picker. */
  private back: HTMLElement | null = null;
  private dirty = true;
  private blink = -1;
  /** The last frame from whoever's playing, to hear what changed. */
  private heard: GameFrame | null = null;

  constructor(
    screen: THREE.Mesh,
    /** The arcade's games: the ones the boss's monitor plays, so a game left on either waits on both. */
    private readonly games: readonly ScreenGame[],
    private readonly link: Link,
    /** A second set, never played: someone else's game is shown on these. */
    private readonly screens: readonly ScreenGame[],
    private readonly opts: { openTerminal(workerId: string): void; sound: GameSound },
  ) {
    this.view = new ScreenZoom(screen);
    this.picture.width = 512;
    this.picture.height = 384;
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    const mat = screen.material as THREE.MeshBasicMaterial;
    mat.map = this.texture;
    mat.color.set('#ffffff');
    // Canvas text only picks up the office's font once it has loaded.
    void document.fonts.ready.then(() => (this.dirty = true));
    store.on('cabinet', () => this.onState());
    store.on('cabinetFrame', () => this.onFrame());
    store.on('workers', () => this.onWorkers());
  }

  /** Anywhere between your view and the screen: your first-person hands would cover it. */
  get zoomed(): boolean {
    return this.view.zoomed;
  }

  /** The game you have on here, while you do. */
  get playing(): ScreenGame | null {
    return this.game;
  }

  /** Puts it down, if you're at it (the building changed maps under you). */
  stop() {
    this.board?.close();
  }

  /** A game of yours that's waiting, the one you played here last before any other: which, and what it stands at. */
  get left(): { game: ScreenGame; at: number } | null {
    if (this.mode === 'play') return null;
    const game = [this.games[this.sel], ...this.games].find((g) => g.left !== null);
    return game ? { game, at: game.left! } : null;
  }

  /** E at the cabinet: up to its screen to pick a game, or to watch whoever's on it already. */
  play() {
    if (this.board || !store.floor) return;
    const p = store.cabinet.player;
    this.open(p && p.id !== store.you ? 'watch' : 'pick');
  }

  /** Picks game `id` as if from the picker, which has to be open. */
  pick(id: GameTitle) {
    const i = this.games.findIndex((g) => g.id === id);
    if (this.mode === 'play') this.toPicker();
    if (this.mode !== 'pick' || i < 0) return;
    const game = this.games[i];
    this.sel = i;
    game.start();
    game.sound = this.opts.sound;
    this.game = game;
    this.mode = 'play';
    this.held = true;
    // Asking the office to follow it is asking for the cabinet too.
    if (this.link.following !== game) this.link.follow(game, false);
    this.say();
  }

  /** One of your workers started waiting on an answer: your game stops for it, and says who. */
  needsYou(w: WorkerInfo) {
    if (this.mode !== 'play' || !this.game) return;
    this.game.leave?.();
    this.waiting = w;
    this.renderCall();
    this.dirty = true;
  }

  /** Runs the game, keeps the screens drawn and moves the camera. Call it once the player has placed the camera. */
  update(camera: THREE.PerspectiveCamera, dt: number) {
    const now = performance.now();
    if (this.mode === 'play' && this.game?.update?.(dt)) this.dirty = true;
    // The blinking "press E" with nobody playing.
    const blink = Math.floor((now / 1000) * 1.6) % 2;
    if (blink !== this.blink) {
      this.blink = blink;
      if (!this.mode && !this.other()) this.dirty = true;
    }
    if (this.dirty) this.paint();
    this.view.update(camera, dt, !!this.board);
  }

  private open(mode: 'pick' | 'watch') {
    this.mode = mode;
    this.watching = mode === 'watch' ? (store.cabinet.player?.name ?? '') : '';
    const call = h('div.cabinet-call.hidden', { role: 'status' });
    const back = h('button.btn.hidden', { type: 'button', title: 'Back to the cabinet’s games' }, '🎮 Games');
    back.addEventListener('click', () => this.toPicker());
    this.call = call;
    this.back = back;
    this.board = openBoard({
      name: 'Arcade',
      bar: [back],
      stop: mode === 'watch' ? '✕ Stop watching' : '✕ Stop playing',
      cabinet: call,
      box: () => this.view.box(),
      units: [W, H],
      key: (code, down) => this.key(code, down),
      pointer: (kind, x, y, e) => this.pointer(kind, x, y, e),
      // Clicked off into another window: the game waits for you.
      blur: () => this.game?.leave?.(),
      draw: () => (this.dirty = true),
      onClose: () => this.closed(),
    });
    this.say();
  }

  /** What the bar under the board says, for what's on it now. */
  private say() {
    const b = this.board;
    if (!b) return;
    const g = this.mode === 'watch' ? this.screenOf(store.cabinet.player?.title) : this.game;
    if (!g) b.say('🕹️ Arcade', '↑ ↓ choose · Enter plays · or click a game');
    else b.say(`${g.icon} ${g.name}`, this.mode === 'watch' ? `👀 Watching ${this.watching}` : g.tip);
    this.back?.classList.toggle('hidden', this.mode !== 'play');
    setDoing(b.modal, !g ? undefined : this.mode === 'watch' ? `👀 watching ${g.name}` : `${g.icon} playing ${g.name}`);
    this.dirty = true;
  }

  /** Back to the list, with the game you had on waiting in it. The cabinet's still yours while you choose. */
  private toPicker() {
    this.rest();
    this.mode = 'pick';
    this.say();
  }

  /** Your game stops where it is, and goes quiet. */
  private rest() {
    const g = this.game;
    this.game = null;
    this.waiting = null;
    this.renderCall();
    g?.leave?.();
    if (g) g.sound = undefined;
  }

  /** Stepped away: the office sees your game as it stands, and it waits for you, here or on the boss's monitor, with its score so far on the table. */
  private closed() {
    this.rest();
    if (this.held) this.link.drop();
    this.held = false;
    this.mode = null;
    this.board = this.call = this.back = null;
    this.watching = '';
    this.dirty = true;
  }

  private key(code: string, down: boolean): boolean {
    if (this.mode === 'play') return !!this.game?.key?.(code, down);
    if (this.mode !== 'pick') return false;
    const n = this.games.length;
    const step = STEPS[code] ?? 0;
    const digit = /^Digit[1-9]$/.test(code) && Number(code.slice(5)) <= n ? Number(code.slice(5)) - 1 : -1;
    if (!step && digit < 0 && code !== 'Enter' && code !== 'Space') return false;
    if (!down) return true;
    if (step) this.sel = (this.sel + step + n) % n;
    else this.pick(this.games[digit < 0 ? this.sel : digit].id);
    return true;
  }

  private pointer(kind: Press, x: number, y: number, e: { button: number; flag: boolean }): boolean {
    if (this.mode === 'play') return !!this.game?.pointer?.(kind, ...toGame(x, y), e);
    if (this.mode !== 'pick') return false;
    const i = kind === 'leave' ? -1 : rowAt(x, y, this.games.length);
    if (i < 0) return false;
    if (kind === 'down' && e.button === 0) this.pick(this.games[i].id);
    else if (i === this.sel) return false;
    this.sel = i;
    return true;
  }

  /** Who's at the cabinet changed, or the high scores did. */
  private onState() {
    const p = store.cabinet.player;
    this.heard = store.cabinetFrame;
    if (this.mode === 'play' || this.mode === 'pick') {
      // Someone else got there first: watch them instead.
      if (p && p.id !== store.you) {
        this.board?.close();
        this.open('watch');
      } else if (!p && this.game && !this.link.asking) {
        // The office forgot (a dropped connection): still here.
        this.link.ask();
      }
    } else if (this.mode === 'watch' && (!p || p.id === store.you || p.name !== this.watching)) {
      if (!p) toast(`${this.watching} stepped away from the arcade`);
      this.board?.close();
    } else if (this.mode === 'watch') {
      // On to another game.
      this.say();
    }
    this.dirty = true;
  }

  /** Someone else's game moved on: hear what it did. */
  private onFrame() {
    const f = store.cabinetFrame;
    const was = this.heard;
    const title = this.other()?.title;
    this.heard = f;
    this.dirty = true;
    const made = f && was && title ? noise(title, was, f) : null;
    if (made) this.opts.sound(made.kind, made.lines);
  }

  /** The worker that stopped your game got its answer from someone else. */
  private onWorkers() {
    if (!this.waiting || store.workers.get(this.waiting.id)?.status === 'needs_input') return;
    this.waiting = null;
    this.renderCall();
    this.dirty = true;
  }

  private renderCall() {
    const el = this.call;
    if (!el) return;
    const w = this.waiting;
    el.classList.toggle('hidden', !w);
    if (!w) return el.replaceChildren();
    const go = h('button.btn.primary', { type: 'button' }, '💬 Open its terminal');
    const back = h('button.btn', { type: 'button' }, '▶ Carry on');
    go.addEventListener('click', () => {
      this.board?.close();
      this.opts.openTerminal(w.id);
    });
    back.addEventListener('click', () => {
      this.waiting = null;
      this.renderCall();
    });
    el.replaceChildren(h('span', {}, `🙋 ${w.name} needs input${deskOf(w)}`), go, back);
  }

  /** Whoever else is on the cabinet. */
  private other() {
    const p = store.cabinet.player;
    return p && p.id !== store.you ? p : null;
  }

  /** The copy of game `title` that someone else's is shown on. */
  private screenOf(title: GameTitle | undefined): ScreenGame {
    return this.screens.find((s) => s.id === title) ?? this.screens[0];
  }

  /**
   * Draws the screen: your game, someone else's, or the games to pick from. Up close on the board
   * while you're at it, and on the cabinet otherwise (the close one covers it).
   */
  private paint() {
    this.dirty = false;
    const canvas = this.board?.canvas ?? this.picture;
    const g = canvas.getContext('2d')!;
    g.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    g.save();
    const other = this.other();
    if (this.mode === 'play' && this.game) paintGame(g, this.game, store.profile.name);
    else if (other) {
      const screen = this.screenOf(other.title);
      screen.office = other.game;
      if (store.cabinetFrame) screen.show(store.cabinetFrame);
      if (store.cabinetFrame) paintGame(g, screen, other.name);
      else paintCard(g, screen, other.name);
    } else if (this.mode === 'pick') paintPicker(g, this.games, this.sel, '↑ ↓ CHOOSE · ENTER PLAYS');
    else paintPicker(g, this.games, -1, this.blink ? '' : 'PRESS E TO PLAY');
    g.restore();
    if (!this.board) this.texture.needsUpdate = true;
  }
}

/** What a game being watched just did that makes a noise: the frame before, and the one that came. */
export function noise(title: GameTitle, was: GameFrame, f: GameFrame): { kind: 'land' | 'clear' | 'over'; lines?: number } | null {
  if (ended(f)) return ended(was) ? null : f.state === 'won' ? { kind: 'clear', lines: 4 } : { kind: 'over' };
  if (title === 'blockfall') {
    const [a, b] = [was as CabinetFrame, f as CabinetFrame];
    return b.lines > a.lines ? { kind: 'clear', lines: b.lines - a.lines } : b.pieces > a.pieces ? { kind: 'land' } : null;
  }
  // A snake that got longer ate, and a 2048 that scored made a tile; a Minesweeper's clock just ticks.
  return title !== 'minesweeper' && scoreOf(f) > scoreOf(was) ? { kind: 'land' } : null;
}

/** " at Desk 3", or nothing when it's not at a desk here. */
function deskOf(w: WorkerInfo): string {
  const d = store.plan().byId.get(w.deskId);
  return d ? ` at ${d.station ? `the ${d.label}` : d.label}` : '';
}
