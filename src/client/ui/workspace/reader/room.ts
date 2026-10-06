import './room.css';
import { h } from '../../dom';
import { artifactKey, type ChatArtifact, type ChatSnapshot, type ReviewRequest } from '../../../../shared/worker-chat';
import { versionLabel } from '../../../../shared/workspace';
import { fileSize, fileTime, fileTitle, reviewsOf, sections } from '../files';
import { marks as loadMarks } from '../marks';
import { draftKey, sentNotes, type DraftNote } from '../notes';
import { notesSide } from '../notes-side';
import { reportReader } from '../reader';
import type { RoomHandle } from '../room-attach';
import { approveControls, openRoomShell } from '../room-shell';
import type { WorkspaceHost } from '../types';

// Reports full screen, as Frame.io reviews a document: the page as a sheet on a dark stage, its contents and sources
// beside it (the reader itself, ../reader.ts), and the comments down the right (notes-side.ts). Select any passage and
// Comment pins the next comment to it, the passages commented on are marked on the page; the box also asks questions.
// Approve tells the worker it's final.

type FileRef = { root?: string; path: string };
const POLL_MS = 15_000;
const ref = (f: FileRef): FileRef => (f.root ? { root: f.root, path: f.path } : { path: f.path });
const QUOTE = /^the passage \u201c([\s\S]+)\u201d$/;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The marks the page wears, by the CSS Custom Highlight API where the browser has it. */
type Registry = { set(name: string, h: unknown): void; delete(name: string): void };
const registry = (): Registry | undefined => (globalThis.CSS as unknown as { highlights?: Registry } | undefined)?.highlights;
const Highlight = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;

/** Where a passage is in the page: its words in order, whatever the spaces and the breaks between blocks. */
function findText(root: HTMLElement, quote: string): Range | undefined {
  const words = quote.split(/\s+/).filter(Boolean).map(escapeRe);
  if (!words.length) return undefined;
  const nodes: Text[] = [], starts: number[] = [];
  let all = '';
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    starts.push(all.length);
    nodes.push(n as Text);
    all += (n as Text).data;
  }
  const m = new RegExp(words.join('\\s*'), 'i').exec(all);
  if (!m) return undefined;
  const at = (i: number) => {
    let k = starts.length - 1;
    while (k > 0 && starts[k] > i) k--;
    return { node: nodes[k], off: Math.min(i - starts[k], nodes[k].data.length) };
  };
  const a = at(m.index), b = at(m.index + m[0].length);
  const r = document.createRange();
  r.setStart(a.node, a.off);
  r.setEnd(b.node, b.off);
  return r;
}
const quoteOf = (n: DraftNote) => (typeof n.pin?.q === 'string' ? n.pin.q : QUOTE.exec(n.where ?? '')?.[1]);

export function openReaderRoom(host: WorkspaceHost, o: { files: ChatArtifact[]; data: ChatSnapshot; file?: ChatArtifact; onClose(): void }): RoomHandle {
  let files: ChatArtifact[] = [];
  let data = o.data;
  let current: ChatArtifact | undefined;
  let quote: string | undefined;
  let focused = '';
  let poll = 0;
  let selected = '';

  const nameOf = (f: FileRef & { name?: string }) => versionLabel(f.path) ?? f.name ?? f.path.split('/').pop() ?? f.path;
  const shell = openRoomShell({
    className: 'reports-room',
    label: `${host.workerName}\u2019s reports`,
    doing: `reading ${host.workerName}\u2019s reports`,
    key: (e) => !!reader.key?.(e),
    escape: () => {
      if (notes.writing()) return (document.activeElement as HTMLElement).blur(), true;
      if (quote) return (quote = undefined), highlight(), notes.paint(), true;
      return false;
    },
    onClose: () => {
      window.clearInterval(poll);
      document.removeEventListener('selectionchange', onSelection);
      observer.disconnect();
      reader.stop();
      for (const n of ['rr-notes', 'rr-focus', 'rr-pick']) registry()?.delete(n);
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
  const pick = h('select.rr-pick', { 'aria-label': 'Document' }) as HTMLSelectElement;
  const approval = approveControls({ workerName: host.workerName, approve: async () => current && review({ kind: 'approve', files: [ref(current)] }) });
  const openOut = h('a.rr-btn', { target: '_blank', rel: 'noopener', title: 'Open it in a tab of its own', 'aria-label': 'Open in a new tab' }, '\u2197');
  shell.left.append(pick);
  shell.right.append(approval.pill, approval.button, openOut);

  const reader = reportReader(host, { onOpen: (f) => setDoc(f) });
  const quoteBtn = h('button.rd-quote.hidden', { type: 'button', title: 'Comment on this passage' }, '\u{1f4ac} Comment');
  shell.stage.classList.add('rd-stage');
  shell.stage.append(reader.element, quoteBtn);
  const page = () => reader.element.querySelector<HTMLElement>('.reader-page');

  const notes = notesSide({
    workerName: host.workerName,
    whole: 'the whole document',
    hint: 'Select any passage on the page to comment on it. Or write one below about the whole document.',
    canSend: () => host.canSend(),
    pick: () => (quote ? { where: `the passage \u201c${quote}\u201d`, label: `\u201c${quote.length > 48 ? `${quote.slice(0, 47)}\u2026` : quote}\u201d`, pin: { q: quote } } : undefined),
    unpick: () => {
      quote = undefined;
      highlight();
    },
    changed: () => {
      highlight();
      paintTop();
    },
    focus: (s) => {
      focused = s?.key ?? '';
      highlight();
    },
    reveal: (s) => {
      focused = s.key;
      const q = quoteOf(s.note), p = page();
      const r = q && p ? findText(p, q) : undefined;
      (r?.startContainer.parentElement)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      highlight();
    },
    send: async (list) => {
      if (current) await review({ kind: 'notes', files: [ref(current)], notes: list });
    },
    mark: async (key, done) => {
      notes.setMarks(await loadMarks(host.workerId, { key, done }));
      highlight();
      paintTop();
    },
    question: async (text) => {
      if (current) await review({ kind: 'question', files: [ref(current)], text });
    },
  });
  shell.side(notes.element);

  async function review(r: Omit<ReviewRequest, 'requestId'>) {
    await host.review(r);
  }

  // ---- The document ----
  function setDoc(f: ChatArtifact) {
    const changed = !current || artifactKey(current) !== artifactKey(f);
    current = f;
    if (changed) {
      quote = undefined;
      notes.setFile({ draftKey: draftKey(host.workerId, f), label: nameOf(f), file: f });
    }
    notes.setSent(sentNotes(data.messages, f).slice(0, 5), nameOf);
    paintTop();
  }
  pick.addEventListener('change', () => {
    const f = files.find((x) => artifactKey(x) === pick.value);
    if (f) reader.show(f);
  });

  function paintTop() {
    pick.replaceChildren(...sections(files, data, host.workerName).map((s) => h('optgroup', { label: s.title }, ...s.files.map((f) => h('option', { value: artifactKey(f) }, f.name)))));
    pick.hidden = files.length < 2;
    if (!current) return;
    pick.value = artifactKey(current);
    badge.textContent = versionLabel(current.path) ?? '';
    shell.name.textContent = current.name;
    shell.name.title = fileTitle(current);
    meta.textContent = [current.path.slice(0, current.path.lastIndexOf('/') + 1), current.size ? fileSize(current.size) : '', current.modified ? fileTime(current.modified) : ''].filter(Boolean).join(' \u00b7 ');
    openOut.setAttribute('href', host.url(current));
    const approved = reviewsOf(current, data).some((r) => r.kind === 'approve');
    approval.set({ status: approved ? 'approved' : notes.open() ? 'changes' : 'new', label: nameOf(current), can: host.canSend() });
  }

  // ---- Passages: select one to comment on it; the ones commented on are marked ----
  function onSelection() {
    const sel = getSelection();
    const p = page();
    if (!sel || sel.isCollapsed || !sel.rangeCount || !p || !p.contains(sel.getRangeAt(0).commonAncestorContainer) || !host.canSend()) {
      quoteBtn.classList.add('hidden');
      return;
    }
    selected = sel.toString().replace(/\s+/g, ' ').trim().slice(0, 300);
    if (selected.length < 2) return quoteBtn.classList.add('hidden');
    const r = sel.getRangeAt(0).getBoundingClientRect(), s = shell.stage.getBoundingClientRect();
    quoteBtn.style.left = `${Math.max(8, Math.min(r.left - s.left + r.width / 2 - 50, s.width - 120))}px`;
    quoteBtn.style.top = `${Math.max(8, r.top - s.top - 42)}px`;
    quoteBtn.classList.remove('hidden');
  }
  document.addEventListener('selectionchange', onSelection);
  quoteBtn.addEventListener('mousedown', (e) => e.preventDefault());
  quoteBtn.addEventListener('click', () => {
    quote = selected;
    getSelection()?.removeAllRanges();
    quoteBtn.classList.add('hidden');
    highlight();
    notes.picked();
  });

  function highlight() {
    const reg = registry(), p = page();
    if (!reg || !Highlight || !p) return;
    const marked: Range[] = [], focus: Range[] = [], picked: Range[] = [];
    for (const s of notes.pins()) {
      const q = quoteOf(s.note);
      const r = q ? findText(p, q) : undefined;
      if (r) (s.key === focused ? focus : marked).push(r);
    }
    const r = quote ? findText(p, quote) : undefined;
    if (r) picked.push(r);
    reg.set('rr-notes', new Highlight(...marked));
    reg.set('rr-focus', new Highlight(...focus));
    reg.set('rr-pick', new Highlight(...picked));
  }
  // The page is drawn again on each save: the marks go back on it.
  let pending = 0;
  const observer = new MutationObserver(() => {
    window.clearTimeout(pending);
    pending = window.setTimeout(highlight, 120);
  });
  const watch = page();
  if (watch) observer.observe(watch, { childList: true, subtree: true });

  const refreshMarks = () => loadMarks(host.workerId).then((m) => {
    notes.setMarks(m);
    highlight();
    paintTop();
  }, () => undefined);

  const room: RoomHandle = {
    update(next, snapshot) {
      data = snapshot;
      files = sections(next, snapshot, host.workerName).flatMap((s) => s.files);
      reader.paint(next, snapshot);
      if (current) notes.setSent(sentNotes(snapshot.messages, current).slice(0, 5), nameOf);
      paintTop();
    },
    show(file) {
      reader.show(file);
    },
    close: () => shell.close(),
  };
  room.update(o.files, o.data);
  // The reader opens what the worker linked by itself; with only the floor's documents, the first of them.
  const first = o.file ?? (current ? undefined : files[0]);
  if (first) reader.show(first);
  void refreshMarks();
  poll = window.setInterval(() => document.visibilityState === 'visible' && void refreshMarks(), POLL_MS);
  return room;
}
