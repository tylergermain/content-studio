/**
 * Pressing keys without a keyboard, for VR: the trigger is E and the grip Space (interact.ts), the
 * keyboard panel's keys and the hint strip's chips are whatever they say (panels/). Each is a real
 * KeyboardEvent (key, code, and the old keyCode/which forced, which xterm and some of the office read)
 * dispatched where a key press would land: the focused element (inside a same-origin frame too),
 * else the page, so it goes down the office's own key chain on the window like any other.
 *
 * A dispatched key does nothing by itself in a text field (the browser only edits for real keys), so
 * tapKey does the few edits a keyboard panel needs (Backspace, Delete, the caret, Enter, Tab, Ctrl+A/Z)
 * where nothing on the page took the key first; typeText types through the editor itself, so undo and
 * the field's own listeners see it as typing.
 */
import { keyInfo } from './keys-table';

export interface KeyOpts {
  /** The key it is, when not the code's own (keys-table.ts). */
  key?: string;
  ctrl?: boolean;
  shift?: boolean;
  /** Where it goes instead of the focused element (the office's canvas, for the trigger's E). */
  target?: EventTarget;
}

/** The element that has the focus, looking inside same-origin frames; null when it's just the page. */
export function focusedElement(): HTMLElement | null {
  let el = document.activeElement as HTMLElement | null;
  for (let i = 0; el instanceof HTMLIFrameElement && i < 4; i++) {
    let inner: Document | null = null;
    try {
      inner = el.contentDocument;
    } catch {
      inner = null;
    }
    if (!inner?.activeElement) break;
    el = inner.activeElement as HTMLElement;
  }
  return !el || el === el.ownerDocument.body || el === el.ownerDocument.documentElement ? null : el;
}

/** Whether `el` takes typing: a text input or textarea that isn't read-only, or contenteditable. */
export function isEditable(el: Element | null): el is HTMLElement {
  if (!el) return false;
  if (el instanceof el.ownerDocument.defaultView!.HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (el instanceof el.ownerDocument.defaultView!.HTMLInputElement) return !el.readOnly && !el.disabled && /^(?:text|search|email|url|tel|password|number|)$/.test(el.type);
  return (el as HTMLElement).isContentEditable;
}

function fire(type: 'keydown' | 'keyup', code: string, o: KeyOpts): KeyboardEvent {
  const { key, keyCode } = keyInfo(code, !!o.shift);
  const target = o.target ?? focusedElement() ?? document.body;
  // A frame's own KeyboardEvent, so its listeners see one of theirs.
  const view = ((target as Node).ownerDocument?.defaultView ?? window) as typeof window;
  const e = new view.KeyboardEvent(type, { key: o.key ?? key, code, bubbles: true, cancelable: true, composed: true, ctrlKey: !!o.ctrl, shiftKey: !!o.shift });
  for (const p of ['keyCode', 'which'] as const) Object.defineProperty(e, p, { get: () => keyCode });
  target.dispatchEvent(e);
  return e;
}

/** Presses a key down (and holds it, until keyUp): true when something on the page took it (prevented its default). */
export function keyDown(code: string, o: KeyOpts = {}): boolean {
  return fire('keydown', code, o).defaultPrevented;
}

/** Lets a key go. */
export function keyUp(code: string, o: KeyOpts = {}): void {
  fire('keyup', code, o);
}

/** Presses a key and lets it go, doing what it would in a text field (or on a button) if nothing else took it. */
export function tapKey(code: string, o: KeyOpts = {}): void {
  const target = o.target ?? focusedElement() ?? document.body;
  const taken = keyDown(code, { ...o, target });
  if (!taken && target instanceof Element) edit(target, code, o);
  keyUp(code, { ...o, target });
}

/**
 * Types `text` where the cursor is: into xterm's own textarea as typed data, else through the
 * editor (execCommand), else by splicing the value and saying so with an input event. False when
 * nothing that takes typing has the focus (the keyboard panel then sends keys to the office).
 */
export function typeText(text: string): boolean {
  const el = focusedElement();
  if (!text || !isEditable(el)) return false;
  const view = el.ownerDocument.defaultView as typeof window;
  // xterm takes an uncomposed insertText input as typed data (see its _inputEvent).
  if (el.classList.contains('xterm-helper-textarea')) {
    el.dispatchEvent(new view.InputEvent('input', { inputType: 'insertText', data: text, bubbles: true, composed: false }));
    return true;
  }
  try {
    if (el.ownerDocument.execCommand('insertText', false, text)) return true;
  } catch {
    // no editor commands here: splice it in below
  }
  if (!(el instanceof view.HTMLInputElement || el instanceof view.HTMLTextAreaElement)) return false;
  splice(el, text);
  return true;
}

type Field = HTMLInputElement | HTMLTextAreaElement;

/** Puts `text` over the selection (or at the caret) and tells the field's listeners it was typed. */
function splice(el: Field, text: string, inputType = 'insertText') {
  const view = el.ownerDocument.defaultView as typeof window;
  try {
    const at = el.selectionStart ?? el.value.length;
    el.setRangeText(text, at, el.selectionEnd ?? at, 'end');
  } catch {
    // a field with no selection (a number): at the end
    el.value += text;
  }
  el.dispatchEvent(new view.InputEvent('input', { inputType, data: text || null, bubbles: true }));
}

/** What a real key would have done to `el`, for the keys a keyboard panel has. */
function edit(el: Element, code: string, o: KeyOpts) {
  const view = el.ownerDocument.defaultView as typeof window;
  const doc = el.ownerDocument;
  const field = el instanceof view.HTMLInputElement || el instanceof view.HTMLTextAreaElement ? (el as Field) : null;
  const typing = isEditable(el);
  // Editor commands act on whatever has the focus, so only when that's `el`.
  const command = (name: string) => {
    if (el !== focusedElement()) return false;
    try {
      return doc.execCommand(name);
    } catch {
      return false;
    }
  };
  if (code === 'Tab') {
    if (el !== doc.body) moveFocus(el, o.shift ? -1 : 1);
    return;
  }
  if (typing && o.ctrl) {
    if (code === 'KeyA' && field) field.select();
    else if (code === 'KeyA') command('selectAll');
    else if (code === 'KeyZ') command(o.shift ? 'redo' : 'undo');
    else if (code === 'KeyY') command('redo');
    return;
  }
  if (typing) {
    switch (code) {
      case 'Backspace':
      case 'Delete': {
        if (command(code === 'Backspace' ? 'delete' : 'forwardDelete') || !field) return;
        const s = field.selectionStart ?? field.value.length;
        const e = field.selectionEnd ?? s;
        if (s !== e) field.setSelectionRange(s, e);
        else if (code === 'Backspace' && s > 0) field.setSelectionRange(s - 1, s);
        else if (code === 'Delete' && s < field.value.length) field.setSelectionRange(s, s + 1);
        else return;
        splice(field, '', code === 'Backspace' ? 'deleteContentBackward' : 'deleteContentForward');
        return;
      }
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'Home':
      case 'End': {
        if (!field) return;
        try {
          const s = field.selectionStart ?? 0;
          const e = field.selectionEnd ?? s;
          const to = code === 'Home' ? 0 : code === 'End' ? field.value.length : code === 'ArrowLeft' ? (s === e ? Math.max(0, s - 1) : s) : s === e ? Math.min(field.value.length, e + 1) : e;
          field.setSelectionRange(to, to);
        } catch {
          // a field with no caret (a number)
        }
        return;
      }
      case 'Enter':
      case 'NumpadEnter':
        if (field instanceof view.HTMLInputElement) field.form?.requestSubmit();
        else if (!command('insertLineBreak') && field) splice(field, '\n', 'insertLineBreak');
        return;
    }
    return;
  }
  // Enter or Space on a button (or a link, a checkbox…) presses it.
  if ((code === 'Enter' || code === 'Space') && el.matches('button, a[href], summary, [role="button"], input[type="checkbox"], input[type="radio"], input[type="submit"], input[type="button"]')) {
    (el as HTMLElement).click();
  }
}

/** Tab: the next (or previous) thing that takes the focus, in the window you're in (or the page). */
function moveFocus(from: Element, dir: 1 | -1) {
  const root = from.closest('.backdrop') ?? from.ownerDocument.body;
  const all = [...root.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex], [contenteditable="true"]')].filter(
    (el) => el.tabIndex >= 0 && !(el as HTMLButtonElement).disabled && el.getClientRects().length > 0,
  );
  if (!all.length) return;
  const i = all.indexOf(from as HTMLElement);
  all[(i + dir + all.length) % all.length].focus();
}
