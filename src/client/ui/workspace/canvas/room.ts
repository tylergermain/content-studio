import './room.css';
import { h } from '../../dom';
import { artifactKey, type ChatArtifact, type ChatSnapshot, type ReviewRequest } from '../../../../shared/worker-chat';
import { versionLabel } from '../../../../shared/workspace';
import { designCanvas } from '../canvas';
import { fileTime, fileTitle, reviewsOf } from '../files';
import { marks as loadMarks } from '../marks';
import { draftKey, sentNotes } from '../notes';
import { notesSide, type NotePin } from '../notes-side';
import type { RoomHandle } from '../room-attach';
import { approveControls, openRoomShell } from '../room-shell';
import type { WorkspaceHost } from '../types';

// The design canvas full screen, as Frame.io reviews a design: the canvas itself (../canvas.ts: drag to move about,
// pinch or \u2318-scroll to zoom, live as the designer saves, Export and Import from Paper on its bar) on the dark
// stage, and the comments down the right (notes-side.ts). A click on any element pins the next comment to it, and the
// comments not sent yet show as numbered pins on the design. Approve tells the designer it's final.

type FileRef = { root?: string; path: string };
const POLL_MS = 15_000;
const ref = (f: FileRef): FileRef => (f.root ? { root: f.root, path: f.path } : { path: f.path });
const nameOf = (f: FileRef & { name?: string }) => versionLabel(f.path) ?? (f.name ?? f.path.split('/').pop() ?? f.path).replace(/\.design\.html$/i, '');

export function openCanvasRoom(host: WorkspaceHost, o: { files: ChatArtifact[]; data: ChatSnapshot; file?: ChatArtifact; onClose(): void }): RoomHandle {
  let data = o.data;
  let current: ChatArtifact | undefined;
  let picked: NotePin | undefined;
  let poll = 0;

  const shell = openRoomShell({
    className: 'canvas-room',
    label: `${host.workerName}\u2019s designs`,
    doing: `looking at ${host.workerName}\u2019s designs`,
    key: (e) => !!canvas.key?.(e),
    escape: () => {
      if (notes.writing()) return (document.activeElement as HTMLElement).blur(), true;
      if (picked) return unpick(), true;
      return false;
    },
    onClose: () => {
      window.clearInterval(poll);
      canvas.stop();
      o.onClose();
    },
  });
  const badge = h('span.rr-badge');
  const line = h('span.rr-title-line', {}, badge);
  shell.name.before(line);
  line.append(shell.name);
  shell.sub.textContent = host.workerName;
  const meta = h('span.rr-meta');
  shell.middle.classList.add('rr-mid');
  shell.middle.append(meta);
  const approval = approveControls({ workerName: host.workerName, approve: async () => current && review({ kind: 'approve', files: [ref(current)] }) });
  const openOut = h('a.rr-btn', { target: '_blank', rel: 'noopener', title: 'Open the design in a tab of its own', 'aria-label': 'Open in a new tab' }, '\u2197');
  shell.right.append(approval.pill, approval.button, openOut);

  const notes = notesSide({
    workerName: host.workerName,
    whole: 'the whole design',
    hint: 'Click anything on the design to pin a comment to it. Or write one below about the whole design.',
    canSend: () => host.canSend(),
    pick: () => picked,
    unpick: () => unpick(),
    changed: () => {
      canvas.repaint();
      paintTop();
    },
    focus: () => undefined,
    reveal: () => undefined,
    send: async (list) => {
      if (current) await review({ kind: 'notes', files: [ref(current)], notes: list });
    },
    mark: async (key, done) => {
      notes.setMarks(await loadMarks(host.workerId, { key, done }));
      paintTop();
    },
  });

  const canvas = designCanvas(host, {
    backdrop: '#1a1a1f',
    notes: {
      pick: (p) => {
        picked = p;
        if (p) notes.picked();
        else notes.paint();
      },
      pins: () => notes.pins().map((s) => ({ n: s.n, state: s.state, text: s.note.text, pin: s.note.pin })),
      opened: (f) => setDesign(f),
    },
  });
  shell.stage.classList.add('cv-stage');
  shell.stage.append(canvas.element);
  shell.side(notes.element);

  async function review(r: Omit<ReviewRequest, 'requestId'>) {
    await host.review(r);
  }
  function unpick() {
    picked = undefined;
    canvas.unpick();
    notes.paint();
  }

  function setDesign(f: ChatArtifact | undefined) {
    const changed = (current && artifactKey(current)) !== (f && artifactKey(f));
    current = f;
    if (f && changed) {
      picked = undefined;
      notes.setFile({ draftKey: draftKey(host.workerId, f), label: nameOf(f), file: f });
    }
    if (f) notes.setSent(sentNotes(data.messages, f).slice(0, 5), nameOf);
    paintTop();
  }

  function paintTop() {
    if (!current) {
      shell.name.textContent = 'No designs yet';
      return;
    }
    badge.textContent = versionLabel(current.path) ?? '';
    shell.name.textContent = nameOf(current);
    shell.name.title = fileTitle(current);
    meta.textContent = [current.path.slice(0, current.path.lastIndexOf('/') + 1), current.modified ? `saved ${fileTime(current.modified)}` : ''].filter(Boolean).join(' \u00b7 ');
    openOut.setAttribute('href', host.url(current));
    const approved = reviewsOf(current, data).some((r) => r.kind === 'approve');
    approval.set({ status: approved ? 'approved' : notes.open() ? 'changes' : 'new', label: nameOf(current), can: host.canSend() });
  }

  const refreshMarks = () => loadMarks(host.workerId).then((m) => {
    notes.setMarks(m);
    canvas.repaint();
    paintTop();
  }, () => undefined);

  const room: RoomHandle = {
    update(next, snapshot) {
      data = snapshot;
      canvas.paint(next, snapshot);
      if (current) notes.setSent(sentNotes(snapshot.messages, current).slice(0, 5), nameOf);
      paintTop();
    },
    show: (file) => canvas.show(file),
    close: () => shell.close(),
  };
  room.update(o.files, o.data);
  if (o.file) canvas.show(o.file);
  void refreshMarks();
  poll = window.setInterval(() => document.visibilityState === 'visible' && void refreshMarks(), POLL_MS);
  return room;
}
