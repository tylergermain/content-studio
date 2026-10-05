/**
 * What the panels change on the page for as long as a VR session lasts, and put back after it.
 *
 * - Pointer capture for the controllers' two pointers (POINTER_IDS): the browser only lets an element
 *   capture a pointer it knows of, and it knows nothing of ours, so Element.prototype's
 *   set/release/hasPointerCapture keep the capture for those ids themselves (the arcade's board and the
 *   🎤 call setPointerCapture on pointerdown), and the bridge sends a captured pointer's moves to it.
 * - Links that would leave the office (another site, a new tab, a download) and window.open: the
 *   headset would drop out of VR for them, so they're held, said with a toast, and offered in a
 *   list once you're out of VR.
 */
import { h, toast } from '../../../ui/dom';
import type { Hand } from '../types';

export const POINTER_IDS: Readonly<Record<Hand, number>> = { left: 7101, right: 7102 };
const OURS = new Set(Object.values(POINTER_IDS));

type Proto = Pick<Element, 'setPointerCapture' | 'releasePointerCapture' | 'hasPointerCapture'>;

function captureEvent(el: Element, type: 'gotpointercapture' | 'lostpointercapture', id: number) {
  const view = el.ownerDocument.defaultView ?? window;
  el.dispatchEvent(new view.PointerEvent(type, { bubbles: true, pointerId: id, pointerType: 'mouse', isPrimary: true }));
}

/** The controllers' pointer captures (see the file's note). */
export class Captures {
  private readonly held = new Map<number, Element>();
  private saved: Proto | null = null;

  install(): void {
    if (this.saved) return;
    const proto = Element.prototype;
    const saved: Proto = { setPointerCapture: proto.setPointerCapture, releasePointerCapture: proto.releasePointerCapture, hasPointerCapture: proto.hasPointerCapture };
    this.saved = saved;
    const held = this.held;
    proto.setPointerCapture = function (this: Element, id: number) {
      if (!OURS.has(id)) return saved.setPointerCapture.call(this, id);
      const was = held.get(id);
      if (was === this) return;
      held.set(id, this);
      queueMicrotask(() => {
        if (was) captureEvent(was, 'lostpointercapture', id);
        captureEvent(this, 'gotpointercapture', id);
      });
    };
    proto.releasePointerCapture = function (this: Element, id: number) {
      if (!OURS.has(id)) return saved.releasePointerCapture.call(this, id);
      if (held.get(id) !== this) return;
      held.delete(id);
      queueMicrotask(() => captureEvent(this, 'lostpointercapture', id));
    };
    proto.hasPointerCapture = function (this: Element, id: number) {
      if (!OURS.has(id)) return saved.hasPointerCapture.call(this, id);
      return held.get(id) === this;
    };
  }

  /** The element that has captured pointer `id`, while it's still on the page. */
  target(id: number): Element | null {
    const el = this.held.get(id);
    if (el && !el.isConnected) this.held.delete(id);
    return el?.isConnected ? el : null;
  }

  /** A pointer let go (pointerup, or cancelled): its capture ends, as the browser's would. */
  release(id: number): void {
    const el = this.held.get(id);
    if (!el) return;
    this.held.delete(id);
    if (el.isConnected) captureEvent(el, 'lostpointercapture', id);
  }

  restore(): void {
    for (const id of [...this.held.keys()]) this.release(id);
    if (!this.saved) return;
    Object.assign(Element.prototype, this.saved);
    this.saved = null;
  }
}

interface Held { url: string; title: string }

/** Links held until you're out of VR (see the file's note). */
export class HeldLinks {
  readonly links: Held[] = [];
  private open: typeof window.open | null = null;

  install(): void {
    if (this.open) return;
    this.open = window.open;
    window.open = ((url?: string | URL) => {
      if (url) this.hold(String(url), '');
      return null;
    }) as typeof window.open;
    window.addEventListener('click', this.onClick);
  }

  private hold(href: string, title: string) {
    let url: URL;
    try {
      url = new URL(href, location.href);
    } catch {
      return;
    }
    if (!this.links.some((l) => l.url === url.href)) this.links.push({ url: url.href, title: title.trim().slice(0, 80) || url.host + url.pathname });
    toast(`Saved for after VR: ${url.host || url.href}`);
  }

  /** After everything on the page has had the click (so the office's own link handlers go first). */
  private readonly onClick = (e: MouseEvent) => {
    if (e.defaultPrevented) return;
    const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a) return;
    const href = a.href;
    if (!href || href.startsWith('javascript:')) return;
    let url: URL;
    try {
      url = new URL(href, location.href);
    } catch {
      return;
    }
    const here = url.origin === location.origin && url.pathname === location.pathname && url.search === location.search;
    // A jump within the page stays a jump; anything else (another site, a new tab, a download, another page) waits.
    if (here && !a.target && !a.hasAttribute('download')) return;
    e.preventDefault();
    this.hold(url.href, a.textContent ?? '');
  };

  /** Puts window.open back and, if any links were held, lists them over the office to open now. */
  restore(): void {
    if (this.open) window.open = this.open;
    this.open = null;
    window.removeEventListener('click', this.onClick);
    if (!this.links.length) return;
    const hud = document.getElementById('hud') ?? document.body;
    const box = h(
      'div.vr-links.panel',
      { role: 'dialog', 'aria-label': 'Links from VR' },
      h('div.vr-links-head', {}, h('b', {}, 'Links you opened in VR'), h('button.btn.close', { type: 'button', 'aria-label': 'Close', title: 'Close', onclick: () => box.remove() }, '✕')),
      h('ul', {}, ...this.links.map((l) => h('li', {}, h('a', { href: l.url, target: '_blank', rel: 'noopener noreferrer', title: l.url }, `${l.title} ↗`)))),
    );
    hud.append(box);
    this.links.length = 0;
  }
}
