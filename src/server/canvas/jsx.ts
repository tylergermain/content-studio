// JSX as Paper writes it (get_jsx with inline styles, see paper.ts) turned into plain HTML for a design
// file (shared/design-canvas.ts). It reads the part of JSX a design export uses: elements, string and
// number attributes, `style={{ ... }}` objects, text with JSX's rules for whitespace, `{'text'}`
// expressions and comments. Anything that would run (an `on...` handler, `dangerouslySetInnerHTML`)
// is left out, and so is `<script>`.

export interface JsxElement {
  tag: string;
  attrs: [string, JsxValue][];
  children: (JsxElement | string)[];
}
type JsxValue = string | number | boolean | null | Record<string, string | number>;

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const DROPPED_TAGS = new Set(['script', 'iframe', 'object', 'embed', 'base', 'meta', 'link', 'form']);

/** CSS properties whose numbers have no unit (as React writes them); every other number is pixels. */
const UNITLESS = new Set(['animationIterationCount', 'aspectRatio', 'borderImageOutset', 'borderImageSlice', 'borderImageWidth', 'columnCount', 'columns', 'flex', 'flexGrow', 'flexPositive', 'flexShrink', 'flexNegative', 'flexOrder', 'gridArea', 'gridRow', 'gridRowEnd', 'gridRowSpan', 'gridRowStart', 'gridColumn', 'gridColumnEnd', 'gridColumnSpan', 'gridColumnStart', 'fontWeight', 'lineClamp', 'lineHeight', 'opacity', 'order', 'orphans', 'scale', 'tabSize', 'widows', 'zIndex', 'zoom', 'fillOpacity', 'floodOpacity', 'stopOpacity', 'strokeDasharray', 'strokeDashoffset', 'strokeMiterlimit', 'strokeOpacity', 'strokeWidth']);

/** SVG attributes that are written in camel case in SVG itself, so they're kept as they are. */
const SVG_CAMEL = new Set(['viewBox', 'preserveAspectRatio', 'gradientUnits', 'gradientTransform', 'patternUnits', 'patternContentUnits', 'patternTransform', 'clipPathUnits', 'maskUnits', 'maskContentUnits', 'filterUnits', 'primitiveUnits', 'stdDeviation', 'baseFrequency', 'numOctaves', 'kernelMatrix', 'kernelUnitLength', 'textLength', 'lengthAdjust', 'startOffset', 'markerWidth', 'markerHeight', 'markerUnits', 'refX', 'refY', 'pathLength', 'spreadMethod', 'tableValues', 'diffuseConstant', 'specularConstant', 'specularExponent', 'surfaceScale', 'limitingConeAngle', 'pointsAtX', 'pointsAtY', 'pointsAtZ', 'edgeMode', 'xChannelSelector', 'yChannelSelector', 'targetX', 'targetY', 'repeatCount', 'attributeName', 'calcMode', 'keySplines', 'keyTimes']);
const RENAMED: Readonly<Record<string, string>> = { className: 'class', htmlFor: 'for', xlinkHref: 'xlink:href', xmlnsXlink: 'xmlns:xlink', xmlSpace: 'xml:space' };

class Reader {
  i = 0;
  constructor(readonly s: string) {}
  fail(why: string): never {
    throw new Error(`${why} at ${this.i} near ${JSON.stringify(this.s.slice(this.i, this.i + 40))}`);
  }
  peek(n = 0) {
    return this.s[this.i + n];
  }
  space() {
    while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++;
  }
  eat(text: string): boolean {
    if (!this.s.startsWith(text, this.i)) return false;
    this.i += text.length;
    return true;
  }
  expect(text: string) {
    if (!this.eat(text)) this.fail(`Expected ${text}`);
  }
  /** A tag or attribute name (`xlink:href`, `aria-label`, `motion.div`); an object's key is a plain identifier. */
  name(identifier = false): string {
    const m = (identifier ? /^[A-Za-z_$][\w$]*/ : /^[A-Za-z_$][\w$.:-]*/).exec(this.s.slice(this.i, this.i + 200));
    if (!m) this.fail('Expected a name');
    this.i += m[0].length;
    return m[0];
  }

  /** A JavaScript string literal: '...', "..." or a template with no ${}. */
  string(): string {
    const q = this.s[this.i];
    if (q !== "'" && q !== '"' && q !== '`') this.fail('Expected a string');
    this.i++;
    let out = '';
    while (this.i < this.s.length) {
      const c = this.s[this.i++];
      if (c === q) return out;
      if (q === '`' && c === '$' && this.peek() === '{') this.fail('Template expressions are not supported');
      if (c !== '\\') {
        out += c;
        continue;
      }
      const e = this.s[this.i++];
      if (e === 'n') out += '\n';
      else if (e === 't') out += '\t';
      else if (e === 'r') out += '\r';
      else if (e === 'u') {
        const braced = this.peek() === '{';
        const m = braced ? /^\{([0-9a-fA-F]{1,6})\}/.exec(this.s.slice(this.i)) : /^[0-9a-fA-F]{4}/.exec(this.s.slice(this.i));
        if (!m) this.fail('Bad escape');
        out += String.fromCodePoint(parseInt(braced ? m[1] : m[0], 16));
        this.i += m[0].length;
      } else if (e === 'x') {
        out += String.fromCharCode(parseInt(this.s.slice(this.i, this.i + 2), 16));
        this.i += 2;
      } else if (e === '\n') {
        // A line continuation.
      } else out += e;
    }
    return this.fail('Unterminated string');
  }

  /** A JavaScript value in an expression: a string, a number, true, false, null or an object of strings and numbers. */
  value(): JsxValue {
    this.space();
    const c = this.peek();
    if (c === "'" || c === '"' || c === '`') return this.string();
    if (c === '{') return this.object();
    const m = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(this.s.slice(this.i, this.i + 40));
    if (m) {
      this.i += m[0].length;
      return Number(m[0]);
    }
    for (const [word, v] of [['true', true], ['false', false], ['null', null], ['undefined', null]] as const) if (this.eat(word)) return v;
    return this.fail('Unsupported expression');
  }

  object(): Record<string, string | number> {
    this.expect('{');
    const out: Record<string, string | number> = {};
    for (;;) {
      this.space();
      if (this.eat('}')) return out;
      const key = this.peek() === "'" || this.peek() === '"' ? this.string() : this.name(true);
      this.space();
      this.expect(':');
      const v = this.value();
      if (typeof v === 'string' || typeof v === 'number') out[key] = v;
      this.space();
      if (!this.eat(',')) {
        this.space();
        this.expect('}');
        return out;
      }
    }
  }

  /** `{...}` in a child or an attribute: its value, or nothing for a comment or an empty one. */
  expression(): JsxValue | undefined {
    this.expect('{');
    this.space();
    if (this.eat('/*')) {
      const end = this.s.indexOf('*/', this.i);
      if (end < 0) this.fail('Unterminated comment');
      this.i = end + 2;
      this.space();
      this.expect('}');
      return undefined;
    }
    if (this.eat('}')) return undefined;
    const v = this.value();
    this.space();
    this.expect('}');
    return v;
  }

  element(): JsxElement {
    this.expect('<');
    const tag = this.name();
    const attrs: [string, JsxValue][] = [];
    for (;;) {
      this.space();
      if (this.eat('/>')) return { tag, attrs, children: [] };
      if (this.eat('>')) break;
      if (this.peek() === '{') this.fail('Spread attributes are not supported');
      const name = this.name();
      this.space();
      if (!this.eat('=')) {
        attrs.push([name, true]);
        continue;
      }
      this.space();
      const c = this.peek();
      const v = c === '{' ? this.expression() : this.string();
      if (v !== undefined) attrs.push([name, v]);
    }
    const children: (JsxElement | string)[] = [];
    for (;;) {
      if (this.i >= this.s.length) this.fail(`Unclosed <${tag}>`);
      if (this.eat('</')) {
        this.space();
        const close = this.peek() === '>' ? '' : this.name();
        if (close && close !== tag) this.fail(`Expected </${tag}>`);
        this.space();
        this.expect('>');
        return { tag, attrs, children };
      }
      const c = this.peek();
      if (c === '<') children.push(this.element());
      else if (c === '{') {
        const v = this.expression();
        if (typeof v === 'string' || typeof v === 'number') children.push(String(v));
      } else {
        const start = this.i;
        while (this.i < this.s.length && this.s[this.i] !== '<' && this.s[this.i] !== '{') this.i++;
        const text = jsxText(this.s.slice(start, this.i));
        if (text) children.push(text);
      }
    }
  }
}

/** Text between tags as JSX reads it: each line trimmed where it meets a line break, blank lines dropped, the rest joined by spaces. */
function jsxText(raw: string): string {
  const lines = raw.split(/\r\n|\n|\r/);
  if (lines.length === 1) return decodeEntities(raw);
  const kept: string[] = [];
  lines.forEach((line, i) => {
    let l = line;
    if (i > 0) l = l.replace(/^[ \t]+/, '');
    if (i < lines.length - 1) l = l.replace(/[ \t]+$/, '');
    if (l) kept.push(l);
  });
  return decodeEntities(kept.join(' '));
}

const ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', mdash: '\u2014', ndash: '\u2013', hellip: '\u2026', rsquo: '\u2019', lsquo: '\u2018', rdquo: '\u201d', ldquo: '\u201c', middot: '\u00b7', copy: '\u00a9', reg: '\u00ae', trade: '\u2122' };
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** The one element in a JSX expression, as get_jsx returns it: optionally in parentheses. */
export function parseJsx(src: string): JsxElement {
  const r = new Reader(src);
  r.space();
  const wrapped = r.eat('(');
  r.space();
  const el = r.element();
  r.space();
  if (wrapped) r.eat(')');
  r.space();
  r.eat(';');
  return el;
}

const kebab = (name: string) => name.replace(/^(Webkit|Moz|O)(?=[A-Z])/, (p) => `-${p.toLowerCase()}`).replace(/^ms(?=[A-Z])/, '-ms').replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** A style object as CSS: `fontSize: 12` is `font-size: 12px`, and a number of a unitless property stays a number. */
export function styleText(style: Record<string, string | number>): string {
  return Object.entries(style)
    .filter(([, v]) => v !== '' && v !== null && v !== undefined)
    .map(([k, v]) => `${k.startsWith('--') ? k : kebab(k)}: ${typeof v === 'number' && v !== 0 && !UNITLESS.has(k) && !k.startsWith('--') ? `${v}px` : v}`)
    .join('; ');
}

const escapeText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\u00a0/g, '&nbsp;');
const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** What an attribute is called in HTML or SVG markup. */
function attrName(name: string): string {
  if (RENAMED[name]) return RENAMED[name];
  if (name.startsWith('aria-') || name.startsWith('data-') || SVG_CAMEL.has(name) || !/[A-Z]/.test(name)) return name;
  return kebab(name);
}

export interface HtmlOptions {
  /** Changes a URL in a style or a src/href (a picture of Paper's, say, to the copy beside the design). */
  url?(url: string): string;
  /** Attributes to put first on the root element, and styles to put first in its style. */
  root?: { attrs?: [string, string][]; style?: Record<string, string | number> };
}

const URL_IN_CSS = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;

/**
 * The element as HTML. Elements holding only elements are laid out one to a line; anything holding text
 * is written on one line, all the way down, since a design's text keeps its whitespace (pre-wrap).
 */
export function toHtml(el: JsxElement, opts: HtmlOptions = {}, depth = 0, isRoot = true, inline = false): string {
  if (DROPPED_TAGS.has(el.tag.toLowerCase())) return '';
  const tag = /^[a-z]/.test(el.tag) ? el.tag : el.tag.toLowerCase();
  const pad = inline ? '' : '  '.repeat(depth);
  const parts: string[] = [];
  const rootStyle = isRoot ? opts.root?.style : undefined;
  if (isRoot) for (const [k, v] of opts.root?.attrs ?? []) parts.push(`${k}="${escapeAttr(v)}"`);
  let styled = false;
  for (const [name, v] of el.attrs) {
    if (/^on[A-Z]/.test(name) || name === 'dangerouslySetInnerHTML' || name === 'key' || name === 'ref' || v === null || v === false) continue;
    if (name === 'style' && typeof v === 'object') {
      styled = true;
      const css = styleText({ ...rootStyle, ...v });
      if (css) parts.push(`style="${escapeAttr(opts.url ? css.replace(URL_IN_CSS, (_m, q: string, u: string) => `url(${q}${opts.url!(u)}${q})`) : css)}"`);
      continue;
    }
    const n = attrName(name);
    if (v === true) parts.push(n);
    else {
      let text = typeof v === 'object' ? '' : String(v);
      if (opts.url && (n === 'src' || n === 'href' || n === 'xlink:href')) text = opts.url(text);
      if (/^\s*javascript:/i.test(text)) continue;
      parts.push(`${n}="${escapeAttr(text)}"`);
    }
  }
  if (!styled && rootStyle) {
    const css = styleText(rootStyle);
    if (css) parts.push(`style="${escapeAttr(css)}"`);
  }
  const open = `<${tag}${parts.length ? ' ' + parts.join(' ') : ''}>`;
  if (VOID.has(tag.toLowerCase())) return `${pad}${open}`;
  if (!el.children.length) return `${pad}${open}</${tag}>`;
  if (inline || el.children.some((c) => typeof c === 'string')) {
    const inner = el.children.map((c) => (typeof c === 'string' ? escapeText(c) : toHtml(c, opts, 0, false, true))).join('');
    return `${pad}${open}${inner}</${tag}>`;
  }
  const inner = el.children.map((c) => toHtml(c as JsxElement, opts, depth + 1, false)).filter(Boolean).join('\n');
  return `${pad}${open}\n${inner}\n${pad}</${tag}>`;
}

/** Every URL the element and its children load: in their styles, and in src and href. */
export function urlsIn(el: JsxElement, found = new Set<string>()): Set<string> {
  for (const [name, v] of el.attrs) {
    if (name === 'style' && v && typeof v === 'object') for (const s of Object.values(v)) if (typeof s === 'string') for (const m of s.matchAll(URL_IN_CSS)) found.add(m[2]);
    if ((name === 'src' || name === 'href' || name === 'xlinkHref') && typeof v === 'string') found.add(v);
  }
  for (const c of el.children) if (typeof c !== 'string') urlsIn(c, found);
  return found;
}

/** Every font family the element and its children ask for first in their font-family, with the weights each is used at. */
export function fontsIn(el: JsxElement, found = new Map<string, Set<number>>()): Map<string, Set<number>> {
  const style = el.attrs.find(([n]) => n === 'style')?.[1];
  if (style && typeof style === 'object') {
    const family = typeof style.fontFamily === 'string' ? style.fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '') : undefined;
    if (family) {
      const weight = Number(style.fontWeight ?? 400);
      const set = found.get(family) ?? new Set<number>();
      set.add(Number.isFinite(weight) ? weight : 400);
      found.set(family, set);
    }
  }
  for (const c of el.children) if (typeof c !== 'string') fontsIn(c, found);
  return found;
}
