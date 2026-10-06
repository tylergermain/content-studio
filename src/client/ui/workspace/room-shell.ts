import './room.css';
import { h, openModal } from '../dom';

// The frame every full-screen review room is built in (see room.css), the way Frame.io frames an asset: a top bar
// with ✕, the file's name and the worker's, a middle and a right of the room's own; the stage; and the notes down the
// right, which F hides. Esc goes to the room first (a note being written, a mode), and closes the room if it doesn't
// take it. It opens over the worker's window, so closing it goes back there.

export interface RoomShell {
  root: HTMLElement;
  name: HTMLElement;
  sub: HTMLElement;
  /** The top bar's left (after the name), middle and right, for the room's own controls. */
  left: HTMLElement;
  middle: HTMLElement;
  right: HTMLElement;
  stage: HTMLElement;
  /** Puts the notes (or whatever the room has) down the right. */
  side(el: HTMLElement): void;
  theater(on?: boolean): void;
  close(): void;
}

const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export function openRoomShell(o: {
  className: string;
  label: string;
  doing: string;
  /** A key not typed into anything: true when the room used it. */
  key?(e: KeyboardEvent): boolean;
  /** Esc: true when the room used it (to put a note away, to leave a mode), else the room closes. */
  escape?(e: KeyboardEvent): boolean;
  onClose(): void;
}): RoomShell {
  const close = h('button.rr-close', { type: 'button', 'aria-label': 'Close', title: 'Close (Esc)' }, '✕');
  const name = h('strong');
  const sub = h('span');
  const left = h('div.rr-left', {}, close, h('div.rr-title', {}, name, sub));
  const middle = h('div.rr-nav');
  const right = h('div.rr-right');
  const stage = h('div.rr-stage');
  const body = h('div.rr-body', {}, stage);
  const root = h(`div.review-room.${o.className}`, { role: 'dialog', 'aria-label': o.label, tabindex: '-1' }, h('header.rr-top', {}, left, middle, right), body);

  function onKey(e: KeyboardEvent) {
    if (document.getElementById('modal-root')?.lastElementChild !== modal.backdrop) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (o.escape?.(e)) return;
      if (typing(e.target)) return (e.target as HTMLElement).blur();
      return modal.close();
    }
    if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      return theater();
    }
    if (o.key?.(e)) e.preventDefault();
  }
  function theater(on = !root.classList.contains('theater')) {
    root.classList.toggle('theater', on);
  }

  window.addEventListener('keydown', onKey, true);
  const modal = openModal(root, {
    escCloses: false,
    closeButton: false,
    doing: o.doing,
    onClose: () => {
      window.removeEventListener('keydown', onKey, true);
      o.onClose();
    },
  });
  close.addEventListener('click', () => modal.close());
  requestAnimationFrame(() => root.focus({ preventScroll: true }));
  return {
    root,
    name,
    sub,
    left,
    middle,
    right,
    stage,
    side: (el) => body.append(el),
    theater,
    close: () => modal.close(),
  };
}

/** The top bar's status and Approve, as the other rooms have them: Approve asks for a second click, then `approve` runs. */
export function approveControls(o: { workerName: string; approve(): Promise<void> }) {
  const pill = h('span.rr-state');
  const button = h('button.rr-approve', { type: 'button' });
  let confirming = false, timer = 0, label = '', approved = false, can = true;
  function paint() {
    button.textContent = approved ? '✓ Approved' : confirming ? `Approve ${label}? Click again` : 'Approve';
    button.classList.toggle('on', approved);
    button.disabled = approved || !can;
    button.title = approved ? `${label} is approved: ${o.workerName} was told it’s final.` : `Tell ${o.workerName} ${label} is final. Nothing is published, moved or renamed.`;
  }
  button.addEventListener('click', async () => {
    if (approved) return;
    if (!confirming) {
      confirming = true;
      paint();
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        confirming = false;
        paint();
      }, 4000);
      return;
    }
    confirming = false;
    button.disabled = true;
    try {
      await o.approve();
    } finally {
      paint();
    }
  });
  return {
    pill,
    button,
    /** Where the file's review stands. */
    set(s: { status: 'new' | 'changes' | 'approved'; label: string; can: boolean }) {
      if (s.label !== label) confirming = false;
      label = s.label;
      approved = s.status === 'approved';
      can = s.can;
      pill.textContent = s.status === 'approved' ? 'Approved' : s.status === 'changes' ? 'Changes requested' : 'Needs review';
      pill.dataset.state = s.status;
      paint();
    },
  };
}
