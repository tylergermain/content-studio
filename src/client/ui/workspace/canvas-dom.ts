import { ARTBOARD } from '../../../shared/design-canvas';

// What the design canvas (canvas.ts) does inside a design's own document, which it reads but never
// runs: the design is served sandboxed with scripts off (shared/design-canvas.ts), and the canvas, in
// the office's page, lays its artboards out like a design tool's page, finds the element under the
// pointer, and says which element a note is pinned to in words a designer reads and a path an agent
// can follow.

/** The space round the artboards, and between them when the design doesn't place them itself. */
const PAD = 160;
const GAP = 120;
const STYLE_ID = '__office_canvas';

/** The design's artboards, in its order: the whole page as one when it marks none. */
export function artboardsOf(doc: Document): HTMLElement[] {
  const marked = [...doc.querySelectorAll<HTMLElement>(`[${ARTBOARD}]`)];
  return marked.length ? marked : doc.body ? [doc.body] : [];
}

/** The artboard an element is on, if any. */
export function artboardOf(el: Element): HTMLElement | undefined {
  return (el.closest(`[${ARTBOARD}]`) as HTMLElement | null) ?? undefined;
}

/**
 * Lays the design out on the canvas: a neutral page with the artboards on it where the design places
 * them (`data-x` and `data-y`, as an import from Paper keeps them), else side by side in a row. It
 * changes only the canvas's copy of the page; the file is untouched.
 */
export function layOut(doc: Document, backdrop = '#e8e8ec'): void {
  if (!doc.documentElement || !doc.body) return;
  doc.getElementById(STYLE_ID)?.remove();
  const boards = [...doc.querySelectorAll<HTMLElement>(`[${ARTBOARD}]`)];
  const placed = boards.length > 0 && boards.every((b) => Number.isFinite(parseFloat(b.dataset.x ?? '')) && Number.isFinite(parseFloat(b.dataset.y ?? '')));
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = [
    `html { overflow: hidden !important; transform-origin: 0 0; background: ${/^#[0-9a-f]{3,8}$/i.test(backdrop) ? backdrop : '#e8e8ec'} !important; }`,
    `body { margin: 0 !important; background: transparent !important; position: relative !important; ${placed ? '' : `display: flex !important; flex-direction: row !important; flex-wrap: nowrap !important; align-items: flex-start !important; gap: ${GAP}px !important; padding: ${PAD}px !important; width: max-content !important;`} }`,
    `[${ARTBOARD}] { flex: none !important; box-shadow: 0 1px 2px rgba(0,0,0,.08), 0 10px 30px rgba(0,0,0,.10); }`,
    `* { cursor: default !important; }`,
  ].join('\n');
  doc.head?.append(style);
  if (!placed) return;
  const xs = boards.map((b) => parseFloat(b.dataset.x!));
  const ys = boards.map((b) => parseFloat(b.dataset.y!));
  const minX = Math.min(...xs), minY = Math.min(...ys);
  let right = 0, bottom = 0;
  boards.forEach((b, i) => {
    b.style.setProperty('position', 'absolute', 'important');
    b.style.setProperty('left', `${xs[i] - minX + PAD}px`, 'important');
    b.style.setProperty('top', `${ys[i] - minY + PAD}px`, 'important');
    b.style.setProperty('margin', '0', 'important');
    right = Math.max(right, xs[i] - minX + PAD + b.offsetWidth);
    bottom = Math.max(bottom, ys[i] - minY + PAD + b.offsetHeight);
  });
  doc.body.style.setProperty('width', `${right + PAD}px`, 'important');
  doc.body.style.setProperty('height', `${bottom + PAD}px`, 'important');
}

/** The element worth pointing at under a point of the frame: never the page itself, and only on an artboard. */
export function elementAt(doc: Document, x: number, y: number): HTMLElement | SVGElement | undefined {
  let el = doc.elementFromPoint(x, y) as HTMLElement | SVGElement | null;
  if (!el || el === doc.documentElement || el === doc.body) return undefined;
  // Inside a drawing, the drawing is the thing: not one of its paths.
  const svg = el.closest('svg');
  if (svg) el = svg;
  const marked = !!doc.querySelector(`[${ARTBOARD}]`);
  if (marked && !artboardOf(el)) return undefined;
  return el;
}

/** The path from an element's artboard down to it (`div:nth-of-type(3) > svg`), for finding it again. */
export function pathTo(el: Element): string {
  const board = artboardOf(el);
  const steps: string[] = [];
  for (let at: Element | null = el; at && at !== board && at.parentElement; at = at.parentElement) {
    const same = [...at.parentElement.children].filter((c) => c.tagName === at!.tagName);
    const tag = at.tagName.toLowerCase();
    steps.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(at) + 1})` : tag);
    if (at.parentElement === at.ownerDocument.body) break;
  }
  return steps.join(' > ');
}

/** The element `path` names on the artboard called `board`, if it's still there. */
export function findAgain(doc: Document, board: string | undefined, path: string): Element | undefined {
  const boards = artboardsOf(doc);
  const root = board === undefined ? doc.body : boards.find((b) => b.getAttribute(ARTBOARD) === board);
  if (!root) return undefined;
  if (!path) return root;
  try {
    return root.querySelector(`:scope > ${path}`) ?? undefined;
  } catch {
    return undefined;
  }
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}\u2026` : s);

/** What an element is, as a designer would say it: a picture, a drawing, some text and what it says, or a box of a size. */
export function describe(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const rect = el.getBoundingClientRect();
  const box = el.ownerDocument.defaultView?.getComputedStyle(el);
  const size = `${Math.round((el as HTMLElement).offsetWidth || rect.width)}\u00d7${Math.round((el as HTMLElement).offsetHeight || rect.height)}`;
  if (el.hasAttribute(ARTBOARD)) return 'the whole artboard';
  if (tag === 'svg') return `drawing (${size})`;
  if (tag === 'img' || tag === 'video') return `${tag === 'img' ? 'picture' : 'video'} (${size})`;
  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (text) return `text \u201c${clip(text, 70)}\u201d`;
  if (box && box.backgroundImage && box.backgroundImage !== 'none') return `${/gradient/.test(box.backgroundImage) && !/url\(/.test(box.backgroundImage) ? 'gradient' : 'picture'} (${size})`;
  return `shape (${size})`;
}

/** Where a note is pinned, in one line for the designer: the artboard, the element, and the path to it. */
export function whereOf(el: Element): string {
  const board = artboardOf(el);
  const name = board?.getAttribute(ARTBOARD);
  const path = pathTo(el);
  const parts = [name ? `artboard \u201c${name}\u201d` : 'the page', describe(el)];
  if (path && !el.hasAttribute(ARTBOARD)) parts.push(`at [${ARTBOARD}="${(name ?? '').replace(/"/g, '\\"')}"] > ${path}`);
  return parts.join(', ');
}
