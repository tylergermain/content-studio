/**
 * The DOM painter: draws the live, laid-out page onto a canvas for a VR panel, element by element, from
 * what the browser says of each (getBoundingClientRect, getComputedStyle, a Range's boxes for text),
 * so a point on the panel is exactly the element there. It walks in paint order the way CSS stacks it,
 * roughly: an element's background and border, then the text and boxes in its flow, then whatever is
 * positioned (or see-through, or transformed) in it, by z-index; overflow clips (rounded) and opacity
 * carry down. What it leaves out: shadows, backdrop blur (a window's glass gets an opaque base instead),
 * transforms beyond their boxes, and <canvas> / <video>, which are live quads of their own over the
 * panel (see panel.ts). A paint is a generator, so it can stop after any element and go on next frame:
 * PaintJob.step paints until a deadline.
 */
import { lastRects } from './dirty';
import { intersect, overlaps, type Rect } from './layout';
import {
  contentBox,
  drawBackground,
  drawControl,
  drawPicture,
  drawPseudos,
  drawScrollbar,
  fillGradient,
  fontOf,
  picture,
  placeholder,
  radiiOf,
  roundPath,
  sameOrigin,
  svgPicture,
  urlOf,
  visible,
} from './paint-parts';

type G = CanvasRenderingContext2D;

export interface PaintOpts {
  /** What's painted: this element and what's in it. */
  readonly root: Element;
  /** The client rect the canvas shows of it (a segment of a panel: see panel.ts). */
  readonly src: Rect;
  /** Where `src`'s top left goes on the canvas, in CSS px (the canvas is `scale` times that). */
  readonly dst: { readonly x: number; readonly y: number };
  readonly scale: number;
  /** The client rect to paint again (the rest of the canvas is left as it is). */
  readonly region: Rect;
  /** An opaque color under the root's own (rounded) box: a window's glass, which has nothing to blur in VR. */
  readonly base?: string | null;
  /** Whether the root's own background is painted (not the page's body, whose sky-blue is the canvas's). */
  readonly rootBox?: boolean;
  /** The element with the focus, which gets a ring (and a text field its caret). */
  readonly focus?: Element | null;
  /** What isn't part of the panel (the office's canvas, the windows, for the HUD sheet). */
  skip?(el: Element): boolean;
  /** Each box that painted something (client px): a sheet lets the ray through where nothing did. */
  ink?(r: Rect): void;
  /** A picture it wanted has come in: paint again. */
  again?(): void;
}

interface ClipRect { readonly r: Rect; readonly radii: number[] }
/** The clips in force (each a rounded rect) and the box they leave. */
interface Clip { readonly list: readonly ClipRect[]; readonly box: Rect }
interface Deferred { el: Element; cs: CSSStyleDeclaration; z: number; seq: number; clip: Clip; alpha: number }

/** Elements whose content is theirs to draw (or nobody's): their children aren't walked. */
const LEAVES = new Set(['img', 'svg', 'canvas', 'video', 'iframe', 'input', 'textarea', 'select', 'progress', 'meter', 'object', 'embed', 'audio', 'script', 'style', 'template', 'noscript', 'head']);
const CONTROLS = new Set(['input', 'textarea', 'select', 'progress', 'meter']);
const FOCUS_RING = 'rgba(0, 113, 227, .55)';

const metrics = new Map<string, { asc: number; desc: number }>();
function metricsOf(g: G): { asc: number; desc: number } {
  let m = metrics.get(g.font);
  if (!m) {
    const t = g.measureText('Hgjy');
    m = { asc: t.fontBoundingBoxAscent || t.actualBoundingBoxAscent, desc: t.fontBoundingBoxDescent || t.actualBoundingBoxDescent };
    if (metrics.size > 200) metrics.clear();
    metrics.set(g.font, m);
  }
  return m;
}

/** Whether an element paints after its flow, stacked by z-index: positioned, see-through or transformed. */
function layered(cs: CSSStyleDeclaration): boolean {
  return cs.position !== 'static' || parseFloat(cs.opacity) < 1 || cs.transform !== 'none';
}

const rectOf = (el: Element): Rect => {
  const b = el.getBoundingClientRect();
  return { x: b.left, y: b.top, w: b.width, h: b.height };
};

function transformed(text: string, how: string): string {
  if (how === 'uppercase') return text.toUpperCase();
  if (how === 'lowercase') return text.toLowerCase();
  if (how === 'capitalize') return text.replace(/(^|\s)(\S)/g, (_m, a: string, b: string) => a + b.toUpperCase());
  return text;
}

/** One document's walk (the page's, or a same-origin frame's inside it, offset by `ox`, `oy`). */
class Walk {
  private seq = 0;
  private applied: Clip | null = null;
  private readonly range: Range;
  private readonly view: Window;

  constructor(
    private readonly g: G,
    private readonly o: PaintOpts,
    private readonly doc: Document,
    private readonly ox: number,
    private readonly oy: number,
  ) {
    this.range = doc.createRange();
    this.view = doc.defaultView ?? window;
  }

  private ink(r: Rect) {
    this.o.ink?.({ x: r.x + this.ox, y: r.y + this.oy, w: r.w, h: r.h });
  }

  /** Puts `c`'s clips in force (they stay, saved once, until another set is wanted). */
  private clipTo(c: Clip) {
    if (this.applied === c) return;
    const g = this.g;
    if (this.applied) g.restore();
    g.save();
    for (const k of c.list) {
      roundPath(g, k.r, k.radii);
      g.clip();
    }
    this.applied = c;
  }

  /** Lets go of the clips in force. */
  release() {
    if (this.applied) this.g.restore();
    this.applied = null;
  }

  /** A stacking context: `el` and its flow, then what's layered in it, by z-index. */
  *context(el: Element, cs: CSSStyleDeclaration, clip: Clip, alpha: number, own = true): Generator<void, void, void> {
    const deferred: Deferred[] = [];
    yield* this.flow(el, cs, clip, alpha, deferred, own);
    deferred.sort((a, b) => a.z - b.z || a.seq - b.seq);
    for (const d of deferred) yield* this.context(d.el, d.cs, d.clip, d.alpha);
  }

  private *flow(el: Element, cs: CSSStyleDeclaration, clip: Clip, alpha: number, deferred: Deferred[], own = true): Generator<void, void, void> {
    const r = rectOf(el);
    lastRects.set(el, r);
    const opacity = parseFloat(cs.opacity);
    const a = alpha * (Number.isFinite(opacity) ? opacity : 1);
    if (a < 0.01) return;
    const sized = r.w > 0 && r.h > 0;
    if (sized && !overlaps(r, clip.box)) return;
    const name = el.localName;
    const shown = cs.visibility === 'visible';
    if (shown && sized && own) this.box(el, cs, r, a, clip, name);
    yield;
    if (name === 'iframe') {
      if (shown && sized) yield* this.frame(el as HTMLIFrameElement, cs, r, clip, a);
      return;
    }
    if (LEAVES.has(name)) return;

    let inner = clip;
    const clips = cs.overflowX !== 'visible' || cs.overflowY !== 'visible';
    if (clips && sized) {
      const pad = { x: r.x + (parseFloat(cs.borderLeftWidth) || 0), y: r.y + (parseFloat(cs.borderTopWidth) || 0), w: el.clientWidth || r.w, h: el.clientHeight || r.h };
      const box = intersect(clip.box, pad);
      if (!box) return;
      inner = { list: [...clip.list, { r: pad, radii: radiiOf(cs, r) }], box };
    }
    for (let n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) {
        if (shown) yield* this.text(n as Text, cs, inner, a);
        continue;
      }
      if (n.nodeType !== 1) continue;
      const c = n as Element;
      if (this.o.skip?.(c)) continue;
      const ccs = this.view.getComputedStyle(c);
      if (ccs.display === 'none') continue;
      if (layered(ccs)) deferred.push({ el: c, cs: ccs, z: ccs.zIndex === 'auto' ? 0 : parseInt(ccs.zIndex, 10) || 0, seq: this.seq++, clip: inner, alpha: a });
      else yield* this.flow(c, ccs, inner, a, deferred);
    }
    if (!shown || !sized) return;
    if (clips && (cs.overflowY === 'auto' || cs.overflowY === 'scroll')) {
      this.clipTo(clip);
      this.g.globalAlpha = a;
      drawScrollbar(this.g, el, r);
    }
    if (el === this.o.focus && !CONTROLS.has(name)) this.ring(r, cs, clip);
  }

  /** An element's own paint: background, border, and what a leaf shows. */
  private box(el: Element, cs: CSSStyleDeclaration, r: Rect, a: number, clip: Clip, name: string) {
    const g = this.g;
    this.clipTo(clip);
    g.globalAlpha = a;
    const radii = radiiOf(cs, r);
    let inked = false;
    if (visible(cs.backgroundColor)) {
      roundPath(g, r, radii);
      g.fillStyle = cs.backgroundColor;
      g.fill();
      inked = true;
    }
    const bg = cs.backgroundImage;
    if (bg && bg !== 'none') {
      roundPath(g, r, radii);
      if (fillGradient(g, bg, r)) inked = true;
      else {
        const url = urlOf(bg);
        const img = url ? picture(url, this.doc.baseURI, () => this.o.again?.(), !sameOrigin(url, this.doc.baseURI)) : null;
        if (img) {
          g.save();
          roundPath(g, r, radii);
          g.clip();
          drawBackground(g, img, r, cs);
          g.restore();
          inked = true;
        }
      }
    }
    if (this.border(cs, r, radii)) inked = true;

    if (name === 'img') {
      const img = el as HTMLImageElement;
      const src = img.currentSrc || img.src;
      const box = contentBox(cs, r);
      if (src) {
        const own = sameOrigin(src, this.doc.baseURI) || !!img.crossOrigin;
        const pic = own ? (img.complete && img.naturalWidth ? img : null) : picture(src, this.doc.baseURI, () => this.o.again?.(), true);
        if (pic) {
          g.save();
          roundPath(g, r, radii);
          g.clip();
          drawPicture(g, pic, box, cs.objectFit);
          g.restore();
        } else if (!own || img.complete) placeholder(g, box, img.alt);
        inked = true;
      }
    } else if (name === 'svg') {
      const pic = svgPicture(el as SVGSVGElement, r, cs.color, () => this.o.again?.());
      if (pic) g.drawImage(pic, r.x, r.y, r.w, r.h);
      inked = true;
    } else if (name === 'canvas' || name === 'video') {
      // A live quad of its own goes over it (panel.ts).
      inked = true;
    } else if (CONTROLS.has(name)) {
      if (drawControl(g, el, cs, r, el === this.o.focus)) inked = true;
      if (el === this.o.focus) this.ring(r, cs, clip);
    } else if (!el.firstElementChild) drawPseudos(g, el, r);
    if (inked) this.ink(r);
  }

  /** The border: one rounded stroke when every side's the same, else each side as a bar. True when it drew. */
  private border(cs: CSSStyleDeclaration, r: Rect, radii: number[]): boolean {
    const g = this.g;
    const sides = [
      [cs.borderTopWidth, cs.borderTopStyle, cs.borderTopColor],
      [cs.borderRightWidth, cs.borderRightStyle, cs.borderRightColor],
      [cs.borderBottomWidth, cs.borderBottomStyle, cs.borderBottomColor],
      [cs.borderLeftWidth, cs.borderLeftStyle, cs.borderLeftColor],
    ].map(([w, s, c]) => ({ w: s === 'none' || s === 'hidden' ? 0 : parseFloat(w) || 0, s, c }));
    if (!sides.some((x) => x.w > 0 && visible(x.c))) return false;
    const [t, rt, b, l] = sides;
    if (sides.every((x) => x.w === t.w && x.c === t.c && x.s === t.s)) {
      const w = t.w;
      g.lineWidth = w;
      g.strokeStyle = t.c;
      g.setLineDash(t.s === 'dashed' ? [w * 3, w * 2] : t.s === 'dotted' ? [w, w] : []);
      roundPath(g, { x: r.x + w / 2, y: r.y + w / 2, w: r.w - w, h: r.h - w }, radii.map((x) => Math.max(0, x - w / 2)));
      g.stroke();
      g.setLineDash([]);
      return true;
    }
    const bar = (s: { w: number; c: string }, x: number, y: number, w: number, h: number) => {
      if (!(s.w > 0) || !visible(s.c)) return;
      g.fillStyle = s.c;
      g.fillRect(x, y, w, h);
    };
    bar(t, r.x, r.y, r.w, t.w);
    bar(b, r.x, r.y + r.h - b.w, r.w, b.w);
    bar(l, r.x, r.y, l.w, r.h);
    bar(rt, r.x + r.w - rt.w, r.y, rt.w, r.h);
    return true;
  }

  /** The focus ring, as :focus-visible draws it. */
  private ring(r: Rect, cs: CSSStyleDeclaration, clip: Clip) {
    const g = this.g;
    this.clipTo(clip);
    g.globalAlpha = 1;
    g.lineWidth = 3;
    g.strokeStyle = FOCUS_RING;
    roundPath(g, { x: r.x - 1.5, y: r.y - 1.5, w: r.w + 3, h: r.h + 3 }, radiiOf(cs, r).map((x) => x + 1.5));
    g.stroke();
  }

  /** A text node, in its parent's font and color: as one run where it's on one line, else word by word where the browser put each. */
  private *text(node: Text, cs: CSSStyleDeclaration, clip: Clip, a: number): Generator<void, void, void> {
    const data = node.data;
    const pre = cs.whiteSpace.startsWith('pre') || cs.whiteSpace === 'break-spaces';
    if (!/\S/.test(data) || !visible(cs.color)) return;
    const g = this.g;
    const font = fontOf(cs);
    const style = () => {
      this.clipTo(clip);
      g.globalAlpha = a;
      g.font = font;
      g.fillStyle = cs.color;
      g.letterSpacing = cs.letterSpacing === 'normal' ? '0px' : cs.letterSpacing;
    };
    style();
    const range = this.range;
    let at = 0;
    for (const part of pre ? data.split('\n') : [data]) {
      const from = at;
      at += part.length + 1;
      if (!/\S/.test(part)) continue;
      range.setStart(node, from);
      range.setEnd(node, from + part.length);
      const rects = range.getClientRects();
      if (!rects.length) continue;
      if (rects.length === 1) {
        this.run(part, rects[0], pre, cs, clip);
        continue;
      }
      // Wrapped: each word where it went.
      const words = /\S+/g;
      let n = 0;
      for (let m = words.exec(part); m; m = words.exec(part)) {
        range.setStart(node, from + m.index);
        range.setEnd(node, from + m.index + m[0].length);
        const rs = range.getClientRects();
        if (!rs.length) continue;
        if (rs.length === 1 || m[0].length > 80) this.run(m[0], rs[0], true, cs, clip);
        else {
          // A word broken across lines (a long link): letter by letter.
          for (let i = 0; i < m[0].length; i++) {
            range.setStart(node, from + m.index + i);
            range.setEnd(node, from + m.index + i + 1);
            const c = range.getClientRects()[0];
            if (c) this.run(m[0][i], c, true, cs, clip);
          }
        }
        if (++n % 60 === 0) {
          yield;
          style();
        }
      }
    }
  }

  /** One run of text in the box the browser gave it. */
  private run(raw: string, b: DOMRect, keep: boolean, cs: CSSStyleDeclaration, clip: Clip) {
    const r = { x: b.left, y: b.top, w: b.width, h: b.height };
    if (!(r.w > 0) || !overlaps(r, clip.box)) return;
    const g = this.g;
    let text = transformed(keep ? raw : raw.replace(/\s+/g, ' '), cs.textTransform);
    if (!keep && /^\s|\s$/.test(text)) {
      // Spaces the browser collapsed away at a line's ends: the version that fits the box.
      const options = [text, text.trimStart(), text.trimEnd(), text.trim()];
      text = options.reduce((best, t) => (Math.abs(g.measureText(t).width - r.w) < Math.abs(g.measureText(best).width - r.w) ? t : best));
    }
    const room = clip.box.x + clip.box.w - r.x;
    if (cs.textOverflow === 'ellipsis' && r.x + r.w > clip.box.x + clip.box.w + 1 && room > 0) {
      while (text.length > 1 && g.measureText(`${text}…`).width > room) text = text.slice(0, -1);
      text = `${text.trimEnd()}…`;
    }
    const m = metricsOf(g);
    const base = r.y + (r.h - (m.asc + m.desc)) / 2 + m.asc;
    g.fillText(text, r.x, base);
    if (cs.textDecorationLine.includes('underline')) {
      g.fillStyle = visible(cs.textDecorationColor) ? cs.textDecorationColor : cs.color;
      g.fillRect(r.x, base + 1.5, Math.min(r.w, g.measureText(text).width), Math.max(1, (parseFloat(cs.fontSize) || 14) / 14));
      g.fillStyle = cs.color;
    }
    this.ink(r);
  }

  /** A same-origin frame, painted from its own document; another origin's is a titled placeholder. */
  private *frame(el: HTMLIFrameElement, cs: CSSStyleDeclaration, r: Rect, clip: Clip, a: number): Generator<void, void, void> {
    const box = contentBox(cs, r);
    let doc: Document | null = null;
    try {
      doc = el.contentDocument;
    } catch {
      doc = null;
    }
    const g = this.g;
    if (!doc?.body || !doc.defaultView) {
      this.clipTo(clip);
      g.globalAlpha = a;
      let host = '';
      try {
        host = new URL(el.src, this.doc.baseURI).host;
      } catch {
        host = '';
      }
      placeholder(g, box, `${el.title || host || 'Embedded page'} · after VR`);
      this.ink(box);
      return;
    }
    const region = intersect(clip.box, box);
    if (!region) return;
    this.release();
    g.save();
    try {
      for (const k of clip.list) {
        roundPath(g, k.r, k.radii);
        g.clip();
      }
      g.beginPath();
      g.rect(box.x, box.y, box.w, box.h);
      g.clip();
      g.translate(box.x, box.y);
      const inner = new Walk(g, this.o, doc, this.ox + box.x, this.oy + box.y);
      const root = doc.documentElement;
      try {
        yield* inner.context(root, doc.defaultView.getComputedStyle(root), { list: [], box: { x: region.x - box.x, y: region.y - box.y, w: region.w, h: region.h } }, a);
      } finally {
        inner.release();
      }
    } finally {
      g.restore();
    }
  }
}

function* paintAll(g: G, o: PaintOpts): Generator<void, void, void> {
  const region = intersect(o.region, o.src);
  if (!region) return;
  g.save();
  try {
    g.setTransform(o.scale, 0, 0, o.scale, (o.dst.x - o.src.x) * o.scale, (o.dst.y - o.src.y) * o.scale);
    g.beginPath();
    g.rect(region.x, region.y, region.w, region.h);
    g.clip();
    g.clearRect(region.x, region.y, region.w, region.h);
    const view = o.root.ownerDocument.defaultView ?? window;
    const cs = view.getComputedStyle(o.root);
    if (o.base) {
      const r = rectOf(o.root);
      g.fillStyle = o.base;
      roundPath(g, r, radiiOf(cs, r));
      g.fill();
    }
    const walk = new Walk(g, o, o.root.ownerDocument, 0, 0);
    try {
      yield* walk.context(o.root, cs, { list: [], box: region }, 1, o.rootBox !== false);
    } finally {
      walk.release();
    }
  } finally {
    g.restore();
  }
}

/** A paint under way, a slice at a time: `step` paints until the deadline, `cost` is the ms it has taken so far. */
export class PaintJob {
  done = false;
  cost = 0;
  private readonly it: Generator<void, void, void>;

  constructor(g: G, opts: PaintOpts) {
    this.it = paintAll(g, opts);
  }

  /** Paints until `until` (performance.now()): true once it's finished. */
  step(until: number): boolean {
    if (this.done) return true;
    const t0 = performance.now();
    try {
      do {
        if (this.it.next().done) {
          this.done = true;
          break;
        }
      } while (performance.now() < until);
    } catch (err) {
      this.done = true;
      console.warn('VR: a panel failed to paint', err);
    } finally {
      this.cost += performance.now() - t0;
    }
    return this.done;
  }

  /** Stops it where it is (the canvas's state put back). */
  cancel(): void {
    if (this.done) return;
    this.done = true;
    try {
      this.it.return();
    } catch {
      // already finishing
    }
  }
}
