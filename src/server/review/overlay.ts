import { REVIEW_SCRIPT, REVIEW_TAG } from '../../shared/software-review.js';

// The script the relay adds to a worker's pages in review mode (see review.ts): it does nothing at
// all unless the page is framed by the office (`office`, the origin it was told), and then only what
// the office asks over postMessage. In comment mode it outlines the element under the pointer, and a
// click on one tells the office which element it was instead of reaching the app; with the box or
// circle tool, a box dragged out or a ring drawn by hand tells it the area instead, and what's in it.
// It draws the numbered pins and areas of the comments so far, and says where the page is whenever
// that changes (a link, a route in a single-page app), so the office's address bar follows. Its own
// drawing is in a closed shadow root over everything, which no app's styles reach.

/** The script, served at REVIEW_SCRIPT on each worker's server. Plain JavaScript: browsers run it as it is. */
export const OVERLAY_JS = String.raw`(function () {
  var me = document.currentScript;
  // The office's origin, or on its own machine both its names: the one framing this page, as the
  // browser tells it (or the page that opened it), else the first.
  var offices = ((me && me.getAttribute('data-office')) || '').split(' ').filter(Boolean);
  var framer = (location.ancestorOrigins && location.ancestorOrigins[0]) || (document.referrer && (function () { try { return new URL(document.referrer).origin; } catch (e) { return ''; } })());
  var office = offices.length > 1 && offices.indexOf(framer) >= 0 ? framer : offices[0];
  if (!office || window.parent === window || window.__agentOfficeReview) return;
  window.__agentOfficeReview = true;
  var TAG = '${REVIEW_TAG}';
  var commenting = false, hover = null, picked = null, pins = [];
  // The tool in comment mode ('pick' an element, a 'rect' or a 'lasso' round an area), the shape being drawn,
  // the area just drawn (waiting for its comment), the comments' areas, and the one in focus.
  var tool = 'pick', drawing = null, area = null, shapes = [], focusedArea = null;
  var host = document.createElement('div');
  host.setAttribute('data-agent-office', 'review');
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
  var root = host.attachShadow({ mode: 'closed' });
  var css = document.createElement('style');
  css.textContent = '.box{position:fixed;box-sizing:border-box;border:2px solid #0a84ff;border-radius:2px;background:rgba(10,132,255,.08);display:none}' +
    '.sel{border-color:#ff9f0a;background:rgba(255,159,10,.1)}' +
    '.focus{border-color:#7c5cff;background:rgba(124,92,255,.12);box-shadow:0 0 0 4px rgba(124,92,255,.18)}' +
    '.pin{position:fixed;min-width:24px;height:24px;margin:-12px 0 0 -12px;padding:0 4px;box-sizing:border-box;border-radius:12px 12px 12px 3px;background:#7c5cff;color:#fff;font:700 12px/24px system-ui,sans-serif;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.35);border:2px solid #fff}' +
    '.pin.draft{background:#fff;color:#5b3fff;border-color:#7c5cff}.pin.done{background:#30d158}' +
    '.shapes{position:fixed;left:0;top:0;width:100vw;height:100vh;overflow:visible}' +
    '.s{fill:rgba(124,92,255,.08);stroke:#7c5cff;stroke-width:2;stroke-dasharray:7 5;stroke-linejoin:round}' +
    '.s.draft{fill:rgba(255,255,255,.14);stroke:#fff}.s.done{stroke:#30d158;fill:rgba(48,209,88,.06)}' +
    '.s.now{stroke:#ff9f0a;fill:rgba(255,159,10,.12);stroke-dasharray:none}.s.focus{stroke-width:3;fill:rgba(124,92,255,.18);stroke-dasharray:none}' +
    '.draw{position:fixed;inset:0;pointer-events:auto;cursor:crosshair;display:none;touch-action:none}';
  var hoverBox = document.createElement('div'); hoverBox.className = 'box';
  var selBox = document.createElement('div'); selBox.className = 'box sel';
  var focusBox = document.createElement('div'); focusBox.className = 'box focus';
  var pinLayer = document.createElement('div');
  var SVG = 'http://www.w3.org/2000/svg';
  var shapeLayer = document.createElementNS(SVG, 'svg'); shapeLayer.setAttribute('class', 'shapes');
  var drawLayer = document.createElement('div'); drawLayer.className = 'draw';
  root.append(css, shapeLayer, focusBox, hoverBox, selBox, pinLayer, drawLayer);
  var focused = '';
  var cursor = document.createElement('style');
  cursor.textContent = '*{cursor:crosshair!important}';
  function post(m) { m.tag = TAG; window.parent.postMessage(m, office); }
  function place(box, el) {
    if (!el || !el.isConnected) { box.style.display = 'none'; return; }
    var r = el.getBoundingClientRect();
    box.style.display = 'block';
    box.style.left = r.left + 'px'; box.style.top = r.top + 'px'; box.style.width = r.width + 'px'; box.style.height = r.height + 'px';
  }
  var ID = /^[A-Za-z][\w-]*$/;
  function unique(sel) { try { return document.querySelectorAll(sel).length === 1; } catch (e) { return false; } }
  function selectorOf(el) {
    var parts = [];
    for (var n = el; n && n.nodeType === 1 && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      if (n.id && ID.test(n.id) && unique('#' + n.id)) { parts.unshift('#' + n.id); return parts.join(' > '); }
      var test = n.getAttribute('data-testid');
      if (test && unique('[data-testid="' + test.replace(/"/g, '\\"') + '"]')) { parts.unshift('[data-testid="' + test.replace(/"/g, '\\"') + '"]'); return parts.join(' > '); }
      var tag = n.tagName.toLowerCase();
      var same = n.parentElement ? Array.prototype.filter.call(n.parentElement.children, function (c) { return c.tagName === n.tagName; }) : [];
      parts.unshift(same.length > 1 ? tag + ':nth-of-type(' + (same.indexOf(n) + 1) + ')' : tag);
    }
    return 'body > ' + parts.join(' > ');
  }
  function clip(s, n) { s = (s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '\u2026' : s; }
  function describe(el) {
    var tag = el.tagName.toLowerCase();
    var text = clip(el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('alt') || el.getAttribute('placeholder') || '', 60);
    var role = el.getAttribute('role');
    var kind = tag === 'a' ? 'the link' : tag === 'button' || role === 'button' ? 'the button' : /^h[1-6]$/.test(tag) ? 'the heading' : tag === 'img' ? 'the picture' : tag === 'svg' ? 'the icon' : tag === 'input' || tag === 'textarea' || tag === 'select' ? 'the ' + (el.getAttribute('type') || tag) + ' field' : tag === 'p' || tag === 'span' || tag === 'label' ? 'the text' : 'the ' + tag;
    return text ? kind + ' \u201c' + text + '\u201d' : kind;
  }
  function target(e) {
    var el = e.target;
    if (el && el.closest) { var svg = el.closest('svg'); if (svg) el = svg; }
    return el && el.nodeType === 1 && el !== document.documentElement && el !== document.body ? el : null;
  }
  function find(sel) { if (!sel) return null; try { return document.querySelector(sel); } catch (e) { return null; } }
  // ---- Areas: drawn round what's in them ----
  var PICKABLE = 'img,svg,video,canvas,picture,button,a,h1,h2,h3,h4,h5,h6,p,li,input,textarea,select,label,figure,[role="button"],[role="img"],[data-testid]';
  function bounds(p) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (var i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]); }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  function inside(x, y, p) {
    var c = false;
    for (var i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
      var xi = p[i], yi = p[i + 1], xj = p[j], yj = p[j + 1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  }
  // What an area takes in: what shows at least half inside it (a ring: its middle inside the ring), the
  // innermost of those (the picture, not the link round it), up to twelve, in the page's order.
  function within(b, ring) {
    var found = [];
    Array.prototype.forEach.call(document.querySelectorAll(PICKABLE), function (el) {
      if (host.contains(el) || (el.parentElement && el.parentElement.closest('svg'))) return;
      var r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return;
      var ix = Math.max(0, Math.min(r.right, b.x + b.w) - Math.max(r.left, b.x)), iy = Math.max(0, Math.min(r.bottom, b.y + b.h) - Math.max(r.top, b.y));
      if (ix * iy < 0.5 * r.width * r.height) return;
      if (ring && !inside(r.left + r.width / 2, r.top + r.height / 2, ring)) return;
      var st = getComputedStyle(el);
      if (st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity) === 0) return;
      found.push(el);
    });
    found = found.filter(function (el) { return !found.some(function (o) { return o !== el && el.contains(o); }); });
    return found.slice(0, 12).map(function (el) { return { what: describe(el), selector: selectorOf(el) }; });
  }
  /** A ring's points relative to its bounds (0 to 1), at most 64 of them. */
  function relative(p, b) {
    var n = p.length / 2, step = Math.max(1, Math.ceil(n / 64)), out = [];
    for (var i = 0; i < n; i += step) out.push(Math.round((p[2 * i] - b.x) / b.w * 1000) / 1000, Math.round((p[2 * i + 1] - b.y) / b.h * 1000) / 1000);
    return out;
  }
  function shapeEl(s, cls) {
    var ox = s.x - scrollX, oy = s.y - scrollY, el;
    if (s.shape === 'lasso' && s.points && s.points.length >= 6) {
      el = document.createElementNS(SVG, 'polygon');
      var pts = [];
      for (var i = 0; i < s.points.length; i += 2) pts.push((ox + s.points[i] * s.w) + ',' + (oy + s.points[i + 1] * s.h));
      el.setAttribute('points', pts.join(' '));
    } else {
      el = document.createElementNS(SVG, 'rect');
      el.setAttribute('x', ox); el.setAttribute('y', oy); el.setAttribute('width', s.w); el.setAttribute('height', s.h); el.setAttribute('rx', 6);
    }
    el.setAttribute('class', 's ' + (cls || ''));
    shapeLayer.appendChild(el);
    return { x: ox, y: oy };
  }
  function drawShapes() {
    shapeLayer.textContent = '';
    shapes.forEach(function (s) {
      var at = shapeEl(s, s.state === 'draft' || s.state === 'done' ? s.state : '');
      if (at.y + s.h < 0 || at.y > innerHeight) return;
      var d = document.createElement('div'); d.className = 'pin' + (s.state === 'draft' || s.state === 'done' ? ' ' + s.state : ''); d.textContent = s.state === 'done' ? '✓' : String(s.n);
      d.style.left = Math.max(12, at.x) + 'px'; d.style.top = Math.max(12, at.y) + 'px';
      pinLayer.appendChild(d);
    });
    if (focusedArea) shapeEl(focusedArea, 'focus');
    if (area) shapeEl(area, 'now');
    if (drawing) {
      if (tool === 'lasso') {
        var line = document.createElementNS(SVG, 'polyline');
        var pts = [];
        for (var i = 0; i < drawing.pts.length; i += 2) pts.push(drawing.pts[i] + ',' + drawing.pts[i + 1]);
        line.setAttribute('points', pts.join(' ')); line.setAttribute('class', 's now');
        shapeLayer.appendChild(line);
      } else if (drawing.x1 !== undefined) {
        var b = bounds([drawing.x0, drawing.y0, drawing.x1, drawing.y1]);
        shapeEl({ shape: 'rect', x: b.x + scrollX, y: b.y + scrollY, w: b.w, h: b.h }, 'now');
      }
    }
  }
  drawLayer.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    drawLayer.setPointerCapture(e.pointerId);
    drawing = { x0: e.clientX, y0: e.clientY, pts: [e.clientX, e.clientY] };
    area = null; picked = null;
    drawPins();
  });
  drawLayer.addEventListener('pointermove', function (e) {
    if (!drawing) return;
    var n = drawing.pts.length;
    if (tool === 'lasso' && Math.abs(e.clientX - drawing.pts[n - 2]) + Math.abs(e.clientY - drawing.pts[n - 1]) > 4) drawing.pts.push(e.clientX, e.clientY);
    drawing.x1 = e.clientX; drawing.y1 = e.clientY;
    drawPins();
  });
  drawLayer.addEventListener('pointerup', function (e) {
    if (!drawing) return;
    var d = drawing; drawing = null;
    var ring = tool === 'lasso' ? d.pts.concat([e.clientX, e.clientY]) : null;
    var b = ring ? bounds(ring) : bounds([d.x0, d.y0, e.clientX, e.clientY]);
    if (b.w < 8 || b.h < 8) { drawPins(); return; }
    area = { shape: ring ? 'lasso' : 'rect', x: Math.round(b.x + scrollX), y: Math.round(b.y + scrollY), w: Math.round(b.w), h: Math.round(b.h), items: within(b, ring) };
    if (ring) area.points = relative(ring, b);
    drawPins();
    post({ t: 'area', area: area, page: location.pathname + location.search + location.hash });
  });
  function drawPins() {
    pinLayer.textContent = '';
    drawShapes();
    pins.forEach(function (p) {
      var el = find(p.selector);
      if (!el) return;
      var r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) return;
      var d = document.createElement('div'); d.className = 'pin' + (p.state === 'draft' || p.state === 'done' ? ' ' + p.state : ''); d.textContent = p.state === 'done' ? '\u2713' : String(p.n);
      d.style.left = Math.max(12, r.left) + 'px'; d.style.top = Math.max(12, r.top) + 'px';
      pinLayer.appendChild(d);
    });
    place(selBox, picked);
    place(focusBox, find(focused));
  }
  function setCommenting(on, t) {
    commenting = on;
    tool = on && (t === 'rect' || t === 'lasso') ? t : 'pick';
    drawLayer.style.display = on && tool !== 'pick' ? 'block' : 'none';
    if (on) document.head.appendChild(cursor); else { cursor.remove(); drawing = null; }
    if (!on || tool !== 'pick') { hover = null; place(hoverBox, null); }
  }
  var swallow = function (e) { if (commenting && !host.contains(e.target)) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); } };
  ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dblclick', 'contextmenu', 'submit', 'touchstart', 'touchend'].forEach(function (t) { window.addEventListener(t, swallow, true); });
  window.addEventListener('mousemove', function (e) {
    if (!commenting || tool !== 'pick') return;
    var el = target(e);
    if (el !== hover) { hover = el; place(hoverBox, hover); }
  }, true);
  window.addEventListener('click', function (e) {
    if (!commenting) return;
    swallow(e);
    if (tool !== 'pick') return;
    area = null;
    var el = target(e);
    if (!el) return;
    picked = el; place(selBox, el); place(hoverBox, null);
    var r = el.getBoundingClientRect();
    post({ t: 'picked', pick: { selector: selectorOf(el), what: describe(el), rect: { x: r.left, y: r.top, w: r.width, h: r.height } }, page: location.pathname + location.search + location.hash });
  }, true);
  window.addEventListener('message', function (e) {
    var m = e.data;
    if (e.origin !== office || !m || m.tag !== TAG) return;
    if (m.t === 'comment') setCommenting(!!m.on, m.tool);
    else if (m.t === 'pins') { pins = Array.isArray(m.pins) ? m.pins : []; shapes = Array.isArray(m.shapes) ? m.shapes : []; if (!m.keep) { picked = null; area = null; } drawPins(); }
    else if (m.t === 'focus') { focused = typeof m.selector === 'string' ? m.selector : ''; focusedArea = m.area && typeof m.area.x === 'number' ? m.area : null; place(focusBox, find(focused)); drawPins(); }
    else if (m.t === 'reveal') {
      if (m.area && typeof m.area.y === 'number') window.scrollTo({ top: Math.max(0, m.area.y - innerHeight / 3), behavior: 'smooth' });
      else { var el = find(m.selector); if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    }
    else if (m.t === 'go' && typeof m.path === 'string' && m.path.charAt(0) === '/') location.assign(m.path);
    else if (m.t === 'reload') location.reload();
    else if (m.t === 'back') history.back();
  });
  // Keys pressed in the page reach the office's window only this way: Esc, and C for comment mode (B
  // and O for the box and circle) when it isn't typed into something of the app's.
  window.addEventListener('keydown', function (e) {
    var t = e.target, typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    var k = e.key.toLowerCase();
    if (e.key === 'Escape' || (!typing && !e.metaKey && !e.ctrlKey && !e.altKey && (k === 'c' || k === 'b' || k === 'o'))) post({ t: 'key', key: e.key === 'Escape' ? 'Escape' : k });
  }, true);
  var where = '';
  function tellWhere() {
    var now = location.pathname + location.search + location.hash;
    if (now === where) return;
    where = now;
    post({ t: 'where', page: now, title: document.title });
  }
  addEventListener('scroll', function () { place(hoverBox, hover); drawPins(); }, true);
  addEventListener('resize', drawPins);
  setInterval(function () { tellWhere(); drawPins(); }, 500);
  function start() { document.documentElement.appendChild(host); tellWhere(); post({ t: 'ready', page: where, title: document.title }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
`;

/** The page with the review script added: first thing in its head, so it's there before the app's own. */
export function injectOverlay(html: string, office: string): string {
  const tag = `<script src="${REVIEW_SCRIPT}" data-office="${office.replace(/[&"<>]/g, '')}" defer></script>`;
  // (`office` may be two origins with a space between them: see relay.ts reviewOffice.)
  const head = /<head(\s[^>]*)?>/i.exec(html);
  if (head) return html.slice(0, head.index + head[0].length) + tag + html.slice(head.index + head[0].length);
  const root = /<html(\s[^>]*)?>/i.exec(html);
  if (root) return html.slice(0, root.index + root[0].length) + tag + html.slice(root.index + root[0].length);
  return tag + html;
}
