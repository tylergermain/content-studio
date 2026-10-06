import '../room.css';
import './room.css';
import { h, openModal } from '../../dom';
import { store } from '../../../state';
import { STATUS_LABEL, type ReviewStatus } from '../../../../shared/software-review';
import { artifactKey, type ChatArtifact, type ChatSnapshot, type ReviewNote, type ReviewRequest } from '../../../../shared/worker-chat';
import { parseChapters, versionLabel } from '../../../../shared/workspace';
import { fileFolder, fileSize, fileTime, fileTitle, latestLinked, reviewsOf, sections } from '../files';
import { draftKey, sentNotes, seriesKey } from '../notes';
import type { WorkspaceHost } from '../types';
import { screeningComments, type Chapter, type Marks } from './comments';
import { screeningPlayer } from './player';

// The screening room full screen, the way Frame.io reviews a cut: the cut on a dark stage with a timeline of the
// notes and chapters under it (player.ts), the notes down the right (comments.ts), and along the top which version
// this is (any of the worker's cuts), where its review stands and Approve. Notes you haven't sent are kept in this
// browser (../notes.ts); what was sent comes back from the reviews on the chat's messages, so watching v02 lists
// what was asked of v01 and where; which are done is kept on the floor (/api/review/marks).

type FileRef = { root?: string; path: string };
const same = (a: FileRef | undefined, b: FileRef | undefined) => !!a && !!b && artifactKey(a) === artifactKey(b);
const ref = (f: FileRef): FileRef => (f.root ? { root: f.root, path: f.path } : { path: f.path });
const dirOf = (p: string) => p.slice(0, p.lastIndexOf('/') + 1);
const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
/** A chapters.txt longer than this isn't one. */
const CHAPTERS_MAX = 256 * 1024;
const POLL_MS = 15_000;
/** What a cut that won't play here asks the worker for. Plain words and no em dash: it goes into the worker's chat. */
const H264 = "This file won't play in the office's browser player. Please export an H.264 review copy of it (8-bit 4:2:0 video with AAC audio, as an .mp4 with the moov atom at the front), save it as a new file next to the original, leave the original as it is, and link the new file in your reply.";

/** Where each cut was left, by worker and file, so going back to one picks up there. */
const left = new Map<string, number>();
let open: { close(): void } | undefined;

export interface ScreeningRoom {
  /** The window heard from the office: the cuts and what was sent about them. */
  update(files: ChatArtifact[], data: ChatSnapshot): void;
  show(file: ChatArtifact): void;
  close(): void;
}

async function marksCall(workerId: string, body?: { key: string; done: boolean; by: string }): Promise<Marks> {
  const params = new URLSearchParams({ floor: store.floor ?? '', worker: workerId });
  const res = await fetch(`/api/review/marks?${params}`, body ? { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { credentials: 'same-origin' });
  const out = await res.json().catch(() => undefined);
  if (!res.ok || !out?.marks) throw new Error(out?.error ?? 'That didn’t save');
  return out.marks;
}

export function openScreeningRoom(host: WorkspaceHost, o: { files: ChatArtifact[]; data: ChatSnapshot; file?: ChatArtifact; onClose(): void }): ScreeningRoom {
  open?.close();
  let files: ChatArtifact[] = [];
  let data = o.data;
  let selected: ChatArtifact | undefined;
  let marks: Marks = {};
  let chapters: Chapter[] = [], chaptersFrom = '';
  let resume = false, confirming = false, confirmTimer = 0;
  let abort = new AbortController();
  const texts = new Map<string, Promise<string | undefined>>();

  const nameOf = (f: FileRef & { name?: string }) => versionLabel(f.path) ?? f.name ?? f.path.split('/').pop() ?? f.path;
  const leftKey = (f: FileRef) => `${host.workerId}:${artifactKey(f)}`;
  const newest = () => latestLinked(files.filter((f) => f.type.startsWith('video/')), data) ?? latestLinked(files, data);

  // ---- The frame ----
  const close = h('button.rr-close', { type: 'button', 'aria-label': 'Close', title: 'Close (Esc)' }, '✕');
  const badge = h('span.sr-badge');
  const name = h('strong');
  const pick = h('select.rr-pick', { 'aria-label': 'Cut' }) as HTMLSelectElement;
  const newer = h('button.sr-newer.hidden', { type: 'button' });
  const meta = h('span.sr-meta');
  const pill = h('span.rr-state');
  const approveBtn = h('button.rr-approve', { type: 'button' });
  const openOut = h('a.rr-btn', { target: '_blank', rel: 'noopener', title: 'Open the file in a tab of its own', 'aria-label': 'Open in a new tab' }, '↗');
  const theater = h('button.sr-ctl', { type: 'button', title: 'Hide the notes (F)', 'aria-label': 'Hide the notes' }, '⇥');

  const player = screeningPlayer({
    onMark: (m) => {
      if (m.key) {
        comments.showKey(m.key);
        player.seek(m.at);
      } else player.seek(m.at, true);
    },
    onTick: (t) => comments.tick(t),
    onPlaying: () => undefined,
    onError: () => selected && void explain(selected),
    onReady: () => undefined,
    extra: [theater],
  });
  const comments = screeningComments({
    workerName: host.workerName,
    canSend: () => host.canSend(),
    time: () => player.time(),
    seek: (at, play) => player.seek(at, play),
    hold: () => {
      resume = player.playing();
      player.pause();
    },
    letGo: (again) => {
      if (again && resume) player.play();
      resume = false;
    },
    changed: () => {
      player.setMarks(comments.timeline());
      paintTop();
    },
    async send(notes: ReviewNote[]) {
      if (!selected) return;
      await review({ kind: 'notes', files: [ref(selected)], notes });
    },
    async mark(key, done) {
      marks = await marksCall(host.workerId, { key, done, by: store.me.account?.name ?? store.profile.name ?? 'You' });
      comments.setMarks(marks);
      player.setMarks(comments.timeline());
      paintTop();
    },
  });

  const root = h('div.review-room.screening-room', { role: 'dialog', 'aria-label': `Screening ${host.workerName}’s cuts`, tabindex: '-1' },
    h('header.rr-top', {},
      h('div.rr-left', {}, close, h('div.rr-title', {}, h('span.sr-title-line', {}, badge, name), h('span', {}, host.workerName)), pick, newer),
      h('div.rr-nav.sr-nav', {}, meta),
      h('div.rr-right', {}, pill, approveBtn, openOut)),
    h('div.rr-body', {}, h('div.rr-stage.sr-stage', {}, player.element), comments.element));

  async function review(r: Omit<ReviewRequest, 'requestId'>) {
    await host.review(r);
  }

  // ---- Cuts ----
  function select(file: ChatArtifact) {
    if (same(selected, file)) {
      selected = file;
      return;
    }
    remember();
    selected = file;
    confirming = false;
    comments.setCut({ draftKey: draftKey(host.workerId, file), label: nameOf(file), file });
    player.setProblem(undefined);
    player.load(host.url(file), { audio: file.type.startsWith('audio/'), resume: left.get(leftKey(file)) });
    findChapters();
    paintAll();
  }
  function remember() {
    if (selected && player.time() > 1 && player.time() < player.duration() - 1) left.set(leftKey(selected), player.time());
  }
  pick.addEventListener('change', () => {
    const f = files.find((x) => artifactKey(x) === pick.value);
    if (f) select(f);
    root.focus({ preventScroll: true });
  });

  /** Why a cut won't play, asked of the server with one byte: gone, not yours to open, or a format this browser can't play. */
  async function explain(file: ChatArtifact) {
    let code = 0;
    try {
      const response = await fetch(host.url(file), { headers: { Range: 'bytes=0-0' }, credentials: 'same-origin', cache: 'no-store', signal: abort.signal });
      code = response.status;
      void response.body?.cancel().catch(() => {});
    } catch {
      if (abort.signal.aborted) return;
    }
    if (!same(selected, file)) return;
    const playable = code === 200 || code === 206;
    const asked = reviewsOf(file, data).some((r) => r.kind === 'question');
    const why = code === 404 ? 'It isn’t there any more: it was moved or deleted, or its folder is no longer shared with this floor.'
      : code === 403 ? 'You can’t open files in this shared folder. An admin, or the person who hired this worker, can.'
        : playable ? 'This browser can’t play its format. Chrome plays H.264 (8-bit) video with AAC sound; ProRes never plays here, and HEVC or 10-bit files often don’t.'
          : 'It couldn’t be loaded. Check the office is still running, then try again.';
    const parts: Node[] = [h('strong', {}, playable ? `${file.name} won’t play here` : `${file.name} can’t be opened`), h('p', {}, why), h('code', {}, fileTitle(file))];
    if (playable && host.canSend()) {
      const ask = h('button.rr-approve', { type: 'button', disabled: asked }, asked ? 'H.264 review copy asked for' : 'Ask for an H.264 review copy');
      ask.addEventListener('click', async () => {
        ask.disabled = true;
        try {
          await review({ kind: 'question', files: [ref(file)], text: H264 });
          ask.textContent = 'H.264 review copy asked for';
        } catch {
          ask.disabled = false;
        }
      });
      parts.push(ask);
    } else if (!playable && code !== 404 && code !== 403) {
      const retry = h('button.rr-add', { type: 'button' }, 'Try again');
      retry.addEventListener('click', () => player.load(host.url(file), { audio: file.type.startsWith('audio/') }));
      parts.push(retry);
    }
    player.setProblem(parts);
  }

  // ---- Chapters: a chapters.txt in the cut's folder, or the one above it (jev-v01/chapters.txt for jev-v01/renders/…mp4) ----
  function chaptersFile(f: ChatArtifact): ChatArtifact | undefined {
    const dir = dirOf(f.path), up = dir ? dirOf(dir.slice(0, -1)) : undefined;
    const wanted = [`${dir}chapters.txt`, ...(up !== undefined ? [`${up}chapters.txt`] : [])].map((p) => p.toLowerCase());
    const all = [...(data.linked ?? []), ...(data.nearby ?? []), ...data.artifacts];
    for (const p of wanted) {
      const hit = all.find((x) => (x.root ?? '') === (f.root ?? '') && x.path.toLowerCase() === p && x.size <= CHAPTERS_MAX);
      if (hit) return hit;
    }
    return undefined;
  }
  function findChapters() {
    const source = selected ? chaptersFile(selected) : undefined;
    const key = source ? `${artifactKey(source)}@${source.modified}` : '';
    if (key === chaptersFrom) return;
    chaptersFrom = key;
    chapters = [];
    comments.setChapters([]);
    if (!source) return;
    let text = texts.get(key);
    if (!text) {
      text = fetch(host.url(source), { credentials: 'same-origin', cache: 'no-store', signal: abort.signal }).then((r) => (r.ok ? r.text() : undefined)).catch(() => undefined);
      texts.set(key, text);
    }
    void text.then((t) => {
      if (chaptersFrom !== key) return;
      chapters = t ? parseChapters(t) : [];
      comments.setChapters(chapters);
      player.setMarks(comments.timeline());
    });
  }

  // ---- Where the review stands ----
  function status(): ReviewStatus {
    if (!selected) return 'new';
    if (reviewsOf(selected, data).some((r) => r.kind === 'approve')) return 'approved';
    return comments.openOnThisCut() ? 'changes' : 'new';
  }
  function paintTop() {
    if (!selected) return;
    const f = selected, v = versionLabel(f.path), latest = newest();
    badge.textContent = v ?? (f.type.startsWith('audio/') ? '♪' : '▶');
    name.textContent = f.name;
    name.title = fileTitle(f);
    meta.textContent = [same(latest, f) ? 'Latest' : '', fileFolder(f), fileSize(f.size), fileTime(f.modified)].filter(Boolean).join(' · ');
    openOut.setAttribute('href', host.url(f));
    const st = status();
    pill.textContent = STATUS_LABEL[st];
    pill.dataset.state = st;
    const label = nameOf(f);
    approveBtn.textContent = st === 'approved' ? '✓ Approved' : confirming ? `Approve ${label}? Click again` : 'Approve';
    approveBtn.classList.toggle('on', st === 'approved');
    approveBtn.disabled = st === 'approved' || !host.canSend();
    approveBtn.title = st === 'approved' ? `${label} is approved: ${host.workerName} was told it’s final.` : `Tell ${host.workerName} ${label} is final. Nothing is published, moved or renamed.`;
    // A newer cut: the newest in this one's series of versions, else the latest the worker linked.
    const next = files.filter((x) => !same(x, f) && x.modified > f.modified && seriesKey(x) === seriesKey(f)).sort((a, b) => b.modified - a.modified)[0]
      ?? (latest && !same(latest, f) && latest.modified > f.modified ? latest : undefined);
    newer.classList.toggle('hidden', !next);
    if (next) {
      newer.textContent = `${nameOf(next)} is newer · Watch it`;
      newer.onclick = () => select(next);
    }
  }
  approveBtn.addEventListener('click', async () => {
    if (!selected || status() === 'approved') return;
    if (!confirming) {
      confirming = true;
      paintTop();
      window.clearTimeout(confirmTimer);
      confirmTimer = window.setTimeout(() => {
        confirming = false;
        paintTop();
      }, 4000);
      return;
    }
    confirming = false;
    approveBtn.disabled = true;
    try {
      await review({ kind: 'approve', files: [ref(selected)] });
    } catch {
      paintTop();
    }
  });

  function paintPick() {
    const groups = sections(files, data, host.workerName);
    const latest = newest();
    pick.replaceChildren(...groups.map((g) => h('optgroup', { label: g.title }, ...g.files.map((f) => h('option', { value: artifactKey(f) }, `${nameOf(f)}${versionLabel(f.path) ? ` · ${f.name}` : ''}${same(f, latest) ? ' · Latest' : ''}`)))));
    pick.hidden = files.length < 2;
    if (selected) pick.value = artifactKey(selected);
  }

  function paintAll() {
    paintPick();
    paintTop();
    comments.setSent(selected ? sentNotes(data.messages, selected).slice(0, 5) : [], nameOf);
    player.setMarks(comments.timeline());
  }

  // ---- Keys ----
  function onKey(e: KeyboardEvent) {
    if (document.getElementById('modal-root')?.lastElementChild !== modal.backdrop) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (comments.writing()) return comments.cancel();
      if (typing(e.target)) return (e.target as HTMLElement).blur();
      return modal.close();
    }
    if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === ' ' || k === 'k') {
      e.preventDefault();
      if (!e.repeat) player.toggle();
    } else if (k === 'j' || k === 'l') player.nudge(k === 'j' ? -5 : 5);
    else if (k === 'arrowleft' || k === 'arrowright') {
      e.preventDefault();
      if (e.shiftKey) player.nudge(k === 'arrowleft' ? -1 : 1);
      else player.step(k === 'arrowleft' ? -1 : 1);
    } else if ((k === 'n' || k === 'c') && host.canSend()) {
      // Before the box takes focus, so the N isn't typed into it.
      e.preventDefault();
      if (!e.repeat) comments.write();
    } else if (k === 'm') player.mute();
    else if (k === 'f') toggleTheater();
  }
  function toggleTheater() {
    const on = root.classList.toggle('theater');
    theater.setAttribute('aria-pressed', String(on));
    theater.title = on ? 'Show the notes (F)' : 'Hide the notes (F)';
  }
  theater.addEventListener('click', toggleTheater);

  // ---- Open and close ----
  const loadMarks = () => marksCall(host.workerId).then((m) => {
    marks = m;
    comments.setMarks(m);
    player.setMarks(comments.timeline());
    paintTop();
  }, () => undefined);
  let poll = 0;
  window.addEventListener('keydown', onKey, true);
  const modal = openModal(root, {
    escCloses: false,
    closeButton: false,
    doing: `screening ${host.workerName}’s cuts`,
    onClose: () => {
      remember();
      window.clearInterval(poll);
      window.clearTimeout(confirmTimer);
      window.removeEventListener('keydown', onKey, true);
      player.release();
      abort.abort();
      abort = new AbortController();
      open = undefined;
      o.onClose();
    },
  });
  close.addEventListener('click', () => modal.close());
  open = { close: () => modal.close() };

  const room: ScreeningRoom = {
    update(next, snapshot) {
      data = snapshot;
      files = next.filter((f) => /^(video|audio)\//.test(f.type));
      const fresh = selected && files.find((f) => same(f, selected));
      if (selected && fresh && fresh.modified !== selected.modified && !player.playing()) {
        // Written again in place: load it again where it was.
        remember();
        selected = fresh;
        player.load(host.url(fresh), { audio: fresh.type.startsWith('audio/'), resume: left.get(leftKey(fresh)) });
      } else if (fresh) selected = fresh;
      if (!selected || !fresh) {
        const first = newest() ?? files[0];
        if (first) select(first);
      }
      findChapters();
      paintAll();
    },
    show(file) {
      select(file);
    },
    close: () => modal.close(),
  };
  room.update(o.files, o.data);
  if (o.file && !same(o.file, selected)) select(o.file);
  void loadMarks();
  poll = window.setInterval(() => document.visibilityState === 'visible' && void loadMarks(), POLL_MS);
  requestAnimationFrame(() => root.focus({ preventScroll: true }));
  return room;
}
