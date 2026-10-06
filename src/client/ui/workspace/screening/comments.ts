import { h } from '../../dom';
import { artifactKey, type ReviewNote } from '../../../../shared/worker-chat';
import { clock } from '../../../../shared/workspace';
import { fileTime } from '../files';
import { MAX_NOTES, WHOLE_CUT, addNote, loadDraft, saveDraft, seekBefore, withoutNotes, type SentNotes } from '../notes';
import type { TimelineMark } from './player';

// The screening room's sidebar (room.ts), as Frame.io's: the notes on this cut not sent yet, then what was sent on it
// and on the versions before it, newest first, each at its moment, with Open / Done / All and a check to mark one done;
// the chapters on a tab of their own; and the box that writes the next note, at the moment the cut was at when you
// started (the cut waits while you write) or about the whole cut.

export type Chapter = { at: number; title: string };
export type Marks = Record<string, { by: string; at: number }>;
type Filter = 'open' | 'done' | 'all';
type FileRef = { root?: string; path: string };

export interface CommentsDeps {
  workerName: string;
  canSend(): boolean;
  time(): number;
  seek(at: number, play: boolean): void;
  /** Writing a note: the cut waits, and plays on afterwards if it was playing. */
  hold(): void;
  letGo(resume: boolean): void;
  /** The notes to mark along the timeline changed. */
  changed(): void;
  send(notes: ReviewNote[]): Promise<void>;
  mark(key: string, done: boolean): Promise<void>;
}

const whole = (n: ReviewNote) => n.where === WHOLE_CUT;
const stamp = (n: ReviewNote) => (whole(n) ? 'Whole cut' : clock(n.at));

export function screeningComments(d: CommentsDeps) {
  let draftKey = '';
  let label = '';
  let drafts: ReviewNote[] = [];
  let sent: SentNotes[] = [];
  let current: FileRef | undefined;
  let nameOf: (f: FileRef) => string = (f) => f.path;
  let marks: Marks = {};
  let chapters: Chapter[] = [];
  let filter: Filter = 'open';
  let tab: 'notes' | 'chapters' = 'notes';
  /** The moment the note being written is at, from when the box was first used; and whether it's about the whole cut. */
  let pinned: number | undefined;
  let aboutWhole = false;
  let busy = false;

  const notesTab = h('button', { type: 'button' }, 'Comments');
  const chaptersTab = h('button', { type: 'button' }, 'Chapters');
  const count = h('span.rr-count');
  const filters = h('div.rr-filters', { role: 'group', 'aria-label': 'Show' }, ...(['open', 'done', 'all'] as Filter[]).map((f) => {
    const b = h('button', { type: 'button', 'data-filter': f }, f === 'open' ? 'Open' : f === 'done' ? 'Done' : 'All');
    b.addEventListener('click', () => {
      filter = f;
      paint();
      d.changed();
    });
    return b;
  }));
  const list = h('div.rr-list');
  const atChip = h('button.sr-at', { type: 'button', title: 'At this moment, or about the whole cut' });
  const onText = h('span.rr-on-text');
  const on = h('div.rr-on', {}, atChip, onText);
  const input = h('textarea.rr-input', { rows: 3, placeholder: 'Leave a comment…', 'aria-label': 'Note', maxlength: 1000 }) as HTMLTextAreaElement;
  const add = h('button.rr-add', { type: 'button' }, 'Comment');
  const compose = h('div.rr-compose', {}, on, input, h('div.rr-compose-row', {}, h('span.rr-hint', {}, 'Enter to add · N for a note at the moment'), add));
  const send = h('button.rr-send', { type: 'button' });
  const status = h('p.rr-status', { 'aria-live': 'polite' });
  const sendbar = h('div.rr-sendbar', {}, send, status);
  const element = h('aside.rr-side', { 'aria-label': 'Comments' },
    h('div.rr-side-head', {}, h('div.sr-tabs', {}, notesTab, chaptersTab), count, filters),
    list, compose, sendbar);

  const keep = () => saveDraft(draftKey, drafts);
  const doneOf = (key: string) => !!marks[key];
  const shows = (state: 'draft' | 'open' | 'done') => (filter === 'all' ? true : filter === 'done' ? state === 'done' : state !== 'done');

  // ---- Writing ----
  function begin() {
    if (pinned === undefined) {
      pinned = d.time();
      d.hold();
    }
    paintBox();
  }
  input.addEventListener('focus', begin);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      commit();
    }
  });
  atChip.addEventListener('click', () => {
    aboutWhole = !aboutWhole;
    paintBox();
    input.focus({ preventScroll: true });
  });
  add.addEventListener('click', commit);
  function commit() {
    const text = input.value.trim();
    if (!text) return input.focus();
    if (drafts.length >= MAX_NOTES) {
      status.textContent = `That’s ${MAX_NOTES} notes, as many as one review takes. Send these, then carry on.`;
      return;
    }
    drafts = addNote(drafts, pinned ?? d.time(), text, aboutWhole);
    keep();
    input.value = '';
    pinned = undefined;
    aboutWhole = false;
    input.blur();
    if (filter === 'done') filter = 'open';
    paint();
    d.changed();
    d.letGo(true);
  }
  /** Esc in the box: what's written stays for later; with nothing written, the cut goes on as it was. */
  function cancel() {
    input.blur();
    if (input.value.trim()) return;
    pinned = undefined;
    aboutWhole = false;
    paintBox();
    d.letGo(true);
  }

  send.addEventListener('click', async () => {
    if (!drafts.length || busy) return;
    const going = drafts;
    busy = true;
    status.textContent = 'Sending…';
    paint();
    try {
      await d.send(going);
      drafts = withoutNotes(loadDraft(draftKey), going);
      keep();
      status.textContent = `Sent to ${d.workerName}. The next version comes back as a new file, here.`;
    } catch (e) {
      status.textContent = e instanceof Error ? e.message : 'That couldn’t be sent. Try again.';
    } finally {
      busy = false;
      paint();
      d.changed();
    }
  });

  // ---- The list ----
  function card(n: ReviewNote, state: 'draft' | 'open' | 'done', key: string, i: number, own: boolean): HTMLElement {
    const chip = h('button.sr-stamp', { type: 'button', title: whole(n) ? 'About the whole cut' : own ? `Play from just before ${clock(n.at)}` : `Check ${clock(n.at)} in this cut` }, state === 'done' ? `✓ ${stamp(n)}` : stamp(n));
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!whole(n)) d.seek(seekBefore(n.at), true);
    });
    const actions: HTMLElement[] = [];
    if (state === 'draft') {
      const x = h('button.rr-icon', { type: 'button', title: 'Remove', 'aria-label': `Remove the note at ${stamp(n)}` }, '✕');
      x.addEventListener('click', (e) => {
        e.stopPropagation();
        drafts = drafts.filter((_, j) => j !== i);
        keep();
        paint();
        d.changed();
      });
      actions.push(x);
    } else {
      const isDone = state === 'done';
      const check = h('button.rr-check', { type: 'button', 'aria-pressed': String(isDone), title: isDone ? 'Reopen' : 'Mark done', 'aria-label': `${isDone ? 'Reopen' : 'Mark done'}: ${n.text.slice(0, 40)}`, disabled: !d.canSend() }, '✓');
      check.addEventListener('click', async (e) => {
        e.stopPropagation();
        check.disabled = true;
        try {
          await d.mark(key, !isDone);
        } catch (err) {
          status.textContent = err instanceof Error ? err.message : 'That didn’t save';
          check.disabled = false;
        }
      });
      actions.push(check);
    }
    const el = h('div.rr-card.sr-card', { 'data-state': state, 'data-key': key, 'data-at': whole(n) ? '' : String(n.at), tabindex: '0', role: 'button', title: whole(n) ? '' : `Go to ${clock(n.at)}` },
      h('div.rr-card-head', {}, chip, h('span.rr-grow'), ...actions),
      h('p.rr-text.sr-text', {}, n.text));
    const go = () => !whole(n) && d.seek(n.at, false);
    el.addEventListener('click', go);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target === el) go();
    });
    return el;
  }

  function paintNotes() {
    const groups: HTMLElement[] = [];
    if (drafts.length && shows('draft')) groups.push(h('section.rr-group', {}, h('h4', {}, 'Not sent yet'), ...drafts.map((n, i) => card(n, 'draft', `draft#${i}`, i, true))));
    for (const g of sent) {
      const own = !!current && artifactKey(g.file) === artifactKey(current);
      const cards = g.notes.flatMap((n, i) => {
        const key = `${g.id}#${i}`, state = doneOf(key) ? 'done' : 'open';
        return shows(state) ? [card(n, state, key, i, own)] : [];
      });
      if (!cards.length) continue;
      const when = g.at ? ` · ${fileTime(g.at)}` : '';
      groups.push(h('section.rr-group', {}, h('h4', {}, own ? 'Sent' : `Sent on ${nameOf(g.file)}`, h('span', {}, own ? when : `${when} · check them in ${label}`)), ...cards));
    }
    if (!groups.length) {
      groups.push(h('div.rr-none', {},
        h('strong', {}, filter === 'done' ? 'Nothing done yet' : 'No open notes'),
        h('p', {}, filter === 'done' ? `Check a note once ${d.workerName} has fixed it.` : 'Press N as it plays, or click the box below: the note keeps the moment, and the cut waits while you write.')));
    }
    list.replaceChildren(...groups);
  }

  function paintChapters() {
    list.replaceChildren(h('ol.sr-chapters', {}, ...chapters.map((c) => {
      const b = h('button', { type: 'button', 'data-at': String(c.at) }, h('span.sr-stamp', {}, clock(c.at)), h('span', {}, c.title));
      b.addEventListener('click', () => d.seek(c.at, true));
      return h('li', {}, b);
    })));
  }

  function paintBox() {
    const can = d.canSend();
    input.disabled = add.disabled = atChip.disabled = !can || !current;
    atChip.classList.toggle('whole', aboutWhole);
    atChip.textContent = aboutWhole ? 'Whole cut' : `⏱ ${clock(pinned ?? d.time())}`;
    onText.textContent = !can ? `You can watch here. Only an admin, or whoever hired ${d.workerName}, can send it notes.` : aboutWhole ? 'About the whole cut · click to pin it to the moment' : pinned !== undefined ? 'The cut waits while you write' : 'At this moment · click for the whole cut';
  }

  function paint() {
    for (const b of filters.querySelectorAll<HTMLElement>('button')) b.classList.toggle('on', b.dataset.filter === filter);
    notesTab.classList.toggle('on', tab === 'notes');
    chaptersTab.classList.toggle('on', tab === 'chapters');
    chaptersTab.hidden = !chapters.length;
    filters.hidden = tab !== 'notes';
    const open = sent.reduce((n, g) => n + g.notes.filter((_, i) => !doneOf(`${g.id}#${i}`)).length, 0);
    count.textContent = String(drafts.length + open);
    count.hidden = tab !== 'notes';
    if (tab === 'chapters' && chapters.length) paintChapters();
    else paintNotes();
    paintBox();
    compose.hidden = sendbar.hidden = tab !== 'notes';
    send.textContent = busy ? 'Sending…' : drafts.length ? `Send ${drafts.length === 1 ? '1 note' : `${drafts.length} notes`} to ${d.workerName}` : `Send to ${d.workerName}`;
    send.disabled = busy || !drafts.length || !d.canSend();
  }
  notesTab.addEventListener('click', () => {
    tab = 'notes';
    paint();
  });
  chaptersTab.addEventListener('click', () => {
    tab = 'chapters';
    paint();
  });

  let lastNear = '';
  return {
    element,
    /** A cut to write notes on: its drafts, its name. */
    setCut(o: { draftKey: string; label: string; file: FileRef }) {
      if (o.draftKey !== draftKey) {
        pinned = undefined;
        aboutWhole = false;
        input.value = '';
        status.textContent = '';
      }
      draftKey = o.draftKey;
      label = o.label;
      current = o.file;
      drafts = loadDraft(draftKey);
      paint();
    },
    setSent(groups: SentNotes[], names: (f: FileRef) => string) {
      sent = groups;
      nameOf = names;
      paint();
    },
    setMarks(m: Marks) {
      marks = m;
      paint();
    },
    setChapters(c: Chapter[]) {
      chapters = c;
      if (!c.length) tab = 'notes';
      paint();
    },
    drafts: () => drafts,
    /** Open notes on this cut sent and not done: the review isn't through. */
    openOnThisCut: () => sent.some((g) => !!current && artifactKey(g.file) === artifactKey(current) && g.notes.some((_, i) => !doneOf(`${g.id}#${i}`))),
    sentOnThisCut: () => sent.some((g) => !!current && artifactKey(g.file) === artifactKey(current)),
    /** What to mark along the timeline, as the filter shows them. */
    timeline(): TimelineMark[] {
      const out: TimelineMark[] = chapters.map((c) => ({ at: c.at, kind: 'chapter', tip: `${clock(c.at)} ${c.title}` }));
      drafts.forEach((n, i) => !whole(n) && shows('draft') && out.push({ at: n.at, kind: 'draft', tip: `${clock(n.at)} ${n.text}`, key: `draft#${i}` }));
      for (const g of sent) {
        g.notes.forEach((n, i) => {
          const key = `${g.id}#${i}`, state = doneOf(key) ? 'done' : 'open';
          if (!whole(n) && shows(state)) out.push({ at: n.at, kind: state, tip: `${clock(n.at)} ${n.text}`, key });
        });
      }
      return out;
    },
    /** N: a note at the moment the cut is at. */
    write() {
      tab = 'notes';
      paint();
      input.focus({ preventScroll: true });
    },
    writing: () => document.activeElement === input,
    cancel,
    /** As it plays: the moment in the box, and the notes and chapter it's at. */
    tick(t: number) {
      if (pinned === undefined && !aboutWhole) atChip.textContent = `⏱ ${clock(t)}`;
      let near = '';
      for (const el of list.querySelectorAll<HTMLElement>('[data-at]')) {
        const at = Number(el.dataset.at);
        const hit = el.dataset.at !== '' && (el.tagName === 'BUTTON' ? at <= t + 0.25 : Math.abs(at - t) < 0.6);
        if (hit) near += `${el.dataset.key ?? at};`;
      }
      if (near === lastNear) return;
      lastNear = near;
      if (tab === 'chapters') {
        const buttons = [...list.querySelectorAll<HTMLElement>('button[data-at]')];
        const currentChapter = buttons.filter((b) => Number(b.dataset.at) <= t + 0.25).pop();
        for (const b of buttons) b.toggleAttribute('aria-current', b === currentChapter);
      } else for (const el of list.querySelectorAll<HTMLElement>('.sr-card')) el.classList.toggle('near', el.dataset.at !== '' && Math.abs(Number(el.dataset.at) - t) < 0.6);
    },
    /** A mark on the timeline was clicked: its card, in view. */
    showKey(key: string) {
      tab = 'notes';
      paint();
      const el = list.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);
      el?.scrollIntoView({ block: 'nearest' });
      el?.classList.add('flash');
      setTimeout(() => el?.classList.remove('flash'), 900);
    },
    paint,
  };
}

export type ScreeningComments = ReturnType<typeof screeningComments>;
