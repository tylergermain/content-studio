import './canvas.css';
import { store } from '../../state';
import { h } from '../dom';
import { ARTBOARD } from '../../../shared/design-canvas';
import { artifactKey, type ChatArtifact } from '../../../shared/worker-chat';
import { fileTime, latestLinked } from './files';
import { artboardOf, artboardsOf, describe, elementAt, findAgain, layOut, pathTo, whereOf } from './canvas-dom';
import { paperPicker, type PaperFile } from './canvas-paper';
import type { Panel, WorkspaceHost } from './types';

// The design canvas (the Canvas tab, first on the Design board): a designer's design (a `.design.html`
// file, see shared/design-canvas.ts) laid out like a design tool's page, live: it shows each save
// within a couple of seconds. Drag or scroll to move about, pinch or \u2318-scroll to zoom, 0 to fit.
// Click any element to pin a note to it; the notes go to the designer as one revision request that
// names each element, and the designer makes the changes in the same file while you watch. Export
// saves every artboard as a PNG beside the design, and an admin can bring a page of a Paper file in.
// The design itself is served with scripts off (http/routes/canvas.ts): the canvas reads it, never runs it.

/** A note pinned to an element of the design, before it's sent. */
interface Note {
  /** The artboard it's on (its name), and the path to the element from there (see pathTo). */
  board?: string;
  path: string;
  /** Where it is, for the designer (see whereOf), and in a few words for the list. */
  where: string;
  short: string;
  text: string;
  /** Where on the artboard it was, as a fraction of its size: where its pin goes if the element is gone. */
  fx: number;
  fy: number;
}

const POLL_MS = 1500;
const ZOOM = { min: 0.02, max: 4 } as const;
const MARGIN = 40;
const enc = encodeURIComponent;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const ref = (f: ChatArtifact) => (f.root ? { root: f.root, path: f.path } : { path: f.path });

export function designCanvas(host: WorkspaceHost): Panel {
  let files: ChatArtifact[] = [];
  let current: ChatArtifact | undefined;
  /** The viewer picked a design, so a newer one no longer takes over by itself. */
  let touched = false;
  let doc: Document | undefined;
  /** The version of the design showing (its modified time), and whether it's been fitted to the stage yet. */
  let loaded = 0;
  let fitted = false;
  let view = { x: 0, y: 0, s: 1 };
  let hover: Element | undefined;
  let selected: Element | undefined;
  const notesBy = new Map<string, Note[]>();
  let timer: ReturnType<typeof setInterval> | undefined;
  let asking = false;
  let stopped = false;

  const btn = (label: string, title: string) => h('button.btn.small', { type: 'button', title }, label);
  const pick = h('select.canvas-pick', { 'aria-label': 'Design' }) as HTMLSelectElement;
  const zoomOut = btn('\u2212', 'Zoom out (-)');
  const zoomIn = btn('+', 'Zoom in (+)');
  const zoomLabel = btn('100%', 'Fit everything (0)');
  zoomLabel.classList.add('canvas-zoom');
  const live = h('span.canvas-live', { title: 'Changes the designer saves show up here by themselves' });
  const exportBtn = btn('Export PNGs', 'Save every artboard as a PNG beside the design');
  const paperBtn = btn('Import from Paper', 'Bring a page of a Paper file in as a design');
  const status = h('p.canvas-status', { 'aria-live': 'polite' });
  const frame = h('iframe.canvas-frame', { sandbox: 'allow-same-origin', title: 'Design', tabindex: '-1', 'aria-hidden': 'true' }) as HTMLIFrameElement;
  const hoverBox = h('div.canvas-box.hover');
  const selBox = h('div.canvas-box.sel');
  const labels = h('div.canvas-labels');
  const pins = h('div.canvas-pins');
  const overlay = h('div.canvas-overlay', {}, labels, hoverBox, selBox, pins);
  const pop = h('div.canvas-pop.hidden', { role: 'dialog', 'aria-label': 'Pin a note' });
  const empty = h('div.canvas-empty.hidden');
  const paperSlot = h('div.canvas-paper-slot');
  const stage = h('div.canvas-stage', {}, frame, overlay, pop, empty, paperSlot);
  const noteList = h('ol.canvas-notes-list');
  const sendBtn = h('button.btn.primary.small', { type: 'button' }, 'Send notes');
  const notesBar = h('div.canvas-notes.hidden', {}, h('div.canvas-notes-head', {}, h('strong', {}, 'Notes'), sendBtn), noteList);
  const element = h('div.ws-canvas', {},
    h('div.canvas-bar', {}, pick, h('div.canvas-zoomer', { role: 'group', 'aria-label': 'Zoom' }, zoomOut, zoomLabel, zoomIn), live, h('span.canvas-spacer'), exportBtn, paperBtn),
    stage, status, notesBar);

  const notes = (): Note[] => {
    if (!current) return [];
    const key = artifactKey(current);
    if (!notesBy.has(key)) notesBy.set(key, []);
    return notesBy.get(key)!;
  };
  const canSend = () => host.canSend();

  function setStatus(text: string, error = false) {
    status.textContent = text;
    status.classList.toggle('error', error);
  }

  const docUrl = (f: ChatArtifact, v: number) => `/api/canvas/doc/${enc(store.floor ?? '')}/${enc(host.workerId)}/${f.path.split('/').map(enc).join('/')}?v=${Math.round(v)}`;
  async function api<T>(path: string, body?: unknown, q: Record<string, string> = {}): Promise<T> {
    const params = new URLSearchParams({ floor: store.floor ?? '', worker: host.workerId, ...q });
    const res = await fetch(`/api/canvas/${path}?${params}`, { credentials: 'same-origin', cache: 'no-store', ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    const out = await res.json().catch(() => undefined);
    if (!res.ok || !out) throw new Error(out?.error ?? 'The office didn\u2019t answer');
    return out as T;
  }

  // ---- Where things are: the frame's coordinates are the stage's, with the design moved and scaled in it ----

  function apply() {
    if (doc?.documentElement) doc.documentElement.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.s})`;
    zoomLabel.textContent = `${Math.round(view.s * 100)}%`;
    repaint();
  }

  /** The artboards' extent in the design's own pixels. */
  function bounds(): { x: number; y: number; w: number; h: number } | undefined {
    if (!doc) return undefined;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const b of artboardsOf(doc)) {
      const r = b.getBoundingClientRect();
      x0 = Math.min(x0, (r.left - view.x) / view.s);
      y0 = Math.min(y0, (r.top - view.y) / view.s);
      x1 = Math.max(x1, (r.right - view.x) / view.s);
      y1 = Math.max(y1, (r.bottom - view.y) / view.s);
    }
    return Number.isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : undefined;
  }

  function fit() {
    const b = bounds();
    const W = stage.clientWidth, H = stage.clientHeight;
    if (!b || !W || !H) return;
    const s = clamp(Math.min((W - 2 * MARGIN) / b.w, (H - 2 * MARGIN) / b.h), ZOOM.min, 1);
    view = { s, x: (W - b.w * s) / 2 - b.x * s, y: (H - b.h * s) / 2 - b.y * s };
    apply();
  }

  function zoomAt(px: number, py: number, by: number) {
    const s = clamp(view.s * by, ZOOM.min, ZOOM.max);
    view = { s, x: px - ((px - view.x) * s) / view.s, y: py - ((py - view.y) * s) / view.s };
    apply();
  }
  const zoomCenter = (by: number) => zoomAt(stage.clientWidth / 2, stage.clientHeight / 2, by);
  zoomIn.addEventListener('click', () => zoomCenter(1.25));
  zoomOut.addEventListener('click', () => zoomCenter(0.8));
  zoomLabel.addEventListener('click', fit);

  const place = (box: HTMLElement, el: Element | undefined) => {
    const ok = !!el && el.isConnected && el.ownerDocument === doc;
    box.hidden = !ok;
    if (!ok) return;
    const r = el!.getBoundingClientRect();
    Object.assign(box.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  };

  /** The boxes, the artboards' names and the pins, where the design is now. */
  function repaint() {
    place(hoverBox, hover !== selected ? hover : undefined);
    place(selBox, selected);
    if (!doc) {
      labels.replaceChildren();
      pins.replaceChildren();
      return;
    }
    labels.replaceChildren(...[...doc.querySelectorAll<HTMLElement>(`[${ARTBOARD}]`)].map((b) => {
      const r = b.getBoundingClientRect();
      return h('span.canvas-label', { style: `left:${r.left}px;top:${r.top - 20}px;max-width:${Math.max(40, r.width)}px` }, b.getAttribute(ARTBOARD) || 'Artboard');
    }));
    pins.replaceChildren(...notes().map((n, i) => {
      const el = findAgain(doc!, n.board, n.path);
      let x: number, y: number;
      if (el) {
        const r = el.getBoundingClientRect();
        x = r.left;
        y = r.top;
      } else {
        const board = n.board === undefined ? doc!.body : artboardsOf(doc!).find((b) => b.getAttribute(ARTBOARD) === n.board);
        const r = board?.getBoundingClientRect();
        x = r ? r.left + n.fx * r.width : -99;
        y = r ? r.top + n.fy * r.height : -99;
      }
      return h('span.canvas-pin', { style: `left:${x}px;top:${y}px`, title: n.text }, String(i + 1));
    }));
    if (!pop.classList.contains('hidden') && selected) placePop();
  }

  // ---- Loading the design, and keeping it live ----

  function load(f: ChatArtifact, version = f.modified || Date.now(), keepView = false) {
    if (!keepView) {
      fitted = false;
      selected = hover = undefined;
      live.textContent = '';
      closePop();
    }
    loaded = version;
    frame.src = docUrl(f, version);
    renderNotes();
  }

  frame.addEventListener('load', () => {
    if (stopped) return;
    let d: Document | null = null;
    try {
      d = frame.contentDocument;
    } catch {
      d = null;
    }
    // A frame with no design yet holds about:blank, which fires its own load: nothing to show, nothing wrong.
    if (!current || !frame.getAttribute('src') || d?.URL === 'about:blank') return;
    if (!d || !d.body || !d.documentElement || d.contentType !== 'text/html') {
      doc = undefined;
      repaint();
      if (current) setStatus('This design couldn\u2019t be opened here. It may have moved.', true);
      return;
    }
    doc = d;
    layOut(d);
    // Reselect what was selected, by where it was: the page is new on every save.
    if (selected && current) {
      const board = artboardOf(selected)?.getAttribute(ARTBOARD) ?? undefined;
      selected = findAgain(d, board, pathTo(selected));
    }
    hover = undefined;
    if (!fitted) {
      // A new page has no transform yet: measure it as it is, then fit it.
      fitted = true;
      view = { x: 0, y: 0, s: 1 };
      apply();
      requestAnimationFrame(fit);
    } else apply();
    if (!artboardsOf(d).some((b) => b.hasAttribute(ARTBOARD))) setStatus('No artboards marked in this design: the whole page shows as one. A designer marks each with data-artboard="its name".');
    else if (/couldn\u2019t be opened|No artboards marked/.test(status.textContent ?? '')) setStatus('');
  });

  async function check() {
    if (!current || asking || stopped || element.hidden || !element.isConnected || document.visibilityState !== 'visible') return;
    asking = true;
    try {
      const s = await api<{ size: number; modified: number }>('stat', undefined, { path: current.path });
      // The time of the last change stays up until the next one.
      if (!live.textContent || live.classList.contains('gone')) live.textContent = '\u25cf Live';
      live.classList.remove('gone');
      if (Math.round(s.modified) !== Math.round(loaded)) {
        load(current, s.modified, true);
        live.textContent = `\u25cf Updated ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}`;
        live.classList.add('flash');
        setTimeout(() => live.classList.remove('flash'), 1200);
      }
    } catch {
      live.textContent = 'Not found';
      live.classList.add('gone');
    } finally {
      asking = false;
    }
  }

  // ---- Moving about: drag or scroll to pan, pinch or \u2318/Ctrl-scroll to zoom; a click picks an element ----

  const local = (e: { clientX: number; clientY: number }) => {
    const r = stage.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const down = new Map<number, { x: number; y: number }>();
  let drag: { x: number; y: number; moved: boolean } | undefined;
  let pinch: { d: number; s: number } | undefined;
  const spread = () => {
    const [a, b] = [...down.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  };

  overlay.addEventListener('pointerdown', (e) => {
    if (!doc) return;
    overlay.setPointerCapture(e.pointerId);
    const at = local(e);
    down.set(e.pointerId, at);
    if (down.size === 2) {
      pinch = { d: spread().d, s: view.s };
      drag = undefined;
    } else if (down.size === 1) drag = { ...at, moved: e.button === 1 };
  });
  overlay.addEventListener('pointermove', (e) => {
    const at = local(e);
    if (down.has(e.pointerId)) down.set(e.pointerId, at);
    if (pinch && down.size === 2) {
      const { d, cx, cy } = spread();
      zoomAt(cx, cy, (pinch.s * (d / Math.max(1, pinch.d))) / view.s);
      return;
    }
    if (drag) {
      if (!drag.moved && Math.hypot(at.x - drag.x, at.y - drag.y) > 4) drag.moved = true;
      if (drag.moved) {
        view.x += at.x - drag.x;
        view.y += at.y - drag.y;
        drag.x = at.x;
        drag.y = at.y;
        overlay.classList.add('panning');
        apply();
      }
      return;
    }
    if (e.pointerType === 'mouse' && doc) {
      const el = elementAt(doc, at.x, at.y);
      if (el !== hover) {
        hover = el;
        place(hoverBox, hover !== selected ? hover : undefined);
      }
    }
  });
  const up = (e: PointerEvent) => {
    const wasDrag = drag;
    down.delete(e.pointerId);
    if (down.size < 2) pinch = undefined;
    if (!down.size) {
      drag = undefined;
      overlay.classList.remove('panning');
    }
    if (e.type === 'pointerup' && wasDrag && !wasDrag.moved && doc) choose(elementAt(doc, local(e).x, local(e).y));
  };
  overlay.addEventListener('pointerup', up);
  overlay.addEventListener('pointercancel', up);
  overlay.addEventListener('pointerleave', () => {
    hover = undefined;
    place(hoverBox, undefined);
  });
  overlay.addEventListener('wheel', (e) => {
    if (!doc) return;
    e.preventDefault();
    const at = local(e);
    if (e.ctrlKey || e.metaKey) zoomAt(at.x, at.y, Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.01)));
    else {
      view.x -= e.deltaX;
      view.y -= e.deltaY;
      apply();
    }
  }, { passive: false });
  new ResizeObserver(() => repaint()).observe(stage);

  // ---- Notes pinned to elements ----

  function choose(el: Element | undefined) {
    selected = el;
    place(selBox, selected);
    place(hoverBox, undefined);
    if (el && canSend()) openPop(el);
    else closePop();
  }

  function placePop() {
    if (!selected) return;
    const r = selected.getBoundingClientRect();
    const W = stage.clientWidth, H = stage.clientHeight;
    const w = Math.min(320, W - 16);
    pop.style.width = `${w}px`;
    const below = r.bottom + 10;
    const top = below + 170 < H ? below : Math.max(8, r.top - 180);
    pop.style.left = `${clamp(r.left, 8, Math.max(8, W - w - 8))}px`;
    pop.style.top = `${clamp(top, 8, Math.max(8, H - 180))}px`;
  }

  function openPop(el: Element) {
    const input = h('textarea.canvas-input', { rows: 3, placeholder: 'What should change here?', 'aria-label': 'Note' }) as HTMLTextAreaElement;
    const add = h('button.btn.primary.small', { type: 'button' }, 'Add note');
    const cancel = h('button.btn.small', { type: 'button' }, 'Cancel');
    const board = artboardOf(el)?.getAttribute(ARTBOARD);
    pop.replaceChildren(h('p.canvas-where', {}, h('strong', {}, describe(el)), board ? ` on ${board}` : ''), input, h('div.canvas-row', {}, add, cancel));
    pop.classList.remove('hidden');
    placePop();
    const commit = () => {
      const text = input.value.trim();
      if (!text) return input.focus();
      const art = artboardOf(el);
      const ar = (art ?? doc!.body).getBoundingClientRect();
      const r = el.getBoundingClientRect();
      notes().push({ board: art?.getAttribute(ARTBOARD) ?? undefined, path: pathTo(el), where: whereOf(el), short: `${describe(el)}${board ? ` \u00b7 ${board}` : ''}`, text, fx: ar.width ? (r.left - ar.left) / ar.width : 0, fy: ar.height ? (r.top - ar.top) / ar.height : 0 });
      closePop();
      renderNotes();
      repaint();
    };
    add.addEventListener('click', commit);
    cancel.addEventListener('click', () => choose(undefined));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        commit();
      }
      e.stopPropagation();
    });
    setTimeout(() => input.focus({ preventScroll: true }), 0);
  }
  function closePop() {
    pop.classList.add('hidden');
    pop.replaceChildren();
  }

  function renderNotes() {
    const list = notes();
    notesBar.classList.toggle('hidden', !list.length);
    sendBtn.textContent = `Send ${list.length === 1 ? 'this note' : `${list.length} notes`} to ${host.workerName}`;
    noteList.replaceChildren(...list.map((n, i) => {
      const remove = h('button.canvas-remove', { type: 'button', 'aria-label': `Remove note ${i + 1}`, title: 'Remove' }, '\u2715');
      remove.addEventListener('click', () => {
        list.splice(i, 1);
        renderNotes();
        repaint();
      });
      return h('li', {}, h('span.canvas-pin.inline', {}, String(i + 1)), h('div', {}, h('span.canvas-note-where', {}, n.short), h('span.canvas-note-text', {}, n.text)), remove);
    }));
  }

  sendBtn.addEventListener('click', async () => {
    const list = notes();
    if (!current || !list.length) return;
    sendBtn.disabled = true;
    setStatus('Sending\u2026');
    try {
      await host.review({ kind: 'notes', files: [ref(current)], notes: list.map((n) => ({ at: 0, text: n.text, where: n.where })) });
      setStatus(`Sent ${list.length === 1 ? 'your note' : `${list.length} notes`}. ${host.workerName}\u2019s changes show up here as they\u2019re saved.`);
      list.length = 0;
      renderNotes();
      repaint();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'The notes couldn\u2019t be sent', true);
    } finally {
      sendBtn.disabled = false;
    }
  });

  // ---- Export, and Import from Paper ----

  exportBtn.addEventListener('click', async () => {
    if (!current) return;
    exportBtn.disabled = true;
    setStatus('Exporting every artboard\u2026');
    try {
      const out = await api<{ files: string[] }>('export', { path: current.path });
      setStatus(`Saved ${out.files.length} PNG${out.files.length === 1 ? '' : 's'} beside the design. They\u2019re on the Board tab.`);
      await host.refresh();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'The export didn\u2019t work', true);
    } finally {
      exportBtn.disabled = false;
    }
  });

  function closePaper() {
    paperSlot.replaceChildren();
  }
  paperBtn.addEventListener('click', () => {
    if (paperSlot.childElementCount) return closePaper();
    paperSlot.append(paperPicker({
      list: () => api<{ installed: boolean; files: PaperFile[] }>('paper'),
      bring: async (file) => {
        const out = await api<{ path: string; artboards: number; pictures: number; notes: string[] }>('paper', { fileId: file.id });
        closePaper();
        setStatus([`Brought \u201c${file.name}\u201d in: ${out.artboards} artboard${out.artboards === 1 ? '' : 's'} and ${out.pictures} picture${out.pictures === 1 ? '' : 's'}.`, ...out.notes].join(' '));
        await host.refresh();
        const name = out.path.split('/').pop() ?? out.path;
        show(files.find((f) => !f.root && f.path === out.path) ?? { path: out.path, name, type: 'text/html', size: 0, modified: Date.now() });
      },
      close: closePaper,
    }));
  });

  // ---- The panel ----

  function paintBar() {
    const all = current && !files.some((f) => artifactKey(f) === artifactKey(current!)) ? [current, ...files] : files;
    pick.replaceChildren(...all.map((f) => h('option', { value: artifactKey(f) }, `${f.name.replace(/\.design\.html$/i, '')} \u00b7 ${fileTime(f.modified)}`)));
    pick.value = current ? artifactKey(current) : '';
    pick.hidden = all.length < 2;
    exportBtn.hidden = !current || !canSend();
    paperBtn.hidden = !host.admin || !canSend();
    empty.classList.toggle('hidden', !!current);
    empty.replaceChildren(
      h('p', {}, h('strong', {}, 'No designs yet.')),
      h('p', {}, `When ${host.workerName} saves a design as a .design.html file and links it in the chat, it shows here live: you watch it take shape, click anything on it to pin a note, and send the notes back.`),
      host.admin && canSend() ? h('p', {}, 'Or bring one in from Paper with Import from Paper.') : '',
    );
  }
  pick.addEventListener('change', () => {
    const all = current ? [current, ...files] : files;
    const f = all.find((x) => artifactKey(x) === pick.value);
    if (f) show(f);
  });

  function show(f: ChatArtifact) {
    touched = true;
    const same = current && artifactKey(current) === artifactKey(f);
    current = f;
    paintBar();
    if (!same) load(f);
  }

  timer = setInterval(() => void check(), POLL_MS);

  return {
    element,
    paint(next, snapshot) {
      files = next;
      const keep = current && (next.find((f) => artifactKey(f) === artifactKey(current!)) ?? (touched ? current : undefined));
      const chosen = touched && keep ? keep : (latestLinked(next, snapshot) ?? keep ?? next[0]);
      const changed = !current || !chosen || artifactKey(current) !== artifactKey(chosen);
      current = chosen;
      paintBar();
      if (changed) {
        if (chosen) load(chosen);
        else {
          frame.removeAttribute('src');
          doc = undefined;
          repaint();
        }
      }
      renderNotes();
    },
    show,
    key(e) {
      if (e.key === '0') return fit(), true;
      if (e.key === '+' || e.key === '=') return zoomCenter(1.25), true;
      if (e.key === '-' || e.key === '_') return zoomCenter(0.8), true;
      return false;
    },
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
    },
  };
}
