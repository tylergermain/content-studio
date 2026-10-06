import { h, timeAgo } from '../../dom';
import { WHOLE_PAGE, type ReviewPick, type SentComment, type SoftwareReviewState } from '../../../../shared/software-review';
import { loadDrafts, saveDrafts, type Draft } from './api';

// The review room's sidebar (room.ts), as in Frame.io: every comment, the ones not sent yet first and
// then each round sent, newest first, with Open / Done / All; a check marks one done. The box at the
// bottom writes the next one, pinned to what was last clicked in comment mode or else about the page.

export type PinState = 'draft' | 'open' | 'done';
export interface Pin { n: number; selector: string; state: PinState }
/** Where a comment is: what the room needs to show it, highlight it or go to it. */
export interface Spot { app: string; page: string; selector: string }
type Filter = 'open' | 'done' | 'all';

export interface CommentsDeps {
  workerId: string;
  workerName: string;
  me: () => string;
  canSend: () => boolean;
  /** The app open now and its page. */
  where: () => { app: string; page: string } | undefined;
  focus(s: Spot | undefined): void;
  reveal(s: Spot): void;
  /** The pins to draw changed. */
  changed(): void;
  /** Sends these drafts (all on the app open now) as one round. */
  send(drafts: Draft[]): Promise<void>;
  done(id: string, done: boolean): Promise<void>;
}

export interface Comments {
  element: HTMLElement;
  pick(p: { pick: ReviewPick; page: string }): void;
  clearPick(): void;
  hasPick(): boolean;
  /** Something written in the box, or a pick waiting for it. */
  busy(): boolean;
  setState(s: SoftwareReviewState): void;
  pins(app: string, page: string): Pin[];
  drafts(): Draft[];
  focusBox(): void;
  paint(): void;
}

const shortApp = (app: string) => app.replace(/^https?:\/\/(localhost|127\.0\.0\.1):/, 'port ');

export function reviewComments(d: CommentsDeps): Comments {
  let state: SoftwareReviewState = { rounds: [], comments: [] };
  let drafts = loadDrafts(d.workerId);
  let filter: Filter = 'open';
  let picked: { pick: ReviewPick; page: string } | undefined;
  let error = '';

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
  const on = h('div.rr-on');
  const input = h('textarea.rr-input', { rows: 3, placeholder: 'Leave a comment…', 'aria-label': 'Comment', maxlength: 1000 }) as HTMLTextAreaElement;
  const add = h('button.rr-add', { type: 'button' }, 'Comment');
  const send = h('button.rr-send', { type: 'button' });
  const status = h('p.rr-status', { 'aria-live': 'polite' });
  const element = h('aside.rr-side', { 'aria-label': 'Comments' },
    h('div.rr-side-head', {}, h('strong', {}, 'Comments'), count, filters),
    list,
    h('div.rr-compose', {}, on, input, h('div.rr-compose-row', {}, h('span.rr-hint', {}, 'Enter to add · Shift+Enter for a new line'), add)),
    h('div.rr-sendbar', {}, send, status));

  const nextN = () => state.comments.reduce((m, c) => Math.max(m, c.n), 0);
  /** The drafts with the numbers they'll be sent with. */
  const numbered = () => drafts.map((x, i) => ({ ...x, n: nextN() + i + 1 }));
  const here = () => {
    const w = d.where();
    return w ? drafts.filter((x) => x.app === w.app) : [];
  };
  const keep = () => saveDrafts(d.workerId, drafts);
  const shows = (s: PinState) => (filter === 'all' ? true : filter === 'done' ? s === 'done' : s !== 'done');

  function commit() {
    const text = input.value.trim();
    const w = d.where();
    if (!text || !w) return input.focus();
    const page = picked?.page ?? w.page;
    drafts.push({ id: `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, app: w.app, at: Date.now(), text, page, what: picked ? picked.pick.what : WHOLE_PAGE, selector: picked?.pick.selector ?? '' });
    keep();
    input.value = '';
    picked = undefined;
    if (filter === 'done') filter = 'open';
    paint();
    d.changed();
  }
  add.addEventListener('click', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      commit();
    }
  });

  send.addEventListener('click', async () => {
    const going = here();
    if (!going.length) return;
    send.disabled = true;
    error = '';
    status.textContent = 'Sending…';
    try {
      await d.send(going);
      drafts = drafts.filter((x) => !going.includes(x));
      keep();
      status.textContent = `Sent to ${d.workerName}. Its fixes show up here as the app reloads.`;
    } catch (e) {
      error = e instanceof Error ? e.message : 'The comments couldn’t be sent';
      status.textContent = error;
    }
    paint();
    d.changed();
  });

  function card(c: (Draft & { n: number }) | SentComment, st: PinState): HTMLElement {
    const draft = st === 'draft';
    const by = draft ? d.me() : (c as SentComment).by;
    const actions: HTMLElement[] = [];
    if (draft) {
      const x = h('button.rr-icon', { type: 'button', title: 'Remove', 'aria-label': `Remove comment ${c.n}` }, '✕');
      x.addEventListener('click', (e) => {
        e.stopPropagation();
        drafts = drafts.filter((y) => y.id !== c.id);
        keep();
        paint();
        d.changed();
      });
      actions.push(x);
    } else {
      const isDone = st === 'done';
      const check = h('button.rr-check', { type: 'button', 'aria-pressed': String(isDone), title: isDone ? 'Reopen' : 'Mark done', 'aria-label': `${isDone ? 'Reopen' : 'Mark done'} comment ${c.n}`, disabled: !d.canSend() }, '✓');
      check.addEventListener('click', async (e) => {
        e.stopPropagation();
        check.disabled = true;
        try {
          await d.done(c.id, !isDone);
        } catch (err) {
          status.textContent = err instanceof Error ? err.message : 'That didn’t save';
          check.disabled = false;
        }
      });
      actions.push(check);
    }
    const w = d.where();
    const spot: Spot = { app: c.app, page: c.page, selector: c.selector };
    const whereText = `${w && c.app !== w.app ? `${shortApp(c.app)} · ` : ''}${c.page} · ${c.what}`;
    const el = h('div.rr-card', { 'data-state': st, tabindex: '0', role: 'button', title: 'Show it in the app' },
      h('div.rr-card-head', {},
        h('span.rr-pin', {}, st === 'done' ? '✓' : String(c.n)),
        h('span.rr-avatar', { 'aria-hidden': 'true' }, (by.trim()[0] ?? '?').toUpperCase()),
        h('strong.rr-by', {}, by),
        h('span.rr-time', {}, draft ? 'not sent' : timeAgo(c.at)),
        h('span.rr-grow'),
        ...actions),
      h('div.rr-where', {}, whereText),
      h('p.rr-text', {}, c.text));
    el.addEventListener('mouseenter', () => d.focus(spot));
    el.addEventListener('mouseleave', () => d.focus(undefined));
    const go = () => d.reveal(spot);
    el.addEventListener('click', go);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target === el) go();
    });
    return el;
  }

  function paint() {
    for (const b of filters.querySelectorAll<HTMLElement>('button')) b.classList.toggle('on', b.dataset.filter === filter);
    const open = state.comments.filter((c) => !c.done).length;
    count.textContent = String(open + drafts.length);
    count.title = `${drafts.length} not sent · ${open} open · ${state.comments.length - open} done`;
    const groups: HTMLElement[] = [];
    const ds = numbered();
    if (ds.length && shows('draft')) groups.push(h('section.rr-group', {}, h('h4', {}, 'Not sent yet'), ...ds.map((x) => card(x, 'draft'))));
    for (const r of [...state.rounds].sort((a, b) => b.n - a.n)) {
      const cs = state.comments.filter((c) => c.round === r.n && shows(c.done ? 'done' : 'open')).sort((a, b) => a.n - b.n);
      if (!cs.length) continue;
      const when = new Date(r.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      groups.push(h('section.rr-group', {}, h('h4', {}, `Round ${r.n}`, h('span', {}, ` · ${when} · ${r.size.label ?? `${r.size.w}×${r.size.h}`}`)), ...cs.map((c) => card(c, c.done ? 'done' : 'open'))));
    }
    if (!groups.length) {
      groups.push(h('div.rr-none', {},
        h('strong', {}, filter === 'done' ? 'Nothing done yet' : 'No open comments'),
        h('p', {}, filter === 'done' ? `Check a comment once ${d.workerName} has fixed it.` : 'Press C, then click anything in the app to pin a comment to it. Or write one below about the whole page.')));
    }
    list.replaceChildren(...groups);

    const w = d.where();
    const can = d.canSend() && !!w;
    input.disabled = add.disabled = !can;
    if (!d.canSend()) on.replaceChildren(h('span', {}, 'You can watch this worker, but not direct it.'));
    else if (picked) {
      const unpin = h('button.rr-icon', { type: 'button', title: 'Make it about the whole page', 'aria-label': 'Unpin' }, '✕');
      unpin.addEventListener('click', () => {
        picked = undefined;
        paint();
        d.changed();
      });
      on.replaceChildren(h('span.rr-pin.draft', {}, String(nextN() + drafts.length + 1)), h('span.rr-on-text', {}, h('strong', {}, picked.pick.what), ` on ${picked.page}`), unpin);
    } else on.replaceChildren(h('span.rr-on-text', {}, w ? `About ${w.page} as a whole · press C and click to pin it to something` : 'Open an app to comment on it'));
    const n = here().length;
    send.textContent = n ? `Send ${n === 1 ? '1 comment' : `${n} comments`} to ${d.workerName}` : `Send to ${d.workerName}`;
    send.disabled = !n || !d.canSend();
    if (!error && !n && /^Sending/.test(status.textContent ?? '')) status.textContent = '';
  }

  return {
    element,
    pick(p) {
      picked = p;
      paint();
      input.focus({ preventScroll: true });
    },
    clearPick() {
      picked = undefined;
      paint();
    },
    hasPick: () => !!picked,
    busy: () => !!picked || !!input.value.trim(),
    setState(s) {
      state = s;
      paint();
    },
    pins(app, page) {
      const out: Pin[] = numbered().filter((x) => x.app === app && x.page === page && x.selector).map((x) => ({ n: x.n, selector: x.selector, state: 'draft' }));
      for (const c of state.comments) {
        const st: PinState = c.done ? 'done' : 'open';
        if (c.app === app && c.page === page && c.selector && shows(st)) out.push({ n: c.n, selector: c.selector, state: st });
      }
      return out;
    },
    drafts: () => drafts,
    focusBox: () => input.focus({ preventScroll: true }),
    paint,
  };
}
