/**
 * The painter's leaves (see paint.ts): what an element shows besides its box and its text. Pictures
 * (an <img>, a CSS background picture, an inline <svg> drawn as its own little image), gradients (a
 * line through the box like the browser's, or their first color), form controls drawn from their
 * values (a text field's words or placeholder and caret, a checkbox, a select's choice, a range's
 * thumb), short ::before / ::after content and the scrollbar a scrolling box would show. Nothing
 * drawn here may taint the canvas, or the texture upload would fail: a picture from another origin is
 * fetched again with CORS, and stays a placeholder where that's refused.
 */
import type { Rect } from './layout';

type G = CanvasRenderingContext2D;

// ---- Shapes -------------------------------------------------------------------------------------

/** Each corner's radius (tl, tr, br, bl) in px, from the computed style, no more than half the box. */
export function radiiOf(cs: CSSStyleDeclaration, r: Rect): number[] {
  const max = Math.min(r.w, r.h) / 2;
  return [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius].map((v) => {
    const n = parseFloat(v) || 0;
    return Math.max(0, Math.min(max, v.includes('%') ? (n / 100) * Math.min(r.w, r.h) : n));
  });
}

export function roundPath(g: G, r: Rect, radii: readonly number[]): void {
  g.beginPath();
  if (radii.some((x) => x > 0)) g.roundRect(r.x, r.y, r.w, r.h, radii as number[]);
  else g.rect(r.x, r.y, r.w, r.h);
}

/** Whether a computed color draws anything. */
export function visible(color: string): boolean {
  return !!color && color !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(color);
}

// ---- Gradients ------------------------------------------------------------------------------------

/** Splits `s` at its top-level commas (not the ones inside rgb(...)). */
export function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let at = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') depth--;
    else if (s[i] === ',' && depth === 0) {
      out.push(s.slice(at, i).trim());
      at = i + 1;
    }
  }
  out.push(s.slice(at).trim());
  return out.filter(Boolean);
}

const COLOR = /(rgba?\([^)]*\)|#[0-9a-f]{3,8}\b|\b(?:transparent|white|black)\b)/i;
const SIDES: Record<string, number> = { top: 0, right: 90, bottom: 180, left: 270, 'top right': 45, 'right top': 45, 'bottom right': 135, 'right bottom': 135, 'bottom left': 225, 'left bottom': 225, 'top left': 315, 'left top': 315 };

/** A linear-gradient's angle (deg, 0 = up) and stops (color, 0..1 or null), from the computed background-image; null for anything else. */
export function parseLinear(bg: string): { angle: number; stops: { color: string; at: number | null }[] } | null {
  const m = /^(?:repeating-)?linear-gradient\((.*)\)$/s.exec(bg.trim());
  if (!m) return null;
  const parts = splitTop(m[1]);
  let angle = 180;
  const first = parts[0] ?? '';
  const deg = /^(-?[\d.]+)(deg|turn|rad|grad)$/.exec(first);
  if (deg) {
    const n = parseFloat(deg[1]);
    angle = deg[2] === 'turn' ? n * 360 : deg[2] === 'rad' ? (n * 180) / Math.PI : deg[2] === 'grad' ? n * 0.9 : n;
    parts.shift();
  } else if (first.startsWith('to ')) {
    angle = SIDES[first.slice(3).trim()] ?? 180;
    parts.shift();
  }
  const stops = parts.map((p) => {
    const c = COLOR.exec(p);
    const pos = /(-?[\d.]+)%\s*$/.exec(p.replace(COLOR, ''));
    return { color: c ? c[1] : 'transparent', at: pos ? parseFloat(pos[1]) / 100 : null };
  });
  return stops.length ? { angle, stops } : null;
}

/** The first color in a background-image (a radial gradient's, say), for when it can't be drawn as it is. */
export function firstColor(bg: string): string | null {
  const c = COLOR.exec(bg);
  return c ? c[1] : null;
}

/** Fills the current path with `bg`'s first layer if it's a gradient: true when it drew. */
export function fillGradient(g: G, bg: string, r: Rect): boolean {
  const layer = splitTop(bg)[0] ?? '';
  if (!layer.includes('gradient(')) return false;
  const lin = parseLinear(layer);
  if (!lin) {
    const c = firstColor(layer);
    if (!c) return false;
    g.fillStyle = c;
    g.fill();
    return true;
  }
  const a = (lin.angle * Math.PI) / 180;
  const dx = Math.sin(a);
  const dy = -Math.cos(a);
  const half = (Math.abs(r.w * dx) + Math.abs(r.h * dy)) / 2;
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const grad = g.createLinearGradient(cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half);
  const n = lin.stops.length;
  let last = 0;
  lin.stops.forEach((s, i) => {
    const at = Math.max(last, Math.min(1, s.at ?? (n === 1 ? 0 : i / (n - 1))));
    last = at;
    try {
      grad.addColorStop(at, s.color);
    } catch {
      // a color the canvas can't read: leave it out
    }
  });
  g.fillStyle = grad;
  g.fill();
  return true;
}

// ---- Pictures -------------------------------------------------------------------------------------

/** Whether a picture from `src` can go on the canvas without tainting it. */
export function sameOrigin(src: string, base: string): boolean {
  try {
    const u = new URL(src, base);
    return u.protocol === 'data:' || u.protocol === 'blob:' || u.origin === location.origin;
  } catch {
    return false;
  }
}

type Loaded = { img: HTMLImageElement; ok: boolean | null };
const pictures = new Map<string, Loaded>();

/** A picture from `src` the canvas may draw: as it is when it's this origin's, else fetched again with CORS. Null while loading or refused. */
export function picture(src: string, base: string, onLoad: () => void, cors: boolean): HTMLImageElement | null {
  let p = pictures.get(src);
  if (!p) {
    if (pictures.size > 300) pictures.delete(pictures.keys().next().value!);
    const img = new Image();
    if (cors) img.crossOrigin = 'anonymous';
    p = { img, ok: null };
    const entry = p;
    img.onload = () => {
      entry.ok = true;
      onLoad();
    };
    img.onerror = () => (entry.ok = false);
    img.decoding = 'async';
    img.src = new URL(src, base).href;
    pictures.set(src, p);
  }
  return p.ok ? p.img : null;
}

/** A picture's box for object-fit (or a background's size) in `r`: the part of the picture shown and where. */
export function fit(nw: number, nh: number, r: Rect, how: string): { sx: number; sy: number; sw: number; sh: number; dx: number; dy: number; dw: number; dh: number } {
  const full = { sx: 0, sy: 0, sw: nw, sh: nh, dx: r.x, dy: r.y, dw: r.w, dh: r.h };
  if (!nw || !nh || how === 'fill' || !how) return full;
  const sc = how === 'cover' ? Math.max(r.w / nw, r.h / nh) : how === 'contain' || how === 'scale-down' ? Math.min(r.w / nw, r.h / nh, how === 'scale-down' ? 1 : Infinity) : 1;
  const dw = nw * sc;
  const dh = nh * sc;
  if (how === 'cover') {
    const sw = r.w / sc;
    const sh = r.h / sc;
    return { sx: (nw - sw) / 2, sy: (nh - sh) / 2, sw, sh, dx: r.x, dy: r.y, dw: r.w, dh: r.h };
  }
  return { sx: 0, sy: 0, sw: nw, sh: nh, dx: r.x + (r.w - dw) / 2, dy: r.y + (r.h - dh) / 2, dw, dh };
}

/** Draws `img` into `r` as object-fit `how` says. */
export function drawPicture(g: G, img: CanvasImageSource & { naturalWidth?: number; naturalHeight?: number }, r: Rect, how: string): void {
  const nw = img.naturalWidth ?? (img as HTMLCanvasElement).width;
  const nh = img.naturalHeight ?? (img as HTMLCanvasElement).height;
  if (!nw || !nh) return;
  const f = fit(nw, nh, r, how);
  g.drawImage(img, f.sx, f.sy, f.sw, f.sh, f.dx, f.dy, f.dw, f.dh);
}

/** A placeholder where a picture can't be drawn: a soft tile. */
export function placeholder(g: G, r: Rect, label = ''): void {
  g.fillStyle = 'rgba(118, 118, 128, .18)';
  g.fillRect(r.x, r.y, r.w, r.h);
  if (!label || r.w < 40 || r.h < 16) return;
  g.fillStyle = 'rgba(60, 60, 67, .7)';
  g.font = `500 ${Math.min(14, r.h / 3)}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(label.length > 48 ? `${label.slice(0, 47)}…` : label, r.x + r.w / 2, r.y + r.h / 2, r.w - 12);
  g.textAlign = 'start';
  g.textBaseline = 'alphabetic';
}

/** The url in a computed background-image's first layer, if it's a picture. */
export function urlOf(bg: string): string | null {
  const m = /^url\(\s*["']?([^"')]+)["']?\s*\)/.exec(splitTop(bg)[0] ?? '');
  return m ? m[1] : null;
}

/** Draws a background picture with background-size cover, contain, or its own size (or the size given), placed by background-position. */
export function drawBackground(g: G, img: HTMLImageElement, r: Rect, cs: CSSStyleDeclaration): void {
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  if (!nw || !nh) return;
  const size = cs.backgroundSize;
  let w = nw;
  let h = nh;
  if (size === 'cover' || size === 'contain') {
    const s = size === 'cover' ? Math.max(r.w / nw, r.h / nh) : Math.min(r.w / nw, r.h / nh);
    w = nw * s;
    h = nh * s;
  } else {
    const [a, b] = size.split(/\s+/);
    const px = (v: string | undefined, of: number) => (v?.endsWith('%') ? (parseFloat(v) / 100) * of : v && v !== 'auto' ? parseFloat(v) : NaN);
    const pw = px(a, r.w);
    const ph = px(b, r.h);
    if (pw > 0) [w, h] = [pw, ph > 0 ? ph : (nh * pw) / nw];
    else if (ph > 0) [w, h] = [(nw * ph) / nh, ph];
  }
  const [px, py] = cs.backgroundPosition.split(/\s+/);
  const at = (v: string | undefined, room: number) => (v?.endsWith('%') ? (parseFloat(v) / 100) * room : parseFloat(v ?? '0') || 0);
  g.drawImage(img, r.x + at(px, r.w - w), r.y + at(py, r.h - h), w, h);
}

const svgs = new WeakMap<Element, { key: string; img: HTMLImageElement; ok: boolean }>();
const SVG_PROPS = ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'fill-opacity', 'stroke-opacity', 'opacity', 'color', 'font-size', 'font-family', 'font-weight'];

/** An inline <svg> as a picture of its own, its computed colors written into it (the page's CSS doesn't come with it). Null until it has loaded. */
export function svgPicture(el: SVGSVGElement, r: Rect, color: string, onLoad: () => void): HTMLImageElement | null {
  const key = `${color}|${Math.round(r.w)}x${Math.round(r.h)}|${el.outerHTML}`;
  const had = svgs.get(el);
  if (had?.key === key) return had.ok ? had.img : null;
  if (key.length > 60_000) return null;
  const copy = el.cloneNode(true) as SVGSVGElement;
  const from = [el, ...el.querySelectorAll('*')];
  const to = [copy, ...copy.querySelectorAll('*')];
  from.forEach((o, i) => {
    const s = getComputedStyle(o);
    to[i].setAttribute('style', SVG_PROPS.map((p) => `${p}:${s.getPropertyValue(p)}`).join(';'));
  });
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  copy.setAttribute('width', String(Math.max(1, Math.round(r.w))));
  copy.setAttribute('height', String(Math.max(1, Math.round(r.h))));
  const img = new Image();
  const entry = { key, img, ok: false };
  img.onload = () => {
    entry.ok = true;
    onLoad();
  };
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(copy))}`;
  svgs.set(el, entry);
  return had?.ok ? had.img : null;
}

// ---- Form controls --------------------------------------------------------------------------------

const TEXTLIKE = /^(?:text|search|email|url|tel|password|number|)$/;

/** The content box of `r`: less the borders and the padding. */
export function contentBox(cs: CSSStyleDeclaration, r: Rect): Rect {
  const l = (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.paddingLeft) || 0);
  const t = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.paddingTop) || 0);
  const rr = (parseFloat(cs.borderRightWidth) || 0) + (parseFloat(cs.paddingRight) || 0);
  const b = (parseFloat(cs.borderBottomWidth) || 0) + (parseFloat(cs.paddingBottom) || 0);
  return { x: r.x + l, y: r.y + t, w: Math.max(0, r.w - l - rr), h: Math.max(0, r.h - t - b) };
}

/** A computed line-height in px ('normal' is 1.2 of the font size). */
export function lineHeight(cs: CSSStyleDeclaration): number {
  const n = parseFloat(cs.lineHeight);
  return Number.isFinite(n) ? n : (parseFloat(cs.fontSize) || 14) * 1.2;
}

export function fontOf(cs: CSSStyleDeclaration): string {
  return `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
}

const ACCENT = '#0071e3';

/** Words wrapped to `width` with the canvas's font (a textarea's lines). */
function wrap(g: G, text: string, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/(?<=\s)/)) {
      if (line && g.measureText(line + word).width > width) {
        out.push(line);
        line = word;
      } else line += word;
    }
    out.push(line);
  }
  return out;
}

/** Draws what a form control shows inside its box: true when `el` is one (its children aren't walked). */
export function drawControl(g: G, el: Element, cs: CSSStyleDeclaration, r: Rect, focused: boolean): boolean {
  const view = el.ownerDocument.defaultView ?? window;
  const box = contentBox(cs, r);
  const ink = cs.color;
  if (el instanceof view.HTMLInputElement) {
    const type = el.type;
    if (type === 'checkbox' || type === 'radio') {
      if (cs.appearance === 'none') return true;
      const s = Math.min(r.w, r.h);
      const x = r.x + (r.w - s) / 2;
      const y = r.y + (r.h - s) / 2;
      const on = el.checked;
      g.beginPath();
      if (type === 'radio') g.arc(x + s / 2, y + s / 2, s / 2 - 0.5, 0, Math.PI * 2);
      else g.roundRect(x + 0.5, y + 0.5, s - 1, s - 1, 3);
      g.fillStyle = on ? (cs.accentColor !== 'auto' ? cs.accentColor : ACCENT) : '#fff';
      g.fill();
      g.strokeStyle = on ? 'transparent' : 'rgba(60,60,67,.45)';
      g.lineWidth = 1;
      g.stroke();
      if (on && type === 'radio') {
        g.beginPath();
        g.arc(x + s / 2, y + s / 2, s / 5, 0, Math.PI * 2);
        g.fillStyle = '#fff';
        g.fill();
      } else if (on) {
        g.beginPath();
        g.moveTo(x + s * 0.24, y + s * 0.52);
        g.lineTo(x + s * 0.43, y + s * 0.7);
        g.lineTo(x + s * 0.77, y + s * 0.3);
        g.strokeStyle = '#fff';
        g.lineWidth = Math.max(1.5, s / 8);
        g.stroke();
      }
      return true;
    }
    if (type === 'range') {
      const min = parseFloat(el.min || '0');
      const max = parseFloat(el.max || '100');
      const f = max > min ? (parseFloat(el.value) - min) / (max - min) : 0;
      const cy = r.y + r.h / 2;
      g.fillStyle = 'rgba(118,118,128,.28)';
      g.beginPath();
      g.roundRect(box.x, cy - 2, box.w, 4, 2);
      g.fill();
      g.fillStyle = cs.accentColor !== 'auto' ? cs.accentColor : ACCENT;
      g.beginPath();
      g.roundRect(box.x, cy - 2, box.w * f, 4, 2);
      g.fill();
      g.beginPath();
      g.arc(box.x + box.w * f, cy, Math.min(9, r.h / 2), 0, Math.PI * 2);
      g.fillStyle = '#fff';
      g.fill();
      g.strokeStyle = 'rgba(0,0,0,.2)';
      g.stroke();
      return true;
    }
    if (type === 'button' || type === 'submit' || type === 'reset') {
      g.font = fontOf(cs);
      g.fillStyle = ink;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(el.value, box.x + box.w / 2, box.y + box.h / 2, box.w);
      g.textAlign = 'start';
      g.textBaseline = 'alphabetic';
      return true;
    }
    if (type === 'hidden') return true;
    if (!TEXTLIKE.test(type)) {
      g.font = fontOf(cs);
      g.fillStyle = ink;
      g.textBaseline = 'middle';
      g.fillText(el.value || type, box.x, box.y + box.h / 2, box.w);
      g.textBaseline = 'alphabetic';
      return true;
    }
    const shown = el.value ? (type === 'password' ? '•'.repeat(el.value.length) : el.value) : el.placeholder;
    g.font = fontOf(cs);
    g.textBaseline = 'middle';
    g.fillStyle = el.value ? ink : getComputedStyle(el, '::placeholder').color || 'rgba(60,60,67,.6)';
    const x = box.x - el.scrollLeft;
    g.fillText(shown, x, box.y + box.h / 2);
    if (focused) {
      const at = el.value ? g.measureText(shown.slice(0, el.selectionStart ?? shown.length)).width : 0;
      g.fillStyle = cs.caretColor !== 'auto' ? cs.caretColor : ink;
      g.fillRect(x + at, box.y + box.h / 2 - lineHeight(cs) * 0.42, 1.5, lineHeight(cs) * 0.84);
    }
    g.textBaseline = 'alphabetic';
    return true;
  }
  if (el instanceof view.HTMLTextAreaElement) {
    g.font = fontOf(cs);
    g.fillStyle = el.value ? ink : getComputedStyle(el, '::placeholder').color || 'rgba(60,60,67,.6)';
    g.textBaseline = 'top';
    const lh = lineHeight(cs);
    const lines = wrap(g, el.value || el.placeholder, box.w);
    let y = box.y - el.scrollTop;
    for (const line of lines) {
      if (y > box.y + box.h) break;
      if (y + lh >= box.y) g.fillText(line, box.x, y + (lh - (parseFloat(cs.fontSize) || 14)) / 2);
      y += lh;
    }
    if (focused) {
      g.fillStyle = cs.caretColor !== 'auto' ? cs.caretColor : ink;
      const before = wrap(g, el.value.slice(0, el.selectionStart ?? el.value.length), box.w);
      const last = before[before.length - 1] ?? '';
      g.fillRect(box.x + g.measureText(last).width, box.y - el.scrollTop + (before.length - 1) * lh + lh * 0.1, 1.5, lh * 0.8);
    }
    g.textBaseline = 'alphabetic';
    return true;
  }
  if (el instanceof view.HTMLSelectElement) {
    g.font = fontOf(cs);
    g.fillStyle = ink;
    g.textBaseline = 'middle';
    const text = el.selectedOptions[0]?.label ?? '';
    g.fillText(text, box.x, box.y + box.h / 2, Math.max(0, box.w - 14));
    if (cs.appearance !== 'none') g.fillText('▾', box.x + box.w - 10, box.y + box.h / 2);
    g.textBaseline = 'alphabetic';
    return true;
  }
  if (el instanceof view.HTMLProgressElement || el instanceof view.HTMLMeterElement) {
    const f = el.max > 0 ? el.value / el.max : 0;
    g.fillStyle = 'rgba(118,118,128,.2)';
    g.beginPath();
    g.roundRect(r.x, r.y, r.w, r.h, r.h / 2);
    g.fill();
    g.fillStyle = ACCENT;
    g.beginPath();
    g.roundRect(r.x, r.y, r.w * Math.max(0, Math.min(1, f)), r.h, r.h / 2);
    g.fill();
    return true;
  }
  return false;
}

// ---- Pseudo-elements and scrollbars -------------------------------------------------------------

const pseudos = new WeakMap<Element, { cls: string; before: CSSStyleDeclaration | null; after: CSSStyleDeclaration | null }>();

function pseudoOf(el: Element, which: '::before' | '::after'): CSSStyleDeclaration | null {
  const s = getComputedStyle(el, which);
  return s.content && s.content !== 'none' && s.content !== 'normal' && s.display !== 'none' ? s : null;
}

/** Draws a small element's short ::before and ::after: a few characters of text, or a box of color (a dot). Looked up again only when its class changes. */
export function drawPseudos(g: G, el: Element, r: Rect): void {
  if (r.w > 160 || r.h > 90) return;
  const cls = `${el.className}`;
  let p = pseudos.get(el);
  if (!p || p.cls !== cls) {
    p = { cls, before: pseudoOf(el, '::before'), after: pseudoOf(el, '::after') };
    pseudos.set(el, p);
  }
  for (const [s, after] of [[p.before, false], [p.after, true]] as const) {
    if (!s) continue;
    const text = /^"(.*)"$/s.exec(s.content)?.[1]?.replace(/\\"/g, '"') ?? '';
    const w = parseFloat(s.width) || 0;
    const h = parseFloat(s.height) || 0;
    let x: number;
    let y: number;
    if (s.position === 'absolute' && s.left !== 'auto' && s.top !== 'auto') {
      x = r.x + (parseFloat(s.left) || 0);
      y = r.y + (parseFloat(s.top) || 0);
    } else {
      x = after ? r.x + r.w - (w || 10) : r.x;
      y = r.y + (r.h - (h || parseFloat(s.fontSize) || 12)) / 2;
    }
    if (!text && w > 0 && h > 0 && visible(s.backgroundColor)) {
      g.fillStyle = s.backgroundColor;
      roundPath(g, { x, y, w, h }, radiiOf(s, { x, y, w, h }));
      g.fill();
    } else if (text && text.length <= 4) {
      g.font = fontOf(s);
      g.fillStyle = s.color;
      g.textBaseline = 'top';
      g.fillText(text, x, y);
      g.textBaseline = 'alphabetic';
    }
  }
}

/** A thin thumb on a box that scrolls, where an overlay scrollbar would be, so it's plain that there's more. */
export function drawScrollbar(g: G, el: Element, r: Rect): void {
  const sh = el.scrollHeight;
  const ch = el.clientHeight;
  if (sh <= ch + 2 || ch < 40) return;
  const h = Math.max(24, (ch / sh) * r.h);
  const y = r.y + (el.scrollTop / (sh - ch)) * (r.h - h);
  g.fillStyle = 'rgba(0,0,0,.28)';
  g.beginPath();
  g.roundRect(r.x + r.w - 6, y + 2, 4, h - 4, 2);
  g.fill();
}
