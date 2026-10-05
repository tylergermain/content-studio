/**
 * A controller's ray on a panel, as the page's own events: where the ray points on the panel is a point
 * on the page (the panel shows the live page, laid out where it is), and the element there gets what a
 * mouse would give it. Hover is pointerover/enter/move/leave/out and their mouse twins (one move a
 * frame a hand); the trigger is pointerdown + mousedown (and the focus, which a synthetic press doesn't
 * move by itself), then pointerup + mouseup + click on the element both ends share. Each hand is a
 * pointer of its own (POINTER_IDS), and an element that captures it keeps getting its moves.
 *
 * A synthetic press does none of the browser's own work, so the bridge does what's needed: a press on
 * content that doesn't take clicks drags it to scroll; the stick scrolls (a wheel event first, which a
 * page may take, then scrollBy); a <select> opens the panels' own list of options; a range takes its
 * value from where the ray is; a file, color or date picker can't open in VR and says so.
 */
import type { Hand } from '../types';
import { POINTER_IDS, type Captures } from './capture';

/** What a hand is pointing into: the panel's root, and what under it isn't the panel's. */
export interface Surface {
  root(): Element | null;
  skip(el: Element): boolean;
}

/** A client point on the page. */
export interface Point { readonly x: number; readonly y: number }

interface Picked { el: Element; x: number; y: number }

interface HandState {
  over: Element | null;
  /** What `over` would take a click on (cursor: pointer, a control), for the hover box. */
  hot: Element | null;
  last: Point | null;
  down: Element | null;
  downAt: Point | null;
  travel: number;
  noMouse: boolean;
  blocked: boolean;
  drag: { scroller: Element; last: Point; moved: number } | null;
  range: HTMLInputElement | null;
  touched: number;
}

const FOCUSABLE = 'input, textarea, select, button, a[href], summary, [tabindex], [contenteditable=""], [contenteditable="true"], iframe';
const INTERACTIVE = 'a[href], button, input, select, textarea, label, summary, option, canvas, video, [role="button"], [role="tab"], [role="link"], [role="menuitem"], [role="option"], [role="checkbox"], [role="slider"], [contenteditable=""], [contenteditable="true"], [draggable="true"], .xterm';
const NO_PICKER = /^(?:file|color|date|datetime-local|month|week|time)$/;
/** How far (CSS px) a press can wander and still be a click rather than a drag. */
const DRAG = 8;

const fresh = (): HandState => ({ over: null, hot: null, last: null, down: null, downAt: null, travel: 0, noMouse: false, blocked: false, drag: null, range: null, touched: -1 });

/** The nearest box from `el` up that can scroll the way `dy` goes (any way, for 0). */
export function scrollerOf(el: Element | null, dy = 0): Element | null {
  for (let e = el; e; e = e.parentElement) {
    const view = e.ownerDocument.defaultView ?? window;
    const oy = view.getComputedStyle(e).overflowY;
    if (!/(auto|scroll|overlay)/.test(oy) || e.scrollHeight <= e.clientHeight + 1) continue;
    if (dy > 0 && e.scrollTop + e.clientHeight >= e.scrollHeight - 1) continue;
    if (dy < 0 && e.scrollTop <= 0) continue;
    return e;
  }
  const doc = el?.ownerDocument;
  const page = doc?.scrollingElement;
  return page && page.scrollHeight > page.clientHeight + 1 && doc !== document ? page : null;
}

/** What a click on `el` would land on, for the hover box: a control, or something with a hand cursor. */
export function clickable(el: Element | null, root: Element | null): Element | null {
  for (let e = el, i = 0; e && i < 10; e = e.parentElement, i++) {
    if (e === root) break;
    if (e.matches(INTERACTIVE)) return e;
    const view = e.ownerDocument.defaultView ?? window;
    if (view.getComputedStyle(e).cursor === 'pointer') return e;
  }
  return null;
}

function common(a: Element, b: Element): Element {
  for (let e: Element | null = a; e; e = e.parentElement) if (e.contains(b)) return e;
  return a;
}

export class Bridge {
  private readonly hands: Record<Hand, HandState> = { left: fresh(), right: fresh() };
  /** The frame the host is on: a hand that wasn't pointed anywhere in it gets a leave (see settle). */
  frame = 0;

  constructor(
    private readonly caps: Captures,
    private readonly on: { select(sel: HTMLSelectElement, hand: Hand): void; say(text: string): void },
  ) {}

  /** The element a surface has at a client point (inside same-origin frames too), and the point in its own document. */
  pick(surface: Surface, p: Point): Picked | null {
    const root = surface.root();
    if (!root) return null;
    let doc: Document = document;
    let x = p.x;
    let y = p.y;
    for (let depth = 0; depth < 4; depth++) {
      let hit: Element | null = null;
      for (const e of doc.elementsFromPoint(x, y)) {
        if (doc === document && (!root.contains(e) || surface.skip(e))) continue;
        hit = e;
        break;
      }
      if (!hit) return null;
      if (hit instanceof (hit.ownerDocument.defaultView ?? window).HTMLIFrameElement) {
        let inner: Document | null = null;
        try {
          inner = hit.contentDocument;
        } catch {
          inner = null;
        }
        if (inner?.body) {
          const r = hit.getBoundingClientRect();
          x -= r.left + hit.clientLeft;
          y -= r.top + hit.clientTop;
          doc = inner;
          continue;
        }
      }
      return { el: hit, x, y };
    }
    return null;
  }

  private fire(el: Element, type: string, hand: Hand, at: Point, o: { buttons: number; related?: Element | null; detail?: number; dy?: number; quiet?: boolean } = { buttons: 0 }): boolean {
    const view = (el.ownerDocument.defaultView ?? window) as typeof window;
    const boundary = /(?:enter|leave)$/.test(type);
    const init: MouseEventInit = {
      bubbles: !boundary,
      cancelable: !boundary && !o.quiet,
      composed: true,
      view,
      clientX: at.x,
      clientY: at.y,
      screenX: at.x,
      screenY: at.y,
      button: 0,
      buttons: o.buttons,
      relatedTarget: o.related ?? null,
      detail: o.detail ?? 0,
    };
    let e: Event;
    if (type.startsWith('pointer')) e = new view.PointerEvent(type, { ...init, pointerId: POINTER_IDS[hand], pointerType: 'mouse', isPrimary: true, width: 1, height: 1, pressure: o.buttons ? 0.5 : 0 });
    else if (type === 'wheel') e = new view.WheelEvent(type, { ...init, deltaY: o.dy ?? 0, deltaMode: 0 });
    else e = new view.MouseEvent(type, init);
    return el.dispatchEvent(e);
  }

  /** What's under the hand now, captured or not, and the point in that element's document. */
  private aim(hand: Hand, surface: Surface, p: Point): Picked | null {
    const captured = this.caps.target(POINTER_IDS[hand]);
    const hit = this.pick(surface, p);
    if (captured) return { el: captured, x: hit && captured.ownerDocument === hit.el.ownerDocument ? hit.x : p.x, y: hit && captured.ownerDocument === hit.el.ownerDocument ? hit.y : p.y };
    return hit;
  }

  private hover(hand: Hand, st: HandState, el: Element | null, at: Point, root: Element | null) {
    if (el === st.over) return;
    const was = st.over;
    const b = st.down ? 1 : 0;
    if (was?.isConnected) {
      this.fire(was, 'pointerout', hand, at, { buttons: b, related: el });
      this.fire(was, 'pointerleave', hand, at, { buttons: b, related: el });
      this.fire(was, 'mouseout', hand, at, { buttons: b, related: el });
      this.fire(was, 'mouseleave', hand, at, { buttons: b, related: el });
    }
    st.over = el;
    st.hot = clickable(el, root);
    if (!el) return;
    this.fire(el, 'pointerover', hand, at, { buttons: b, related: was });
    this.fire(el, 'pointerenter', hand, at, { buttons: b, related: was });
    this.fire(el, 'mouseover', hand, at, { buttons: b, related: was });
    this.fire(el, 'mouseenter', hand, at, { buttons: b, related: was });
  }

  /** The ray is at `p` on `surface` this frame. */
  move(hand: Hand, surface: Surface, p: Point): void {
    const st = this.hands[hand];
    st.touched = this.frame;
    const hit = this.aim(hand, surface, p);
    this.hover(hand, st, hit?.el ?? null, hit ?? p, surface.root());
    if (!hit) return;
    const b = st.down ? 1 : 0;
    if (!st.last || Math.hypot(st.last.x - p.x, st.last.y - p.y) > 0.3) {
      this.fire(hit.el, 'pointermove', hand, hit, { buttons: b });
      if (!st.noMouse) this.fire(hit.el, 'mousemove', hand, hit, { buttons: b });
    }
    if (st.down && st.downAt) {
      st.travel = Math.max(st.travel, Math.hypot(p.x - st.downAt.x, p.y - st.downAt.y));
      if (st.drag && st.last) {
        st.drag.moved += Math.hypot(p.x - st.last.x, p.y - st.last.y);
        if (st.drag.moved > DRAG) st.drag.scroller.scrollBy(st.last.x - p.x, st.last.y - p.y);
      }
      if (st.range) this.slide(st.range, hit.x, 'input');
    }
    st.last = p;
  }

  /** The trigger goes down at `p`. */
  down(hand: Hand, surface: Surface, p: Point): void {
    const st = this.hands[hand];
    st.touched = this.frame;
    const hit = this.aim(hand, surface, p);
    if (!hit) return;
    const el = hit.el;
    const view = (el.ownerDocument.defaultView ?? window) as typeof window;
    Object.assign(st, { down: el, downAt: p, travel: 0, drag: null, range: null, blocked: false, noMouse: false });
    const input = el.closest('input');
    if (input && NO_PICKER.test(input.type)) {
      st.blocked = true;
      this.on.say('That picker opens after VR');
      return;
    }
    const ok = this.fire(el, 'pointerdown', hand, hit, { buttons: 1 });
    st.noMouse = !ok;
    const mouseOk = ok && this.fire(el, 'mousedown', hand, hit, { buttons: 1, detail: 1 });
    if (mouseOk) this.focus(el);
    if (input instanceof view.HTMLInputElement && input.type === 'range' && !input.disabled) {
      st.range = input;
      this.slide(input, hit.x, 'input');
    } else if (!el.closest(INTERACTIVE)) {
      const scroller = scrollerOf(el);
      if (scroller) st.drag = { scroller, last: p, moved: 0 };
    }
  }

  /** The trigger comes up at `p`. */
  up(hand: Hand, surface: Surface, p: Point): void {
    const st = this.hands[hand];
    st.touched = this.frame;
    if (!st.down) return;
    const hit = this.aim(hand, surface, p);
    const at = hit ?? p;
    const pressed = st.down;
    const target = hit?.el ?? (pressed.isConnected ? pressed : null);
    if (target && !st.blocked) {
      this.fire(target, 'pointerup', hand, at, { buttons: 0 });
      if (!st.noMouse) this.fire(target, 'mouseup', hand, at, { buttons: 0, detail: 1 });
    }
    this.caps.release(POINTER_IDS[hand]);
    const dragged = !!st.drag && st.drag.moved > DRAG;
    if (target && pressed.isConnected && !st.blocked && !dragged) {
      const on = common(pressed, target);
      const view = (on.ownerDocument.defaultView ?? window) as typeof window;
      const select = on.closest('select');
      if (select instanceof view.HTMLSelectElement) {
        if (!select.disabled) this.on.select(select, hand);
      } else if (!st.range) this.fire(on, 'click', hand, at, { buttons: 0, detail: 1 });
    }
    if (st.range) this.slide(st.range, at.x, 'change');
    Object.assign(st, { down: null, downAt: null, drag: null, range: null, travel: 0, noMouse: false, blocked: false });
  }

  /** The stick scrolls `dy` px where the ray is: the page's wheel listeners first, then the box under it. */
  wheel(hand: Hand, surface: Surface, p: Point, dy: number): void {
    if (!dy) return;
    const hit = this.pick(surface, p);
    if (!hit) return;
    if (this.fire(hit.el, 'wheel', hand, hit, { buttons: this.hands[hand].down ? 1 : 0, dy })) scrollerOf(hit.el, dy)?.scrollBy({ top: dy });
  }

  /** A hand that's off every panel: its hover ends; a press it had is cancelled. */
  leave(hand: Hand): void {
    const st = this.hands[hand];
    const at = st.last ?? { x: 0, y: 0 };
    if (st.down?.isConnected) {
      this.fire(st.down, 'pointercancel', hand, at, { buttons: 0, quiet: true });
      this.caps.release(POINTER_IDS[hand]);
    }
    this.hover(hand, st, null, at, null);
    this.hands[hand] = fresh();
  }

  /** Each frame, after every hand has had its say: one that pointed at no page gets a leave. */
  settle(): void {
    for (const hand of ['left', 'right'] as const) {
      const st = this.hands[hand];
      if (st.touched !== this.frame && (st.over || st.down)) this.leave(hand);
    }
  }

  /** What the hand is over that would take a click (for the hover box), and whether it's pressed. */
  hot(hand: Hand): Element | null {
    const el = this.hands[hand].hot;
    return el?.isConnected ? el : null;
  }

  pressing(hand: Hand): boolean {
    return !!this.hands[hand].down;
  }

  /** Moves the focus where a press would: the field, the button, a terminal's own textarea; or off a text field, onto nothing. */
  private focus(el: Element) {
    const term = el.closest('.xterm');
    const helper = term?.querySelector<HTMLElement>('.xterm-helper-textarea');
    if (helper) return helper.focus({ preventScroll: true });
    const f = el.closest(FOCUSABLE) as HTMLElement | null;
    if (f && !(f as HTMLButtonElement).disabled) {
      if (f.ownerDocument.activeElement !== f) f.focus({ preventScroll: true });
      return;
    }
    const active = el.ownerDocument.activeElement as HTMLElement | null;
    if (active && active !== el.ownerDocument.body && active.matches('input, textarea, [contenteditable=""], [contenteditable="true"]')) active.blur();
  }

  /** A range's value from the client x of the ray, and the event that says so. */
  private slide(input: HTMLInputElement, x: number, type: 'input' | 'change') {
    const r = input.getBoundingClientRect();
    const min = parseFloat(input.min || '0');
    const max = parseFloat(input.max || '100');
    const step = parseFloat(input.step) || 1;
    const f = Math.max(0, Math.min(1, (x - r.left) / Math.max(1, r.width)));
    const v = Math.round((min + f * (max - min)) / step) * step;
    if (type === 'input' && String(v) === input.value) return;
    input.value = String(v);
    input.dispatchEvent(new Event(type, { bubbles: true }));
  }

  /** Lets go of everything (the session's ending). */
  cancelAll(): void {
    this.leave('left');
    this.leave('right');
  }
}
