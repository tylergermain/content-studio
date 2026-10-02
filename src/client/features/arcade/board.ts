import './ui.css';
import { h, openModal, type Modal } from '../../ui/dom';
import type { Press } from './game';

/** Keys no game gets: Esc closes its window, and V and M are the call's (see features/boss-desk). */
const NOT_FOR_GAMES = new Set(['Escape', 'KeyV', 'KeyM']);

export interface BoardOpts {
  /** What the window is called, and what teammates see you doing while it's open. */
  name: string;
  doing?: string;
  /** In the bar under the board: what's on it and how it's played (see `say`), then these, then the button that closes it. */
  bar?: readonly (HTMLElement | null)[];
  stop: string;
  /** The cabinet's, with the note that sits over it (a worker of yours needs you). */
  cabinet?: HTMLElement;
  /** How big the board is on the page, in CSS pixels (see ScreenZoom.box), and the units its mouse is told in. */
  box(): { width: number; height: number };
  units: readonly [number, number];
  /** A key went down or came back up. True when it was taken: it goes no further. */
  key?(code: string, down: boolean): boolean;
  pointer?(kind: Press, x: number, y: number, e: { button: number; flag: boolean }): boolean;
  /** Clicked off into another window: nothing's held any more. */
  blur?(): void;
  /** The board wants drawing: it changed size, or a key or the mouse changed the picture. */
  draw(): void;
  onClose(): void;
}

export interface Board {
  readonly modal: Modal;
  /** The canvas to draw on, at the size it shows on the page so it stays crisp. */
  readonly canvas: HTMLCanvasElement;
  /** What the bar says is on the board, and how it's played. */
  say(title: string, tip: string): void;
  close(): void;
}

/**
 * A board laid exactly over a screen in the office while the camera is up at it (see ScreenZoom in
 * ui.ts), with a bar under it: the window both of the arcade's hosts play in. The keys go to the game
 * first, ahead of the window and the office, and the mouse on the board goes to it in its own units.
 */
export function openBoard(opts: BoardOpts): Board {
  const canvas = h('canvas', { 'aria-label': `${opts.name} board` });
  const stop = h('button.btn', { type: 'button' }, opts.stop);
  const title = h('span');
  const tip = h('span.tip');
  const box = h(
    opts.cabinet ? 'div.arcade.cabinet' : 'div.arcade',
    { role: 'dialog', 'aria-label': opts.name },
    h('div.arcade-screen', {}, canvas),
    opts.cabinet ?? null,
    h('div.arcade-bar', {}, title, tip, ...(opts.bar ?? []), stop),
  );

  const [uw, uh] = opts.units;
  const mouse = (kind: Press) => (e: PointerEvent) => {
    // A held left button keeps hearing the mouse past the board's edge, so letting go out there still counts.
    if (kind === 'down' && e.button === 0) canvas.setPointerCapture(e.pointerId);
    // Right-click flags, and so do Ctrl- and Shift-click for a trackpad.
    const flag = e.button === 2 || (e.button === 0 && (e.ctrlKey || e.shiftKey));
    if (opts.pointer?.(kind, (e.offsetX * uw) / canvas.clientWidth, (e.offsetY * uh) / canvas.clientHeight, { button: e.button, flag })) opts.draw();
  };
  canvas.addEventListener('pointerdown', mouse('down'));
  canvas.addEventListener('pointermove', mouse('move'));
  canvas.addEventListener('pointerup', mouse('up'));
  canvas.addEventListener('pointerleave', mouse('leave'));
  // No menu on right-click, and no scrolling or selecting on a click.
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('mousedown', (e) => e.preventDefault());

  const held = new Set<string>();
  const onKey = (e: KeyboardEvent) => {
    if (e.type === 'keyup') {
      if (!held.delete(e.code)) return;
      opts.key?.(e.code, false);
    } else if (e.metaKey || e.ctrlKey || e.altKey || NOT_FOR_GAMES.has(e.code) || typing(e)) {
      return;
    } else if (e.repeat) {
      // A key held down is the game's to repeat, on its own time rather than the keyboard's.
      if (!held.has(e.code)) return;
    } else {
      if (!opts.key?.(e.code, true)) return;
      held.add(e.code);
    }
    e.preventDefault();
    e.stopPropagation();
    opts.draw();
  };
  const onBlur = () => {
    held.clear();
    opts.blur?.();
    opts.draw();
  };
  const fit = () => {
    const { width, height } = opts.box();
    box.style.width = `${width}px`;
    box.style.height = `${height}px`;
    canvas.width = Math.round(width * devicePixelRatio);
    canvas.height = Math.round(height * devicePixelRatio);
    opts.draw();
  };

  const modal = openModal(box, {
    backdropCloses: false,
    doing: opts.doing,
    onClose: () => {
      window.removeEventListener('resize', fit);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
      window.removeEventListener('blur', onBlur);
      opts.onClose();
    },
  });
  modal.backdrop.classList.add('clear');
  stop.addEventListener('click', () => modal.close());
  window.addEventListener('resize', fit);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('keyup', onKey, true);
  window.addEventListener('blur', onBlur);
  const board: Board = {
    modal,
    canvas,
    say(what, how) {
      title.textContent = what;
      tip.textContent = how;
    },
    close: () => modal.close(),
  };
  // Sized once whoever opened it has it in hand: drawing it is theirs to do.
  queueMicrotask(fit);
  return board;
}

/** Whether a key is being typed into something (a text box in a window over the game). */
function typing(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  return !!el?.closest?.('input, textarea, select, [contenteditable], .xterm');
}
