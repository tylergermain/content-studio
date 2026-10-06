import { REVIEW_SCRIPT, REVIEW_TAG } from '../../shared/software-review.js';

// The script the relay adds to a worker's pages in review mode (see review.ts): it does nothing at
// all unless the page is framed by the office (`office`, the origin it was told), and then only what
// the office asks over postMessage. In comment mode it outlines the element under the pointer, and a
// click on one tells the office which element it was instead of reaching the app. It draws the
// numbered pins of the comments so far, and says where the page is whenever that changes (a link, a
// route in a single-page app), so the office's address bar follows. Its own drawing is in a closed
// shadow root over everything, which no app's styles reach.

/** The script, served at REVIEW_SCRIPT on each worker's server. Plain JavaScript: browsers run it as it is. */
export const OVERLAY_JS = String.raw`(function () {
  var me = document.currentScript;
  var office = me && me.getAttribute('data-office');
  if (!office || window.parent === window || window.__agentOfficeReview) return;
  window.__agentOfficeReview = true;
  var TAG = '${REVIEW_TAG}';
  var commenting = false, hover = null, picked = null, pins = [];
  var host = document.createElement('div');
  host.setAttribute('data-agent-office', 'review');
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
  var root = host.attachShadow({ mode: 'closed' });
  var css = document.createElement('style');
  css.textContent = '.box{position:fixed;box-sizing:border-box;border:2px solid #0a84ff;border-radius:2px;background:rgba(10,132,255,.08);display:none}' +
    '.sel{border-color:#ff9f0a;background:rgba(255,159,10,.1)}' +
    '.pin{position:fixed;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50% 50% 50% 2px;background:#0a84ff;color:#fff;font:700 11px/22px system-ui,sans-serif;text-align:center;box-shadow:0 2px 6px rgba(0,0,0,.3)}';
  var hoverBox = document.createElement('div'); hoverBox.className = 'box';
  var selBox = document.createElement('div'); selBox.className = 'box sel';
  var pinLayer = document.createElement('div');
  root.append(css, hoverBox, selBox, pinLayer);
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
  function drawPins() {
    pinLayer.textContent = '';
    pins.forEach(function (p) {
      var el = null; try { el = document.querySelector(p.selector); } catch (e) {}
      if (!el) return;
      var r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) return;
      var d = document.createElement('div'); d.className = 'pin'; d.textContent = String(p.n);
      d.style.left = r.left + 'px'; d.style.top = r.top + 'px';
      pinLayer.appendChild(d);
    });
    place(selBox, picked);
  }
  function setCommenting(on) {
    commenting = on;
    if (on) document.head.appendChild(cursor); else { cursor.remove(); hover = null; place(hoverBox, null); }
  }
  var swallow = function (e) { if (commenting && !host.contains(e.target)) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); } };
  ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dblclick', 'contextmenu', 'submit', 'touchstart', 'touchend'].forEach(function (t) { window.addEventListener(t, swallow, true); });
  window.addEventListener('mousemove', function (e) {
    if (!commenting) return;
    var el = target(e);
    if (el !== hover) { hover = el; place(hoverBox, hover); }
  }, true);
  window.addEventListener('click', function (e) {
    if (!commenting) return;
    swallow(e);
    var el = target(e);
    if (!el) return;
    picked = el; place(selBox, el); place(hoverBox, null);
    var r = el.getBoundingClientRect();
    post({ t: 'picked', pick: { selector: selectorOf(el), what: describe(el), rect: { x: r.left, y: r.top, w: r.width, h: r.height } }, page: location.pathname + location.search + location.hash });
  }, true);
  window.addEventListener('message', function (e) {
    var m = e.data;
    if (e.origin !== office || !m || m.tag !== TAG) return;
    if (m.t === 'comment') setCommenting(!!m.on);
    else if (m.t === 'pins') { pins = Array.isArray(m.pins) ? m.pins : []; if (!m.keep) picked = null; drawPins(); }
    else if (m.t === 'go' && typeof m.path === 'string' && m.path.charAt(0) === '/') location.assign(m.path);
    else if (m.t === 'reload') location.reload();
    else if (m.t === 'back') history.back();
  });
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
  const head = /<head(\s[^>]*)?>/i.exec(html);
  if (head) return html.slice(0, head.index + head[0].length) + tag + html.slice(head.index + head[0].length);
  const root = /<html(\s[^>]*)?>/i.exec(html);
  if (root) return html.slice(0, root.index + root[0].length) + tag + html.slice(root.index + root[0].length);
  return tag + html;
}
