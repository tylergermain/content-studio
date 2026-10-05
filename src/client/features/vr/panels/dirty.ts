/**
 * What of a panel needs painting again, and when it's due. The page says what changed (a
 * MutationObserver, and input, scroll, load and the end of an animation, all captured on the panel's
 * root); each change marks the box it was and is in (`lastRects`, kept by the painter), and one that
 * changes a box's size marks the whole panel, since what's around it moved. A panel is painted no
 * more often than its pace allows (a window at most every 250 ms, and at least four times what its
 * last paint cost apart), and once in a while anyway while you look at it, for what changes without
 * the DOM saying so (an animation).
 */
import { intersect, union, type Rect } from './layout';

/** Where each element was when it was last painted (client px), so a change can mark where it was too. */
export const lastRects = new WeakMap<Element, Rect>();

/** Rects to paint again, merged; or all of it. */
export class DirtyRects {
  private rects: Rect[] = [];
  full = true;

  add(r: Rect | null | undefined): void {
    if (!r || !(r.w > 0) || !(r.h > 0) || this.full) return;
    this.rects.push({ x: r.x - 2, y: r.y - 2, w: r.w + 4, h: r.h + 4 });
    if (this.rects.length > 12) this.rects = [this.rects.reduce(union)];
  }

  all(): void {
    this.full = true;
    this.rects = [];
  }

  get any(): boolean {
    return this.full || this.rects.length > 0;
  }

  /**
   * The region to paint now, within `bounds`, and forgets it: all of `bounds` when the whole panel
   * is dirty or the changes cover most of it, else the box round the changes; null when nothing in
   * `bounds` changed.
   */
  take(bounds: Rect): Rect | null {
    const full = this.full;
    const rects = this.rects;
    this.full = false;
    this.rects = [];
    if (full) return { ...bounds };
    if (!rects.length) return null;
    const box = intersect(rects.reduce(union), bounds);
    if (!box) return null;
    return box.w * box.h > bounds.w * bounds.h * 0.6 ? { ...bounds } : box;
  }
}

/** How often a kind of panel may be painted: at least `min` ms apart, `adaptive` times its last paint's cost apart, and every `safety` ms while looked at. */
export interface Pace { readonly min: number; readonly adaptive: number; readonly safety: number }
export const PACE = {
  hint: { min: 100, adaptive: 4, safety: 2000 },
  window: { min: 250, adaptive: 4, safety: 2000 },
  sheet: { min: 500, adaptive: 4, safety: 2000 },
} as const satisfies Record<string, Pace>;

/** Whether a panel is due a paint: changed (or looked at for `safety` ms since its last) and far enough past its last. */
export function due(now: number, last: number, lastCost: number, pace: Pace, dirty: boolean, lookedAt: boolean): boolean {
  if (!dirty && !(lookedAt && now - last >= pace.safety)) return false;
  return now - last >= Math.max(pace.min, pace.adaptive * lastCost);
}

const rectOf = (el: Element): Rect => {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
};

const resized = (a: Rect | undefined, b: Rect) => !!a && (Math.abs(a.w - b.w) > 1 || Math.abs(a.h - b.h) > 1);

/**
 * Watches `root` for changes and marks them in `dirty`; `skip` leaves out what isn't the panel's
 * (the HUD sheet's root is the whole page, less the windows and the canvas). Hands back the off.
 */
export function watch(root: Element, dirty: DirtyRects, skip: (el: Element) => boolean = () => false): () => void {
  const mark = (el: Element | null) => {
    if (!el || skip(el)) return;
    const now = rectOf(el);
    const was = lastRects.get(el);
    if (resized(was, now)) return dirty.all();
    dirty.add(now);
    dirty.add(was);
  };
  const mo = new MutationObserver((records) => {
    for (const r of records) {
      if (dirty.full) return;
      const el = r.target instanceof Element ? r.target : r.target.parentElement;
      if (!el || skip(el)) continue;
      if (r.type === 'childList') {
        // What came out was where it was last painted; what went in is inside its parent.
        for (const n of r.removedNodes) if (n instanceof Element) dirty.add(lastRects.get(n));
        if (r.addedNodes.length && [...r.addedNodes].some((n) => n instanceof Element && !skip(n))) {
          // A new box can push everything after it along: the parent's size says whether it did.
          if (resized(lastRects.get(el), rectOf(el))) return dirty.all();
        }
      }
      mark(el);
    }
  });
  mo.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
  const on = (e: Event) => {
    const t = e.target;
    if (t instanceof Element) mark(t);
    else dirty.all();
  };
  const types = ['input', 'change', 'scroll', 'load', 'error', 'focusin', 'focusout', 'animationend', 'transitionend'];
  for (const type of types) root.addEventListener(type, on, true);
  return () => {
    mo.disconnect();
    for (const type of types) root.removeEventListener(type, on, true);
  };
}
