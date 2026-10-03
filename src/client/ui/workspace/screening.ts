import './screening.css';
import { h } from '../dom';
import { artifactKey, type ChatArtifact, type ChatSnapshot, type ReviewNote, type ReviewRequest } from '../../../shared/worker-chat';
import { clock, parseChapters, versionLabel } from '../../../shared/workspace';
import { badges, fileFolder, fileItem, fileSize, fileTime, fileTitle, latestLinked, reviewsOf, sections } from './files';
import { MAX_NOTE, MAX_NOTES, addNote, draftKey, loadDraft, saveDraft, seekBefore, sentNotes, seriesKey, withoutNotes } from './notes';
import type { Panel, WorkspaceHost } from './types';

// The Watch tab, the Video Editor's screening room: a cut in a big 2D player that streams by Range (never a 3D
// texture), notes left at the moment they're about, sent back as one revision request, and every version the worker
// delivered, told apart by its v01. Under the player, a strip marks the notes and chapters along the cut. Notes you
// haven't sent are kept in this browser (notes.ts); what was sent comes back from the reviews on the chat's messages,
// so watching v02 lists what was asked of v01 and where. While a cut plays, the office behind the window dims.

type FileRef = { root?: string; path: string };
type Chapter = { at: number; title: string };

const same = (a: FileRef | undefined, b: FileRef | undefined) => !!a && !!b && artifactKey(a) === artifactKey(b);
const ref = (f: FileRef): FileRef => (f.root ? { root: f.root, path: f.path } : { path: f.path });
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
const dirOf = (p: string) => p.slice(0, p.lastIndexOf('/') + 1);
const keycap = (k: string) => h('span.key', {}, k);
/** A chapters.txt longer than this isn't one. */
const CHAPTERS_MAX = 256 * 1024;
/** What a cut that won't play here asks the worker for. Plain words and no em dash: it goes into the worker's chat. */
const H264 = "This file won't play in the office's browser player. Please export an H.264 review copy of it (8-bit 4:2:0 video with AAC audio, as an .mp4 with the moov atom at the front), save it as a new file next to the original, leave the original as it is, and link the new file in your reply.";

/** The screening room: one panel of the workspace (index.ts), for the Watch tab's video and audio. */
export function screeningRoom(host: WorkspaceHost): Panel {
  const video = h('video', { controls: true, preload: 'metadata', playsinline: true });
  const problem = h('div.screening-problem.hidden', { role: 'alert' });
  const stage = h('div.screening-stage', {}, video, problem);
  const marks = h('div.screening-marks');
  const playhead = h('div.screening-playhead');
  const track = h('div.screening-track.hidden', { title: 'Notes and chapters along the cut. Click to jump there.' }, marks, playhead);
  const version = h('span.screening-version');
  const title = h('strong.screening-name');
  const meta = h('span.screening-meta');
  const pills = h('span.ws-pills');
  const newer = h('button.btn.screening-newer.hidden', { type: 'button' });
  const add = h('button.btn.screening-add', { type: 'button', title: 'Pause here and write a note at this moment (N)' }, 'Add note at 0:00');
  const bar = h('div.screening-bar', {}, version, h('div.screening-named', {}, title, meta), pills, newer, add);
  const at = h('span.screening-at');
  const input = h('input', { type: 'text', maxlength: MAX_NOTE, placeholder: 'What should change here?', 'aria-label': 'Note', enterkeyhint: 'done' });
  const cancel = h('button.btn', { type: 'button' }, 'Cancel');
  const compose = h('form.screening-compose.hidden', {}, at, input, h('button.btn.primary', { type: 'submit' }, 'Add note'), cancel);
  const noteKeys = h('span', {}, keycap('N'), 'note');
  const keys = h('p.screening-keys', {}, h('span', {}, keycap('Space'), 'or ', keycap('K'), 'play or pause'), h('span', {}, keycap('J'), keycap('L'), 'back or ahead 5 s'), noteKeys, h('span', {}, keycap('F'), 'theater'));

  const notesHead = h('h4', {}, 'Your notes');
  const noteList = h('ol.screening-list');
  const send = h('button.btn.primary', { type: 'button' }, 'Send notes');
  const approve = h('button.btn', { type: 'button' }, 'Approve this cut');
  const actions = h('div.screening-actions', {}, send, approve);
  const confirmText = h('p');
  const yes = h('button.btn.primary', { type: 'button' }, 'Approve');
  const no = h('button.btn', { type: 'button' }, 'Cancel');
  const confirm = h('div.screening-confirm.hidden', {}, confirmText, h('div.screening-actions', {}, yes, no));
  const status = h('p.screening-status', { 'aria-live': 'polite' });
  const readOnly = h('p.screening-hint.hidden');
  const notesBox = h('section.screening-box', {}, notesHead, noteList, actions, confirm, status, readOnly);
  const sentBox = h('section.screening-box.hidden');
  const chapterList = h('ol.screening-list');
  const chaptersBox = h('section.screening-box.hidden', {}, h('h4', {}, 'Chapters'), chapterList);
  const versionList = h('div.screening-versions');
  const versionsBox = h('section.screening-box.hidden', {}, h('h4', {}, 'Versions'), versionList);
  const empty = h('div.screening-empty.hidden');
  const layout = h('div.screening-layout', {},
    h('div.screening-main', {}, stage, track, bar, compose, keys),
    h('div.screening-rail', {}, h('div.screening-review', {}, notesBox, sentBox), h('div.screening-side', {}, chaptersBox, versionsBox)));
  const element = h('div.ws-panel.screening', { tabindex: '-1', 'aria-label': 'Screening room' }, empty, layout);

  let data: ChatSnapshot | undefined;
  let files: ChatArtifact[] = [];
  let selected: ChatArtifact | undefined;
  /** The viewer chose this cut (or played it, or a link opened it), so a newer delivery doesn't take its place. */
  let chosen = false;
  let notes: ReviewNote[] = [];
  /** The note being written: its moment, and whether the cut was playing (it plays on once the note is added). */
  let writing: { at: number; resume: boolean } | undefined;
  let busy = false, confirming = false, shownClock = '', loads = 0;
  let chapters: Chapter[] = [], chaptersFrom = '';
  let abort = new AbortController();
  /** Where each cut was left, so going back to one picks up there. */
  const left = new Map<string, number>();
  const texts = new Map<string, Promise<string | undefined>>();

  const worker = () => host.workerName;
  const nameOf = (f: FileRef & { name?: string }) => versionLabel(f.path) ?? f.name ?? f.path.split('/').pop() ?? f.path;
  const draft = () => (selected ? draftKey(host.workerId, selected) : '');
  const duration = () => (Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0);
  const play = () => void video.play().catch(() => {});
  const jump = (t: number) => { video.currentTime = Math.max(0, t); play(); };
  const newest = () => (data ? latestLinked(files.filter((f) => f.type.startsWith('video/')), data) ?? latestLinked(files, data) : undefined);
  /** The notes sent on this cut and the versions before it, the newest five reviews. */
  const sentGroups = () => (data && selected ? sentNotes(data.messages, selected).slice(0, 5) : []);
  const setStatus = (text: string, error = false) => { status.textContent = text; status.classList.toggle('error', error); };
  /** The viewer picked a cut. The list it was picked from is painted again, so the room keeps the keys' focus. */
  const pick = (f: ChatArtifact) => { chosen = true; select(f); paintAll(); element.focus({ preventScroll: true }); };

  // ---- The player -----------------------------------------------------------------------------------------------

  function load(file: ChatArtifact) {
    const token = ++loads;
    problem.classList.add('hidden');
    stage.classList.toggle('audio', file.type.startsWith('audio/'));
    stage.style.removeProperty('--shape');
    video.src = host.url(file);
    const resume = left.get(artifactKey(file));
    video.addEventListener('loadedmetadata', () => {
      if (token !== loads) return;
      if (video.videoWidth && video.videoHeight) stage.style.setProperty('--shape', String(video.videoWidth / video.videoHeight));
      if (resume && resume < duration() - 1) video.currentTime = resume;
      paintTrack();
    }, { once: true });
  }

  /** Remember where the cut is, and let go of it: its sound stops and nothing more is fetched. */
  function release() {
    remember();
    video.pause();
    video.removeAttribute('src');
    video.load();
  }
  function remember() {
    if (selected && video.currentTime > 1 && !video.ended) left.set(artifactKey(selected), video.currentTime);
  }

  function select(file: ChatArtifact) {
    if (same(selected, file)) { selected = file; return; }
    finishNote();
    remember();
    selected = file;
    notes = loadDraft(draft());
    confirming = false;
    setStatus('');
    load(file);
    findChapters();
  }

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
    const asked = !!data && reviewsOf(file, data).some((r) => r.kind === 'question');
    const why = code === 404 ? 'It isn’t there any more: it was moved or deleted, or its folder is no longer shared with this floor.'
      : code === 403 ? 'You can’t open files in this shared folder. An admin, or the person who hired this worker, can.'
        : playable ? 'This browser can’t play its format. Chrome plays H.264 (8-bit) video with AAC sound; ProRes never plays here, and HEVC or 10-bit files often don’t.'
          : 'It couldn’t be loaded. Check the office is still running, then try again.';
    const parts: Node[] = [h('strong', {}, playable ? `${file.name} won’t play here` : `${file.name} can’t be opened`), h('p', {}, why), h('code.screening-path', {}, fileTitle(file))];
    if (playable && host.canSend()) {
      const ask = h('button.btn.primary', { type: 'button' }, asked ? 'H.264 review copy asked for' : 'Ask for an H.264 review copy');
      ask.disabled = asked;
      ask.addEventListener('click', () => {
        ask.disabled = true;
        void act({ kind: 'question', files: [ref(file)], text: H264 }, `Asked ${worker()} for an H.264 review copy. It will link the new file here.`)
          .then((sent) => { if (sent) ask.textContent = 'H.264 review copy asked for'; else ask.disabled = false; });
      });
      parts.push(ask);
    } else if (!playable && code !== 404 && code !== 403) {
      const retry = h('button.btn', { type: 'button' }, 'Try again');
      retry.addEventListener('click', () => load(file));
      parts.push(retry);
    }
    problem.replaceChildren(...parts);
    problem.classList.remove('hidden');
  }

  video.addEventListener('error', () => { if (selected && video.getAttribute('src')) void explain(selected); });
  video.addEventListener('timeupdate', () => tick());
  video.addEventListener('seeked', () => tick());
  video.addEventListener('durationchange', () => paintTrack());
  video.addEventListener('play', () => { chosen = true; element.classList.add('playing'); });
  for (const type of ['pause', 'ended', 'emptied']) video.addEventListener(type, () => element.classList.remove('playing'));

  /** As it plays: Add note's time, the playhead and the chapter it's in. */
  function tick(force = false) {
    const now = clock(video.currentTime || 0);
    if (force || now !== shownClock) { shownClock = now; add.textContent = `Add note at ${now}`; }
    const d = duration();
    if (d) playhead.style.left = `${Math.min(100, (video.currentTime / d) * 100)}%`;
    let current = -1;
    chapters.forEach((c, i) => { if (c.at <= video.currentTime + 0.25) current = i; });
    chapterList.querySelectorAll('button').forEach((b, i) => { if (i === current) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); });
  }

  track.addEventListener('click', (e) => {
    const d = duration();
    if (!d) return;
    const r = track.getBoundingClientRect();
    video.currentTime = Math.max(0, Math.min(d, ((e.clientX - r.left) / r.width) * d));
  });

  // ---- Notes ----------------------------------------------------------------------------------------------------

  function startNote() {
    if (!selected || !host.canSend()) return;
    if (notes.length >= MAX_NOTES) { setStatus(`That’s ${MAX_NOTES} notes, as many as one review takes. Send these, then carry on.`, true); return; }
    writing = { at: video.currentTime || 0, resume: writing?.resume ?? (!video.paused && !video.ended) };
    video.pause();
    at.textContent = clock(writing.at);
    input.setAttribute('aria-label', `Note at ${clock(writing.at)}`);
    compose.classList.remove('hidden');
    input.focus({ preventScroll: true });
    compose.scrollIntoView({ block: 'nearest' });
  }

  /** Puts the note being written away: kept when it says something (closing the window keeps it too), else dropped. */
  function finishNote(keep = true) {
    if (!writing) return;
    if (keep && input.value.trim()) { notes = addNote(notes, writing.at, input.value); saveDraft(draft(), notes); }
    writing = undefined;
    input.value = '';
    compose.classList.add('hidden');
  }

  function closeNote(keep: boolean) {
    const resume = writing?.resume;
    finishNote(keep);
    paintNotes(); paintTrack(); paintVersions();
    element.focus({ preventScroll: true });
    if (resume) play();
  }
  compose.addEventListener('submit', (e) => { e.preventDefault(); closeNote(true); });
  cancel.addEventListener('click', () => closeNote(false));
  add.addEventListener('click', () => startNote());

  /** Sends one review, then says so; on failure says why and keeps everything as it was. True once it's sent. */
  async function act(review: Omit<ReviewRequest, 'requestId'>, done: string, after?: () => void): Promise<boolean> {
    if (busy) return false;
    busy = true;
    setStatus('Sending…');
    paintNotes();
    try {
      await host.review(review);
      after?.();
      setStatus(done);
      return true;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'That couldn’t be sent. Try again.', true);
      return false;
    } finally {
      busy = false;
      confirming = false;
      if (selected) paintAll();
    }
  }

  send.addEventListener('click', () => {
    if (!selected || !notes.length) return;
    const file = selected, key = draft(), sending = notes, label = nameOf(file);
    void act({ kind: 'notes', files: [ref(file)], notes: sending },
      `Sent ${plural(sending.length, 'note')} on ${label} to ${worker()}. The next version comes back as a new file, linked here.`,
      () => {
        saveDraft(key, withoutNotes(loadDraft(key), sending));
        if (same(selected, file)) notes = withoutNotes(notes, sending);
      });
  });
  approve.addEventListener('click', () => { confirming = true; paintNotes(); yes.focus({ preventScroll: true }); });
  no.addEventListener('click', () => { confirming = false; paintNotes(); });
  yes.addEventListener('click', () => {
    if (!selected) return;
    const label = nameOf(selected);
    void act({ kind: 'approve', files: [ref(selected)] }, `Approved ${label}. ${worker()} was told it’s final, and not to publish it until you say so.`);
  });

  // ---- Painting -------------------------------------------------------------------------------------------------

  const pill = (text: string) => h(`span.ws-pill${text === 'Latest' ? '.latest' : text === 'Approved' ? '.good' : ''}`, {}, text);

  function paintAll() {
    empty.classList.toggle('hidden', !!selected);
    layout.classList.toggle('hidden', !selected);
    if (!selected) {
      empty.replaceChildren(h('span.screening-empty-icon', { 'aria-hidden': 'true' }, '▶'), h('strong', {}, 'Nothing to watch yet'),
        h('p', {}, `When ${worker()} links a render in a reply, it plays here, with your notes at their moments beside it.`));
      return;
    }
    paintBar(); paintNotes(); paintSent(); paintChapters(); paintVersions(); paintTrack();
  }

  function paintBar() {
    const f = selected!, v = versionLabel(f.path), latest = newest();
    version.textContent = v ?? (f.type.startsWith('audio/') ? '♪' : '▶');
    version.classList.toggle('plain', !v);
    title.textContent = f.name;
    title.title = fileTitle(f);
    meta.textContent = [fileFolder(f), fileSize(f.size), fileTime(f.modified)].filter(Boolean).join(' · ');
    pills.replaceChildren(...[...(same(latest, f) ? ['Latest'] : []), ...(data ? badges(f, data) : [])].map(pill));
    // A newer cut: the newest in this one's series of versions, else the latest the worker linked.
    const series = seriesKey(f);
    const next = files.filter((x) => !same(x, f) && x.modified > f.modified && seriesKey(x) === series).sort((a, b) => b.modified - a.modified)[0]
      ?? (latest && !same(latest, f) && latest.modified > f.modified ? latest : undefined);
    newer.classList.toggle('hidden', !next);
    if (next) {
      newer.textContent = `${nameOf(next)} is newer · Watch it`;
      newer.onclick = () => pick(next);
    }
    tick(true);
  }

  function noteRow(n: ReviewNote) {
    const time = h('button.screening-stamp', { type: 'button', title: `Play from just before ${clock(n.at)}` }, clock(n.at));
    time.addEventListener('click', () => jump(seekBefore(n.at)));
    const remove = h('button.screening-remove', { type: 'button', title: 'Remove this note', 'aria-label': `Remove the note at ${clock(n.at)}` }, '✕');
    remove.addEventListener('click', () => {
      notes = notes.filter((x) => x !== n);
      saveDraft(draft(), notes);
      paintNotes(); paintTrack(); paintVersions();
      element.focus({ preventScroll: true });
    });
    return h('li.screening-note', {}, time, h('span.screening-text', {}, n.text), remove);
  }

  function paintNotes() {
    const f = selected!, can = host.canSend(), label = nameOf(f);
    const approved = !!data && reviewsOf(f, data).some((r) => r.kind === 'approve');
    add.classList.toggle('hidden', !can);
    add.disabled = notes.length >= MAX_NOTES;
    noteKeys.classList.toggle('hidden', !can);
    for (const el of [noteList, actions]) el.classList.toggle('hidden', !can);
    readOnly.classList.toggle('hidden', can);
    readOnly.textContent = `You can watch here. Only an admin, or the person who hired ${worker()}, can send it notes or approve a cut.`;
    notesHead.textContent = can ? `Your notes on ${label}${notes.length ? ` · ${notes.length}` : ''}` : 'Notes';
    noteList.replaceChildren(...notes.map(noteRow));
    if (!notes.length) noteList.append(h('li.screening-hint', {}, 'Press N, or Add note, as it plays. Each note keeps its moment and waits here until you send it.'));
    send.textContent = busy ? 'Sending…' : notes.length ? `Send ${plural(notes.length, 'note')} to ${worker()}` : `Send notes to ${worker()}`;
    send.disabled = busy || !notes.length;
    approve.classList.toggle('hidden', approved || confirming);
    approve.disabled = busy;
    confirm.classList.toggle('hidden', !confirming || !can);
    const unsent = notes.length ? ` Your ${plural(notes.length, 'unsent note')} stay here.` : '';
    confirmText.textContent = `Tell ${worker()} that ${label} is final? Nothing is published, moved or renamed.${unsent}`;
    yes.textContent = `Approve ${label}`;
    yes.disabled = busy;
  }

  /** What was asked of this cut, and of the versions before it: click a time to check that moment in this one. */
  function paintSent() {
    const groups = sentGroups();
    sentBox.classList.toggle('hidden', !groups.length);
    sentBox.replaceChildren();
    for (const g of groups) {
      const own = same(g.file, selected);
      sentBox.append(h('h4', {}, `Notes sent on ${nameOf(g.file)}`, g.at ? h('span.screening-when', {}, ` · ${fileTime(g.at)}`) : null));
      if (!own) sentBox.append(h('p.screening-hint', {}, `Click a time to check that moment in ${nameOf(selected!)}.`));
      sentBox.append(h('ol.screening-list.sent', {}, ...g.notes.map((n) => {
        const time = h('button.screening-stamp', { type: 'button', title: own ? `Play from just before ${clock(n.at)}` : `Check ${clock(n.at)} in this cut` }, clock(n.at));
        time.addEventListener('click', () => jump(seekBefore(n.at)));
        return h('li.screening-note', {}, time, h('span.screening-text', {}, n.text));
      })));
    }
  }

  function paintChapters() {
    chaptersBox.classList.toggle('hidden', !chapters.length);
    chapterList.replaceChildren(...chapters.map((c) => {
      const b = h('button.screening-chapter', { type: 'button' }, h('span.screening-stamp', {}, clock(c.at)), h('span.screening-text', {}, c.title));
      b.addEventListener('click', () => jump(c.at));
      return h('li', {}, b);
    }));
    tick();
  }

  /** Every cut in the tab, by where it came from: its version, folder, size and time, with Latest, Approved, notes sent and an unsent draft. */
  function paintVersions() {
    versionsBox.classList.toggle('hidden', files.length < 2 || !data);
    versionList.replaceChildren();
    if (!data || files.length < 2) return;
    const latest = newest();
    for (const s of sections(files, data, worker())) {
      versionList.append(h('div.screening-section', {}, s.title));
      for (const f of s.files) {
        const item = fileItem(f, { data, url: host.url, selected: same(f, selected), latest: same(f, latest), onClick: () => pick(f) });
        const waiting = same(f, selected) ? notes.length : loadDraft(draftKey(host.workerId, f)).length;
        if (waiting) {
          const holder = item.querySelector('.ws-pills') ?? item.appendChild(h('span.ws-pills'));
          holder.append(h('span.ws-pill.draft', { title: 'Notes you wrote here and haven’t sent yet' }, `Unsent · ${waiting}`));
        }
        versionList.append(item);
      }
    }
  }

  /** The strip under the player: chapters as ticks, sent notes as rings (from earlier versions too), yours as dots. */
  function paintTrack() {
    const d = duration();
    track.classList.toggle('hidden', !d || !selected);
    if (!d || !selected) return;
    const mark = (kind: string, t: number, tip: string, to: number) => {
      const b = h(`button.screening-mark.${kind}`, { type: 'button', tabindex: '-1', title: tip, 'aria-hidden': 'true' });
      b.style.left = `${Math.min(100, Math.max(0, (t / d) * 100))}%`;
      b.addEventListener('click', (e) => { e.stopPropagation(); jump(to); });
      return b;
    };
    const sent = sentGroups().flatMap((g) => g.notes.map((n) => ({ ...n, on: nameOf(g.file) })));
    marks.replaceChildren(
      ...chapters.filter((c) => c.at < d).map((c) => mark('chapter', c.at, `${clock(c.at)} ${c.title}`, c.at)),
      ...sent.filter((n) => n.at <= d).map((n) => mark('sent', n.at, `${clock(n.at)} sent on ${n.on}: ${n.text}`, seekBefore(n.at))),
      ...notes.filter((n) => n.at <= d).map((n) => mark('note', n.at, `${clock(n.at)} ${n.text}`, seekBefore(n.at))),
    );
    tick();
  }

  // ---- Chapters -------------------------------------------------------------------------------------------------

  /** A chapters.txt in the cut's folder, or the one above it (jev-v01/chapters.txt for jev-v01/renders/…mp4). */
  function chaptersFile(f: ChatArtifact, d: ChatSnapshot): ChatArtifact | undefined {
    const dir = dirOf(f.path), up = dir ? dirOf(dir.slice(0, -1)) : undefined;
    const wanted = [`${dir}chapters.txt`, ...(up !== undefined ? [`${up}chapters.txt`] : [])].map((p) => p.toLowerCase());
    const all = [...(d.linked ?? []), ...(d.nearby ?? []), ...d.artifacts];
    for (const p of wanted) {
      const hit = all.find((x) => (x.root ?? '') === (f.root ?? '') && x.path.toLowerCase() === p && x.size <= CHAPTERS_MAX);
      if (hit) return hit;
    }
    return undefined;
  }

  function findChapters() {
    const source = selected && data ? chaptersFile(selected, data) : undefined;
    const key = source ? `${artifactKey(source)}@${source.modified}` : '';
    if (key === chaptersFrom) return;
    chaptersFrom = key;
    chapters = [];
    if (!source) return;
    let text = texts.get(key);
    if (!text) {
      text = fetch(host.url(source), { credentials: 'same-origin', cache: 'no-store', signal: abort.signal }).then((r) => (r.ok ? r.text() : undefined)).catch(() => undefined);
      texts.set(key, text);
    }
    void text.then((t) => {
      if (chaptersFrom !== key || !selected) return;
      chapters = t ? parseChapters(t) : [];
      paintChapters();
      paintTrack();
    });
  }

  // ---- The panel ------------------------------------------------------------------------------------------------

  function paint(next: ChatArtifact[], snapshot: ChatSnapshot) {
    data = snapshot;
    files = next.filter((f) => /^(video|audio)\//.test(f.type));
    const fresh = selected && files.find((f) => same(f, selected));
    if (selected && !fresh) {
      // No longer linked, no longer shared, or gone: it leaves the player.
      finishNote();
      release();
      selected = undefined;
      chosen = false;
      notes = [];
      chaptersFrom = '';
      chapters = [];
    } else if (selected && fresh && fresh.modified !== selected.modified && video.paused) {
      // Written again in place: load it again where it was.
      remember();
      selected = fresh;
      load(fresh);
    } else if (fresh) selected = fresh;
    // Until the viewer picks or plays one, the room follows the newest cut the worker linked.
    const latest = newest();
    const idle = video.paused && !writing && !notes.length && !busy;
    if (!selected || (!chosen && latest && !same(latest, selected) && idle)) {
      const first = latest ?? files[0];
      if (first) select(first);
    } else if (!video.getAttribute('src')) load(selected);
    findChapters();
    paintAll();
  }

  return {
    element,
    paint,
    show(file) {
      chosen = true;
      select(file);
      paintAll();
      element.scrollTo({ top: 0 });
    },
    key(e) {
      if (!selected || e.metaKey || e.ctrlKey || e.altKey) return false;
      const k = e.key.toLowerCase();
      // Space on a button or the player itself is theirs: it presses the button, or the player's own play.
      const onControl = e.target instanceof Element && !!e.target.closest('button, a, video, audio, summary, [role=tab]');
      if (k === 'k' || (k === ' ' && !onControl)) {
        if (!e.repeat) { if (video.paused) play(); else video.pause(); }
      } else if (k === 'j' || k === 'l') {
        const d = duration(), t = video.currentTime + (k === 'j' ? -5 : 5);
        video.currentTime = Math.max(0, d ? Math.min(d, t) : t);
      } else if (k === 'n' && host.canSend()) {
        // Before the input takes focus, so the N isn't typed into it.
        e.preventDefault();
        if (!e.repeat) startNote();
      } else return false;
      return true;
    },
    stop() {
      finishNote();
      release();
      element.classList.remove('playing');
      abort.abort();
      abort = new AbortController();
    },
  };
}
