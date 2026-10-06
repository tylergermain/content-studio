import { h } from '../dom';
import { artifactKey, type ReviewNote } from '../../../shared/worker-chat';
import { fileTime } from './files';
import type { Marks } from './marks';
import { MAX_NOTES, addNote, loadDraft, saveDraft, withoutNotes, type DraftNote, type SentNotes } from './notes';

// The notes down the right of a review room (room-shell.ts) for an image, a document or a design, as Frame.io lists
// comments: the ones not sent yet first, then what was sent on this file and on its versions before, newest first,
// with Open / Done / All and a check to mark one done. Each is pinned where it was written (a point on the image, a
// quote, an element: the room says, with `pick`) or is about the whole file. The box at the bottom writes the next
// one; a room that takes questions has Comment / Question over it. Notes not sent yet stay in this browser
// (notes.ts); what was sent comes back from the reviews on the chat's messages; which are done is on the floor.

type FileRef = { root?: string; path: string };
type Filter = 'open' | 'done' | 'all';

/** What a note is pinned to: words for the worker (`where`), a few for the list (`label`), and what the room needs to pin it again. */
export interface NotePin { where: string; label: string; pin?: Record<string, string | number> }
/** A note as the room shows it: its number on this file (none from an earlier version), its key, and where it stands. */
export interface ShownNote { n?: number; key: string; state: 'draft' | 'open' | 'done'; note: DraftNote; own: boolean }

export interface NotesSideDeps {
  workerName: string;
  /** What a note on nothing in particular is about: "the whole image". */
  whole: string;
  /** What the list says with nothing in it, as how to start. */
  hint: string;
  canSend(): boolean;
  /** What's picked in the room now, for the next note; undefined for the whole file. */
  pick(): NotePin | undefined;
  unpick(): void;
  /** The notes to pin changed (one added, sent, done, the filter). */
  changed(): void;
  focus(n: ShownNote | undefined): void;
  reveal(n: ShownNote): void;
  send(notes: ReviewNote[]): Promise<void>;
  mark(key: string, done: boolean): Promise<void>;
  /** A room that takes a question about the file (a report) has Comment / Question over the box. */
  question?(text: string): Promise<void>;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function notesSide(d: NotesSideDeps) {
  let draftKey = '';
  let label = '';
  let file: FileRef | undefined;
  let drafts: DraftNote[] = [];
  let sent: SentNotes[] = [];
  let nameOf: (f: FileRef) => string = (f) => f.path;
  let marks: Marks = {};
  let filter: Filter = 'open';
  let mode: 'note' | 'question' = 'note';
  let busy = false;

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
  const modes = h('div.rr-filters.ns-modes', { role: 'group', 'aria-label': 'Write' }, ...(['note', 'question'] as const).map((m) => {
    const b = h('button', { type: 'button', 'data-mode': m }, m === 'note' ? 'Comment' : 'Question');
    b.addEventListener('click', () => {
      mode = m;
      paint();
      input.focus({ preventScroll: true });
    });
    return b;
  }));
  modes.hidden = !d.question;
  const onText = h('span.rr-on-text');
  const unpin = h('button.rr-icon', { type: 'button', title: `Make it about ${d.whole}`, 'aria-label': 'Unpin' }, '✕');
  unpin.addEventListener('click', () => {
    d.unpick();
    paint();
    d.changed();
  });
  const on = h('div.rr-on', {}, onText, unpin);
  const input = h('textarea.rr-input', { rows: 3, placeholder: 'Leave a comment…', 'aria-label': 'Comment', maxlength: 1000 }) as HTMLTextAreaElement;
  const add = h('button.rr-add', { type: 'button' }, 'Comment');
  const send = h('button.rr-send', { type: 'button' });
  const status = h('p.rr-status', { 'aria-live': 'polite' });
  const element = h('aside.rr-side', { 'aria-label': 'Comments' },
    h('div.rr-side-head', {}, h('strong', {}, 'Comments'), count, filters),
    list,
    h('div.rr-compose', {}, modes, on, input, h('div.rr-compose-row', {}, h('span.rr-hint', {}, 'Enter to add · Shift+Enter for a new line'), add)),
    h('div.rr-sendbar', {}, send, status));

  const keep = () => saveDraft(draftKey, drafts);
  const doneOf = (key: string) => !!marks[key];
  const shows = (s: ShownNote['state']) => (filter === 'all' ? true : filter === 'done' ? s === 'done' : s !== 'done');
  const ownGroups = () => sent.filter((g) => !!file && artifactKey(g.file) === artifactKey(file)).slice().reverse();

  /** Every note on this file and its versions, numbered as their pins are: this file's sent ones oldest first, then the drafts. */
  function all(): ShownNote[] {
    const out: ShownNote[] = [];
    let n = 0;
    for (const g of ownGroups()) g.notes.forEach((note, i) => out.push({ n: ++n, key: `${g.id}#${i}`, state: doneOf(`${g.id}#${i}`) ? 'done' : 'open', note, own: true }));
    drafts.forEach((note, i) => out.push({ n: ++n, key: `draft#${i}`, state: 'draft', note, own: true }));
    for (const g of sent) {
      if (file && artifactKey(g.file) === artifactKey(file)) continue;
      g.notes.forEach((note, i) => out.push({ key: `${g.id}#${i}`, state: doneOf(`${g.id}#${i}`) ? 'done' : 'open', note, own: false }));
    }
    return out;
  }

  // ---- Writing ----
  function commit() {
    const text = input.value.trim();
    if (!text) return input.focus();
    if (mode === 'question') return void ask(text);
    if (drafts.length >= MAX_NOTES) {
      status.textContent = `That’s ${MAX_NOTES} notes, as many as one review takes. Send these, then carry on.`;
      return;
    }
    const p = d.pick();
    drafts = addNote(drafts, 0, text, p?.where ?? d.whole, p?.pin);
    keep();
    input.value = '';
    d.unpick();
    if (filter === 'done') filter = 'open';
    paint();
    d.changed();
  }
  async function ask(text: string) {
    if (busy || !d.question) return;
    busy = true;
    status.textContent = 'Sending…';
    try {
      await d.question(text);
      input.value = '';
      mode = 'note';
      status.textContent = `Asked ${d.workerName}. The answer comes in the chat.`;
    } catch (e) {
      status.textContent = e instanceof Error ? e.message : 'That couldn’t be sent. Try again.';
    } finally {
      busy = false;
      paint();
    }
  }
  add.addEventListener('click', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      commit();
    }
  });

  send.addEventListener('click', async () => {
    if (!drafts.length || busy) return;
    const going = drafts;
    busy = true;
    status.textContent = 'Sending…';
    paint();
    try {
      await d.send(going.map(({ at, text, where }) => ({ at, text, ...(where ? { where } : {}) })));
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
  function card(s: ShownNote): HTMLElement {
    const whole = !s.note.where || s.note.where === d.whole;
    const actions: HTMLElement[] = [];
    if (s.state === 'draft') {
      const x = h('button.rr-icon', { type: 'button', title: 'Remove', 'aria-label': `Remove comment ${s.n}` }, '✕');
      x.addEventListener('click', (e) => {
        e.stopPropagation();
        drafts = drafts.filter((n) => n !== s.note);
        keep();
        paint();
        d.changed();
      });
      actions.push(x);
    } else {
      const isDone = s.state === 'done';
      const check = h('button.rr-check', { type: 'button', 'aria-pressed': String(isDone), title: isDone ? 'Reopen' : 'Mark done', 'aria-label': `${isDone ? 'Reopen' : 'Mark done'}: ${s.note.text.slice(0, 40)}`, disabled: !d.canSend() }, '✓');
      check.addEventListener('click', async (e) => {
        e.stopPropagation();
        check.disabled = true;
        try {
          await d.mark(s.key, !isDone);
        } catch (err) {
          status.textContent = err instanceof Error ? err.message : 'That didn’t save';
          check.disabled = false;
        }
      });
      actions.push(check);
    }
    const el = h('div.rr-card.ns-card', { 'data-state': s.state, 'data-key': s.key, tabindex: '0', role: 'button', title: whole ? '' : 'Show it' },
      h('div.rr-card-head', {}, h('span.rr-pin', {}, s.state === 'done' ? '✓' : s.n ? String(s.n) : '↺'), h('span.ns-where', {}, whole ? cap(d.whole) : s.note.where!), h('span.rr-grow'), ...actions),
      h('p.rr-text.ns-text', {}, s.note.text));
    el.addEventListener('mouseenter', () => d.focus(s));
    el.addEventListener('mouseleave', () => d.focus(undefined));
    el.addEventListener('click', () => d.reveal(s));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target === el) d.reveal(s);
    });
    return el;
  }

  function paint() {
    for (const b of filters.querySelectorAll<HTMLElement>('button')) b.classList.toggle('on', b.dataset.filter === filter);
    for (const b of modes.querySelectorAll<HTMLElement>('button')) b.classList.toggle('on', b.dataset.mode === mode);
    const notes = all();
    count.textContent = String(notes.filter((s) => s.state !== 'done').length);
    const groups: HTMLElement[] = [];
    const draftCards = notes.filter((s) => s.state === 'draft' && shows('draft')).map(card);
    if (draftCards.length) groups.push(h('section.rr-group', {}, h('h4', {}, 'Not sent yet'), ...draftCards));
    for (const g of sent) {
      const own = !!file && artifactKey(g.file) === artifactKey(file);
      const cards = notes.filter((s) => s.key.startsWith(`${g.id}#`) && shows(s.state)).map(card);
      if (!cards.length) continue;
      const when = g.at ? ` · ${fileTime(g.at)}` : '';
      groups.push(h('section.rr-group', {}, h('h4', {}, own ? 'Sent' : `Sent on ${nameOf(g.file)}`, h('span', {}, own ? when : `${when} · check them in ${label}`)), ...cards));
    }
    if (!groups.length) groups.push(h('div.rr-none', {}, h('strong', {}, filter === 'done' ? 'Nothing done yet' : 'No open comments'), h('p', {}, filter === 'done' ? `Check a comment once ${d.workerName} has fixed it.` : d.hint)));
    list.replaceChildren(...groups);

    const can = d.canSend() && !!file;
    input.disabled = add.disabled = !can;
    const p = d.pick();
    unpin.hidden = !p || mode === 'question';
    onText.textContent = !d.canSend() ? `You can look here. Only an admin, or whoever hired ${d.workerName}, can send it comments.`
      : mode === 'question' ? `A question about ${label}: the answer comes in the chat` : p ? `On ${p.label}` : `About ${d.whole}`;
    input.placeholder = mode === 'question' ? `Ask ${d.workerName} about it…` : 'Leave a comment…';
    add.textContent = mode === 'question' ? 'Ask' : 'Comment';
    send.textContent = busy ? 'Sending…' : drafts.length ? `Send ${drafts.length === 1 ? '1 comment' : `${drafts.length} comments`} to ${d.workerName}` : `Send to ${d.workerName}`;
    send.disabled = busy || !drafts.length || !d.canSend();
  }

  return {
    element,
    /** The file the notes are on, with its drafts. */
    setFile(o: { draftKey: string; label: string; file: FileRef }) {
      if (o.draftKey !== draftKey) {
        input.value = '';
        status.textContent = '';
        mode = 'note';
      }
      draftKey = o.draftKey;
      label = o.label;
      file = o.file;
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
    /** The room picked something (or let go of it): the box says where the next note goes. */
    picked() {
      mode = 'note';
      paint();
      input.focus({ preventScroll: true });
    },
    /** This file's notes as the filter shows them, numbered: what the room pins. */
    pins: () => all().filter((s) => s.own && shows(s.state)),
    /** Sent notes on this file that aren't done: its review isn't through. */
    open: () => all().some((s) => s.own && s.state === 'open'),
    sentHere: () => ownGroups().length > 0,
    drafts: () => drafts,
    focusBox: () => input.focus({ preventScroll: true }),
    writing: () => document.activeElement === input,
    busy: () => document.activeElement === input || !!input.value.trim(),
    showKey(key: string) {
      if (filter !== 'all') {
        filter = 'all';
        paint();
      }
      const el = list.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);
      el?.scrollIntoView({ block: 'nearest' });
      el?.classList.add('flash');
      setTimeout(() => el?.classList.remove('flash'), 900);
    },
    paint,
  };
}

export type NotesSide = ReturnType<typeof notesSide>;
