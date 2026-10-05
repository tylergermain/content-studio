/**
 * The office's terminals, as the rest of the page reaches them: which worker's is open, every server
 * message passed to the one that is, and opening one (or an agent's conversation in its place). The
 * window itself is terminal-window.ts, a chunk of its own loaded the first time one opens: xterm alone
 * is a third of a megabyte, and nothing of it is needed for the office's first frame.
 */
import type { Net } from '../net';
import type { ServerMsg } from '../../shared/protocol';
import type { Modal } from './dom';

/** A line to scroll to once the terminal has loaded: a search hit (see search.ts). */
export interface TerminalFind {
  /** What was searched for, as a searchKey. */
  needle: string;
  /** How many rows from the bottom of the worker's terminal the line was. */
  fromEnd: number;
}

export interface TerminalOptions {
  /**
   * The keys a phone's keyboard hasn't got (1 2 3 for a menu, arrows, Enter, Tab, Esc, Ctrl+C) and a
   * box to send a prompt from, under the terminal, for the 2D view (lite.ts). The terminal doesn't
   * take the focus as it opens either, so a phone's keyboard stays down until you tap into it.
   */
  keypad?: boolean;
}

/** The terminal that's open, and what hears every server message for it (terminal-window.ts keeps them). */
export const terminals: {
  current: { workerId: string; modal: Modal; find(f: TerminalFind): void } | null;
  readonly listeners: Set<(msg: ServerMsg) => void>;
} = { current: null, listeners: new Set() };

/** Main feeds every server message through here so open terminals can pick theirs. */
export function routeTerminalMessage(msg: ServerMsg) {
  terminals.listeners.forEach((fn) => fn(msg));
}

export function openTerminalFor(): string | null {
  return terminals.current?.workerId ?? null;
}

/** Agent desks open their conversation and previews; shells and search hits retain the terminal. */
export function openTerminal(net: Net, workerId: string, onChanges?: () => void, find?: TerminalFind, opts: TerminalOptions = {}) {
  void import('./terminal-window').then((w) => w.openTerminalWindow(net, workerId, onChanges, find, opts));
}
