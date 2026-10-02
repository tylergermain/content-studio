import './ui.css';
import * as THREE from 'three';
import { h, openModal, type Modal } from '../../ui/dom';
import { H, W, type Press, type ScreenGame } from './game';

/** How much of the view (across or down, whichever runs out first) a screen fills while you play on it. */
const FILL = 0.8;

/**
 * Glides the camera up to a screen in the office while you use it, and back after. The camera looks
 * straight at the screen, so whatever is laid over it on the page is a plain centered box (see `box`).
 */
export class ScreenZoom {
  /** 0 is your own view, 1 is right up at the screen. It eases between them. */
  private zoom = 0;
  private readonly at = new THREE.Vector3();
  private readonly facing = new THREE.Quaternion();
  /** The screen's width over its height. */
  private readonly aspect: number;

  constructor(private readonly screen: THREE.Mesh) {
    const { width, height } = (screen.geometry as THREE.PlaneGeometry).parameters;
    this.aspect = width / height;
  }

  /** Anywhere between your view and the screen: your first-person hands would cover it. */
  get zoomed(): boolean {
    return this.zoom > 0;
  }

  /** How big the screen is on the page, in CSS pixels, once the camera is up at it. */
  box(): { width: number; height: number } {
    const width = Math.min(innerWidth * FILL, innerHeight * FILL * this.aspect);
    return { width, height: width / this.aspect };
  }

  /** Moves the camera toward the screen while `on`, and back after. Call it once the player has placed the camera. */
  update(camera: THREE.PerspectiveCamera, dt: number, on: boolean) {
    const want = on ? 1 : 0;
    if (this.zoom === want) {
      if (!want) return;
    } else {
      this.zoom += (want - this.zoom) * Math.min(1, dt * 8);
      if (Math.abs(want - this.zoom) < 0.002) this.zoom = want;
    }
    // Straight out from the screen, back just far enough that it fills FILL of the view, like the box does.
    const { width, height } = (this.screen.geometry as THREE.PlaneGeometry).parameters;
    const span = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * FILL;
    const back = Math.max(height / span, width / (span * camera.aspect));
    this.screen.getWorldQuaternion(this.facing);
    this.screen.localToWorld(this.at.set(0, 0, back));
    camera.position.lerp(this.at, this.zoom);
    camera.quaternion.slerp(this.facing, this.zoom);
  }
}

/** Keys no game gets: Esc closes its window, and V and M are the call's (see features/boss-desk). */
const NOT_FOR_GAMES = new Set(['Escape', 'KeyV', 'KeyM']);

/**
 * The boss's monitor, which plays the games it's handed (games.ts; what a game is, see game.ts). Pick
 * one and the camera glides up to the screen while a board you can click is laid exactly over it. The
 * camera looks straight at the screen, so that board is a plain centered box. `picture` is the same
 * game at the screen's own 960×540, kept drawn while you play, for whoever shows it somewhere else
 * (the two monitors on the boss's desk, see features/boss-desk).
 */
export class Arcade {
  private modal: Modal | null = null;
  private readonly view: ScreenZoom;
  /** The game that's open. */
  private game: ScreenGame | null = null;
  /** The game `picture` shows: the one that's open, or the one that was last. */
  private shown: ScreenGame;
  /** The game's screen as it is now. */
  readonly picture = document.createElement('canvas');
  private readonly texture = new THREE.CanvasTexture(this.picture);
  /** The board you click while playing, drawn at the size it shows on screen so it stays crisp. */
  private board: HTMLCanvasElement | null = null;

  constructor(
    screen: THREE.Mesh,
    /** The games it plays, in the order the desk's menu lists them. */
    readonly games: readonly ScreenGame[],
  ) {
    this.view = new ScreenZoom(screen);
    this.shown = games[0];
    this.picture.width = W;
    this.picture.height = H;
    this.texture.colorSpace = THREE.SRGBColorSpace;
    // What the monitor shows until something else puts its own picture there (the desk does, and
    // nothing here touches the material again, so the two don't fight over it).
    const mat = screen.material as THREE.MeshBasicMaterial;
    mat.map = this.texture;
    mat.color.set('#ffffff');
    mat.toneMapped = false;
    this.draw();
    // Canvas text only picks up the office's font once it has loaded.
    void document.fonts.ready.then(() => this.draw());
  }

  /** Anywhere between your view and the monitor: your first-person hands would cover the screen. */
  get zoomed(): boolean {
    return this.view.zoomed;
  }

  /** The game you have open, while its window is. */
  get playing(): ScreenGame | null {
    return this.game;
  }

  /** Puts it down, if you're at it (you got up, or the building changed maps under you). */
  stop() {
    this.modal?.close();
  }

  /** Opens game `id` over the monitor, with `bar` (buttons of whoever asked) in the bar under it, before its ✕ Stop playing. */
  play(id: string = this.games[0].id, bar: readonly HTMLElement[] = []) {
    const game = this.games.find((g) => g.id === id);
    if (!game) return;
    // One game at a time: picking another puts down the one that's open.
    this.modal?.close();
    game.start();
    this.game = this.shown = game;
    const board = h('canvas', { 'aria-label': `${game.name} board` });
    const stop = h('button.btn', { type: 'button' }, '✕ Stop playing');
    const box = h(
      'div.arcade',
      { role: 'dialog', 'aria-label': game.name },
      h('div.arcade-screen', {}, board),
      h('div.arcade-bar', {}, h('span', {}, `${game.icon} ${game.name}`), h('span.tip', {}, game.tip), ...bar, stop),
    );

    // The mouse on the board goes to the game, in its 960×540.
    const mouse = (kind: Press) => (e: PointerEvent) => {
      // A held left button keeps hearing the mouse past the board's edge, so letting go out there still counts.
      if (kind === 'down' && e.button === 0) board.setPointerCapture(e.pointerId);
      // Right-click flags, and so do Ctrl- and Shift-click for a trackpad.
      const flag = e.button === 2 || (e.button === 0 && (e.ctrlKey || e.shiftKey));
      if (game.pointer?.(kind, (e.offsetX * W) / board.clientWidth, (e.offsetY * H) / board.clientHeight, { button: e.button, flag })) this.draw();
    };
    board.addEventListener('pointerdown', mouse('down'));
    board.addEventListener('pointermove', mouse('move'));
    board.addEventListener('pointerup', mouse('up'));
    board.addEventListener('pointerleave', mouse('leave'));
    // No menu on right-click, and no scrolling or selecting on a click.
    board.addEventListener('contextmenu', (e) => e.preventDefault());
    board.addEventListener('mousedown', (e) => e.preventDefault());

    // The keys go to the game first, ahead of the window and the office: the ones it takes stop here.
    const held = new Set<string>();
    const onKey = (e: KeyboardEvent) => {
      if (e.type === 'keyup') {
        if (!held.delete(e.code)) return;
        game.key?.(e.code, false);
      } else if (e.metaKey || e.ctrlKey || e.altKey || NOT_FOR_GAMES.has(e.code) || typing(e)) {
        return;
      } else if (e.repeat) {
        // A key held down is the game's to repeat, on its own time rather than the keyboard's.
        if (!held.has(e.code)) return;
      } else {
        if (!game.key?.(e.code, true)) return;
        held.add(e.code);
      }
      e.preventDefault();
      e.stopPropagation();
      this.draw();
    };
    // Clicked off into another window: nothing's held any more, and the game waits for you.
    const onBlur = () => {
      held.clear();
      game.leave?.();
      this.draw();
    };

    const fit = () => {
      const { width, height } = this.view.box();
      box.style.width = `${width}px`;
      box.style.height = `${height}px`;
      board.width = Math.round(width * devicePixelRatio);
      board.height = Math.round(height * devicePixelRatio);
      this.draw();
    };
    this.board = board;
    fit();
    window.addEventListener('resize', fit);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    window.addEventListener('blur', onBlur);
    // A picture that's sent on (see `picture`) only goes out when it's drawn, so a game sitting still is drawn again now and then.
    const again = setInterval(() => this.draw(), 500);
    this.modal = openModal(box, {
      backdropCloses: false,
      doing: `${game.icon} playing ${game.name}`,
      onClose: () => {
        window.removeEventListener('resize', fit);
        window.removeEventListener('keydown', onKey, true);
        window.removeEventListener('keyup', onKey, true);
        window.removeEventListener('blur', onBlur);
        clearInterval(again);
        this.modal = this.board = this.game = null;
        game.leave?.();
        this.draw();
      },
    });
    this.modal.backdrop.classList.add('clear');
    stop.addEventListener('click', () => this.modal?.close());
  }

  /** Runs the open game, and moves the camera toward the monitor while you play and back after. Call it once the player has placed the camera. */
  update(camera: THREE.PerspectiveCamera, dt: number) {
    this.view.update(camera, dt, !!this.modal);
    if (this.game?.update?.(dt)) this.draw();
  }

  /** Draws the game on the board while you play, and on `picture` either way. */
  private draw() {
    if (this.board) paint(this.shown, this.board);
    paint(this.shown, this.picture);
    this.texture.needsUpdate = true;
  }
}

/** Draws a game's whole screen on a canvas of any size, leaving nothing of one game's brushes for the next. */
function paint(game: ScreenGame, canvas: HTMLCanvasElement) {
  const g = canvas.getContext('2d')!;
  g.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
  g.save();
  game.paint(g);
  g.restore();
}

/** Whether a key is being typed into something (a text box in a window over the game). */
function typing(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  return !!el?.closest?.('input, textarea, select, [contenteditable], .xterm');
}
