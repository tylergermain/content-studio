import '../board.css';
import './room.css';
import { h } from '../../dom';
import { artifactKey, type ChatArtifact, type ChatSnapshot, type ReviewRequest } from '../../../../shared/worker-chat';
import { versionLabel } from '../../../../shared/workspace';
import { LETTERS, shape, youTubeView } from '../board';
import { fileSize, fileTime, fileTitle, latestLinked, originOf, reviewsOf, sections } from '../files';
import { marks as loadMarks } from '../marks';
import { draftKey, sentNotes } from '../notes';
import { notesSide, type NotePin, type ShownNote } from '../notes-side';
import type { RoomHandle } from '../room-attach';
import { approveControls, openRoomShell } from '../room-shell';
import type { WorkspaceHost } from '../types';

// The image board full screen, as Frame.io reviews a still: the image as big as the room allows on a dark stage
// (click it for its actual pixels), every image along a filmstrip under it, two to four side by side (\u2318-click them,
// lettered A to D), or each at the size YouTube shows it. Comment mode (C) pins the next comment to the point
// clicked on the image; the comments are down the right (notes-side.ts). Approve picks it; Ask for variations sends
// the image, or the ones side by side, back with what to try.

type FileRef = { root?: string; path: string };
type View = 'one' | 'compare' | 'youtube';
const MOST = 4;
const POLL_MS = 15_000;
const ref = (f: FileRef): FileRef => (f.root ? { root: f.root, path: f.path } : { path: f.path });
const same = (a: FileRef | undefined, b: FileRef | undefined) => !!a && !!b && artifactKey(a) === artifactKey(b);
/** A point on the image, as a comment names it: words the worker reads, and the room reads back to pin it. */
const POINT = /(\d{1,3})% across and (\d{1,3})% down/;
const pointWhere = (x: number, y: number) => `the point ${x}% across and ${y}% down`;

export function openBoardRoom(host: WorkspaceHost, o: { files: ChatArtifact[]; data: ChatSnapshot; file?: ChatArtifact; onClose(): void }): RoomHandle {
  let files: ChatArtifact[] = [];
  let data = o.data;
  let current: ChatArtifact | undefined;
  let side: string[] = [];
  let view: View = 'one';
  let commenting = false;
  let point: { x: number; y: number } | undefined;
  let actual = false;
  let focused = '';
  let waiting: Set<string> | undefined;
  let poll = 0;

  const nameOf = (f: FileRef & { name?: string }) => versionLabel(f.path) ?? f.name ?? f.path.split('/').pop() ?? f.path;
  const byKey = () => new Map(files.map((f) => [artifactKey(f), f]));
  const sideFiles = () => side.map((k) => byKey().get(k)).filter((f): f is ChatArtifact => !!f);

  const shell = openRoomShell({
    className: 'board-room',
    label: `${host.workerName}\u2019s images`,
    doing: `looking at ${host.workerName}\u2019s images`,
    key: onKey,
    escape: () => {
      if (sheet.childElementCount) return closeSheet(), true;
      if (notes.writing()) return (document.activeElement as HTMLElement).blur(), true;
      if (point) return clearPoint(), true;
      if (commenting) return setCommenting(false), true;
      return false;
    },
    onClose: () => {
      window.clearInterval(poll);
      o.onClose();
    },
  });

  // ---- The frame ----
  const badge = h('span.rr-badge');
  const line = h('span.rr-title-line', {}, badge);
  shell.name.before(line);
  line.append(shell.name);
  shell.sub.textContent = host.workerName;
  const meta = h('span.rr-meta');
  shell.middle.classList.add('rr-mid');
  shell.middle.append(meta);
  const views = h('div.rr-sizes', { role: 'group', 'aria-label': 'View' }, ...(['one', 'compare', 'youtube'] as View[]).map((v) => {
    const b = h('button', { type: 'button', 'data-view': v, title: v === 'one' ? 'One image (1)' : v === 'compare' ? 'Side by side: \u2318-click images in the strip (2)' : 'At the size YouTube shows it (Y)' }, v === 'one' ? 'One' : v === 'compare' ? 'Compare' : 'YouTube size');
    b.addEventListener('click', () => setView(v));
    return b;
  }));
  const approval = approveControls({ workerName: host.workerName, approve: async () => current && review({ kind: 'approve', files: [ref(current)] }) });
  const vary = h('button.rr-ghost', { type: 'button', title: 'Send it back with what to try' }, 'Ask for variations');
  const openOut = h('a.rr-btn', { target: '_blank', rel: 'noopener', title: 'Open the image in a tab of its own', 'aria-label': 'Open in a new tab' }, '\u2197');
  shell.right.append(views, approval.pill, vary, approval.button, openOut);

  const show = h('div.br-show');
  const sheet = h('div.rr-sheet.hidden');
  const useBtn = h('button', { type: 'button', 'aria-pressed': 'true', title: 'Look at it' }, h('span.rr-mode-icon', { 'aria-hidden': 'true' }, '\u2196'), 'View');
  const commentBtn = h('button', { type: 'button', 'aria-pressed': 'false', title: 'Click a point on the image to comment on it (C)' }, h('span.rr-mode-icon', { 'aria-hidden': 'true' }, '\u{1f4ac}'), 'Comment', h('kbd', {}, 'C'));
  const modes = h('div.rr-modes', { role: 'group', 'aria-label': 'Mode' }, useBtn, commentBtn);
  const strip = h('div.br-strip', { role: 'group', 'aria-label': 'Images' });
  shell.stage.classList.add('br-stage');
  shell.stage.append(h('div.br-main', {}, show, modes, sheet), strip);

  const notes = notesSide({
    workerName: host.workerName,
    whole: 'the whole image',
    hint: 'Press C, then click a point on the image to pin a comment there. Or write one below about the whole image.',
    canSend: () => host.canSend(),
    pick: () => (point ? { where: pointWhere(point.x, point.y), label: `a point ${point.x}% across, ${point.y}% down`, pin: { x: point.x, y: point.y } } satisfies NotePin : undefined),
    unpick: () => clearPoint(),
    changed: () => {
      drawPins();
      paintTop();
    },
    focus: (s) => {
      focused = s?.key ?? '';
      drawPins();
    },
    reveal: (s) => {
      focused = s.key;
      if (view !== 'one') setView('one');
      drawPins();
    },
    send: async (list) => {
      if (current) await review({ kind: 'notes', files: [ref(current)], notes: list });
    },
    mark: async (key, done) => {
      notes.setMarks(await loadMarks(host.workerId, { key, done }));
      drawPins();
      paintTop();
    },
  });
  shell.side(notes.element);

  async function review(r: Omit<ReviewRequest, 'requestId'>) {
    await host.review(r);
  }

  // ---- What shows ----
  function select(f: ChatArtifact, add = false) {
    if (add) {
      const k = artifactKey(f);
      side = side.includes(k) ? side.filter((x) => x !== k) : [...side, k].slice(-MOST);
      if (!side.length) side = [k];
      if (side.length > 1 && view === 'one') view = 'compare';
      if (side.length < 2 && view === 'compare') view = 'one';
    } else side = [artifactKey(f)];
    if (!same(current, f) || !add) {
      current = side.includes(artifactKey(f)) ? f : sideFiles()[0] ?? f;
      point = undefined;
      actual = false;
      notes.setFile({ draftKey: draftKey(host.workerId, current), label: nameOf(current), file: current });
      notes.setSent(sentNotes(data.messages, current).slice(0, 5), nameOf);
    }
    paintAll();
  }
  function setView(v: View) {
    if (v === 'compare' && side.length < 2) {
      // Side by side wants two: the one before it in the strip joins it.
      const at = files.findIndex((f) => same(f, current));
      const other = files[at + 1] ?? files[at - 1];
      if (other) side = [...side, artifactKey(other)];
    }
    if (v === 'one' && current) side = [artifactKey(current)];
    view = v;
    if (v !== 'one') setCommenting(false);
    paintAll();
  }

  function paintShow() {
    const list = sideFiles();
    show.dataset.view = view;
    if (!current) {
      show.replaceChildren(h('div.rr-notice', {}, h('strong', {}, 'No images yet'), h('p', {}, `When ${host.workerName} links a thumbnail or a graphic in the chat, it shows here.`)));
      return;
    }
    if (view === 'youtube') return show.replaceChildren(youTubeView(list.length ? list : [current], host.url));
    if (view === 'compare' && list.length > 1) {
      show.replaceChildren(h('div.br-compare', { 'data-n': list.length }, ...list.map((f, i) => {
        const fig = h('figure.br-option', { 'data-current': String(same(f, current)), title: 'Click to comment on this one, double-click to see it alone' },
          h('div.br-frame', {}, h('img', { src: host.url(f), alt: f.name, decoding: 'async', draggable: 'false' })),
          h('figcaption', {}, h('span.br-letter', {}, LETTERS[i]), h('span', {}, nameOf(f))));
        fig.addEventListener('click', () => {
          current = f;
          notes.setFile({ draftKey: draftKey(host.workerId, f), label: nameOf(f), file: f });
          notes.setSent(sentNotes(data.messages, f).slice(0, 5), nameOf);
          paintAll();
        });
        fig.addEventListener('dblclick', () => select(f));
        return fig;
      })));
      return;
    }
    const img = h('img.br-img', { src: host.url(current), alt: current.name, decoding: 'async', draggable: 'false' }) as HTMLImageElement;
    const pins = h('div.br-pins');
    const pic = h('div.br-pic', { 'data-actual': String(actual) }, img, pins);
    img.addEventListener('load', () => {
      meta.textContent = [`${img.naturalWidth} \u00d7 ${img.naturalHeight}`, shape(img.naturalWidth, img.naturalHeight), fileSize(current!.size), fileTime(current!.modified)].join(' \u00b7 ');
      fit();
    });
    pic.addEventListener('click', (e) => {
      if (!commenting) {
        actual = !actual;
        pic.dataset.actual = String(actual);
        return fit();
      }
      const r = img.getBoundingClientRect();
      const x = Math.round(((e.clientX - r.left) / r.width) * 100), y = Math.round(((e.clientY - r.top) / r.height) * 100);
      if (x < 0 || y < 0 || x > 100 || y > 100) return;
      point = { x, y };
      notes.picked();
      drawPins();
    });
    show.replaceChildren(h('div.br-one', {}, pic));
    fit();
    drawPins();
  }

  /** As big as the room allows, or its actual pixels. */
  function fit() {
    const img = show.querySelector<HTMLImageElement>('.br-img');
    if (!img) return;
    img.style.maxWidth = actual ? 'none' : `${Math.max(100, show.clientWidth - 48)}px`;
    img.style.maxHeight = actual ? 'none' : `${Math.max(100, show.clientHeight - 48)}px`;
  }
  new ResizeObserver(fit).observe(show);

  /** The comments' pins on the image (the ones the filter shows), and the point picked for the next one. */
  function drawPins() {
    const layer = show.querySelector<HTMLElement>('.br-pins');
    if (!layer) return;
    const at = (s: ShownNote) => {
      if (typeof s.note.pin?.x === 'number' && typeof s.note.pin?.y === 'number') return { x: s.note.pin.x, y: s.note.pin.y };
      const m = POINT.exec(s.note.where ?? '');
      return m ? { x: Number(m[1]), y: Number(m[2]) } : undefined;
    };
    const pins: HTMLElement[] = notes.pins().flatMap((s) => {
      const p = at(s);
      if (!p) return [];
      const el = h(`button.br-pin.${s.state}`, { type: 'button', title: s.note.text, style: `left:${p.x}%;top:${p.y}%` }, s.state === 'done' ? '\u2713' : String(s.n ?? ''));
      el.classList.toggle('focus', s.key === focused);
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        notes.showKey(s.key);
      });
      return [el];
    });
    if (point) pins.push(h('span.br-pin.pending', { style: `left:${point.x}%;top:${point.y}%` }, '+'));
    layer.replaceChildren(...pins);
  }
  function clearPoint() {
    point = undefined;
    drawPins();
    notes.paint();
  }

  function setCommenting(on: boolean) {
    commenting = on && host.canSend() && !!current;
    if (commenting && view !== 'one') setView('one');
    commentBtn.setAttribute('aria-pressed', String(commenting));
    useBtn.setAttribute('aria-pressed', String(!commenting));
    commentBtn.disabled = !host.canSend();
    shell.root.classList.toggle('commenting', commenting);
    if (!commenting) clearPoint();
  }
  useBtn.addEventListener('click', () => setCommenting(false));
  commentBtn.addEventListener('click', () => setCommenting(true));

  function paintStrip() {
    const latest = latestLinked(files, data);
    strip.replaceChildren(...sections(files, data, host.workerName).flatMap((s) => [
      h('span.br-strip-label', {}, s.title),
      ...s.files.map((f) => {
        const k = artifactKey(f), at = side.indexOf(k);
        const b = h('button.br-thumb', { type: 'button', 'data-key': k, 'aria-pressed': String(at >= 0), title: `${fileTitle(f)}\nClick to show it, \u2318-click to compare` },
          h('img', { src: host.url(f), alt: '', loading: 'lazy', decoding: 'async' }),
          h('span.br-thumb-tag', {}, at >= 0 && side.length > 1 ? LETTERS[at] : same(f, latest) ? 'Latest' : versionLabel(f.path) ?? ''));
        b.addEventListener('click', (e) => select(f, e.metaKey || e.ctrlKey || e.shiftKey));
        return b;
      }),
    ]));
    strip.querySelector('[aria-pressed=true]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function paintTop() {
    if (!current) return;
    badge.textContent = versionLabel(current.path) ?? '';
    shell.name.textContent = current.name;
    shell.name.title = fileTitle(current);
    if (view !== 'one') meta.textContent = [fileSize(current.size), fileTime(current.modified)].join(' \u00b7 ');
    openOut.setAttribute('href', host.url(current));
    for (const b of views.querySelectorAll<HTMLElement>('button')) b.classList.toggle('on', b.dataset.view === view);
    const approved = reviewsOf(current, data).some((r) => r.kind === 'approve');
    approval.set({ status: approved ? 'approved' : notes.open() ? 'changes' : 'new', label: nameOf(current), can: host.canSend() });
    vary.disabled = !host.canSend();
    modes.hidden = view !== 'one';
  }

  function paintAll() {
    paintTop();
    paintShow();
    paintStrip();
  }

  // ---- Variations ----
  function closeSheet() {
    sheet.classList.add('hidden');
    sheet.replaceChildren();
  }
  vary.addEventListener('click', () => {
    const list = view === 'compare' && sideFiles().length > 1 ? sideFiles() : current ? [current] : [];
    if (!list.length) return;
    const many = list.length > 1;
    const text = h('textarea.rr-input', { rows: 3, maxlength: 3500, 'aria-label': 'What should change', placeholder: many ? 'What should change? Name them by letter: \u201cB\u2019s layout with A\u2019s colors.\u201d' : 'What should change? A bigger face, a warmer background\u2026' }) as HTMLTextAreaElement;
    const go = h('button.rr-approve', { type: 'button' }, `Send to ${host.workerName}`);
    const cancel = h('button.rr-ghost', { type: 'button' }, 'Cancel');
    cancel.addEventListener('click', closeSheet);
    const sendIt = async () => {
      const asked = text.value.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, ' ').trim();
      if (!asked) return text.focus();
      go.disabled = true;
      try {
        await review({ kind: 'variations', files: list.map(ref), text: many ? `On my board they are ${LETTERS.slice(0, list.length).join(', ')}, in the order listed above.\n\n${asked}` : asked });
        waiting = new Set(files.map(artifactKey));
        closeSheet();
      } catch {
        go.disabled = false;
      }
    };
    go.addEventListener('click', () => void sendIt());
    text.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void sendIt();
    });
    sheet.replaceChildren(h('label', {}, many ? `Variations of ${LETTERS.slice(0, list.length).join(', ')}` : `Variations of ${nameOf(list[0])}`), text, h('div.rr-sheet-row', {}, go, cancel, h('span.rr-hint', {}, '\u2318\u21a9 sends')));
    sheet.classList.remove('hidden');
    text.focus();
  });

  // ---- Keys ----
  function onKey(e: KeyboardEvent): boolean {
    const k = e.key;
    if (k === 'ArrowRight' || k === 'ArrowLeft') {
      const at = files.findIndex((f) => same(f, current));
      const next = files[(at + (k === 'ArrowRight' ? 1 : -1) + files.length) % files.length];
      if (next) select(next);
      return true;
    }
    if (k === 'c' || k === 'C') return setCommenting(!commenting), true;
    if (k === 'y' || k === 'Y') return setView(view === 'youtube' ? 'one' : 'youtube'), true;
    if (k === '1') return setView('one'), true;
    if (k === '2') return setView('compare'), true;
    return false;
  }

  const refreshMarks = () => loadMarks(host.workerId).then((m) => {
    notes.setMarks(m);
    drawPins();
    paintTop();
  }, () => undefined);

  const room: RoomHandle = {
    update(next, snapshot) {
      data = snapshot;
      files = sections(next.filter((f) => f.type.startsWith('image/')), snapshot, host.workerName).flatMap((s) => s.files);
      const keys = byKey();
      side = side.filter((k) => keys.has(k));
      // The variations asked for have come (the worker linked new images): side by side, newest last.
      const arrived = waiting ? files.filter((f) => !waiting!.has(artifactKey(f)) && originOf(f, snapshot) === 'linked') : [];
      if (arrived.length) {
        waiting = undefined;
        side = arrived.sort((a, b) => a.modified - b.modified).slice(-MOST).map(artifactKey);
        view = side.length > 1 ? 'compare' : 'one';
        current = keys.get(side[side.length - 1]);
      }
      const fresh = current && keys.get(artifactKey(current));
      if (!fresh) {
        const first = latestLinked(files, snapshot) ?? files[0];
        if (first) return select(first);
        current = undefined;
      } else current = fresh;
      if (current) notes.setSent(sentNotes(snapshot.messages, current).slice(0, 5), nameOf);
      paintAll();
    },
    show(file) {
      const f = byKey().get(artifactKey(file)) ?? file;
      if (view === 'youtube') view = 'one';
      select(f);
    },
    close: () => shell.close(),
  };
  room.update(o.files, o.data);
  if (o.file) room.show(o.file);
  setCommenting(false);
  void refreshMarks();
  poll = window.setInterval(() => document.visibilityState === 'visible' && void refreshMarks(), POLL_MS);
  return room;
}
