import './panel.css';
import { h, timeAgo } from '../dom';
import { markdownFile } from '../markdown';
import { store } from '../../state';
import { APPS } from '../../../shared/apps';
import type { ReviewItem, ReviewQueueView, ReviewState } from '../../../shared/review-queue';
import type { WorkspaceTab } from '../../../shared/workspace';
import { openRoomShell } from '../workspace/room-shell';
import { setRoomDock } from '../workspace/room-dock';
import { appsFor, openItem } from './open';

// The review queue full screen (server/review-queue/): every agent's finished task on every floor, oldest waiting
// first, each down the left with the app it's best looked at in (Jev's pick, or its files'). The one chosen shows down
// the right: what it was asked, what it said, what it made. Enter opens it in that app's room, with the queue's strip
// over the room (] next, [ previous, Shift+A approve); here A approves, N writes notes, D dismisses, S skips, C opens
// its chat. One on another floor is opened once you've gone there.

export interface QueueDeps {
  /** Opens a worker's own window (its chat), going to its floor first. */
  openWorker(item: ReviewItem): void;
  /** Goes to an item's floor, then opens the queue on it again (and its room, with `open`). */
  goTo(item: ReviewItem, open: boolean): void;
}

const LIST_MS = 4000;
const APP_OF = new Map(APPS.map((a) => [a.tab, a]));
const appName = (t: WorkspaceTab) => APP_OF.get(t)?.name ?? t;
const appIcon = (t: WorkspaceTab) => APP_OF.get(t)?.icon ?? '';
const STATE_LABEL: Record<ReviewState, string> = { waiting: 'Waiting', approved: 'Approved', notes: 'Notes sent', dismissed: 'Dismissed' };
const by = () => store.me.account?.name ?? store.profile.name;
const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

async function call(path: string, body?: unknown): Promise<ReviewQueueView> {
  const res = await fetch(path, body === undefined ? { credentials: 'same-origin', cache: 'no-store' } : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...(body as object), by: by() }) });
  const out = await res.json().catch(() => undefined);
  if (!res.ok || !out) throw new Error(out?.error ?? 'The office didn\u2019t answer');
  return out as ReviewQueueView;
}

export function openReviewQueue(d: QueueDeps, o: { start?: string; open?: boolean } = {}): { close(): void } {
  let view: ReviewQueueView | undefined;
  let tab: 'waiting' | 'done' = 'waiting';
  let selected = o.start;
  let opened: { id: string; close(): void } | undefined;
  let approving: { id: string; until: number } | undefined;
  let listStamp = '';
  let sideStamp = '';
  let timer = 0;
  const notesFor = new Map<string, string>();

  setRoomDock(undefined);
  const shell = openRoomShell({
    className: 'queue-room',
    label: 'Review queue',
    doing: 'going through the review queue',
    key: onKey,
    escape: (e) => {
      if (e.target === notes && notes.value) return (notes.value = ''), notesFor.delete(selected ?? ''), true;
      return false;
    },
    onClose: () => {
      window.clearInterval(timer);
      setRoomDock(undefined);
      opened?.close();
    },
  });
  shell.name.textContent = 'Review queue';
  const tabs = h('div.rr-sizes', { role: 'group', 'aria-label': 'Show' });
  shell.right.append(tabs);
  const list = h('div.rq-list', { role: 'listbox', 'aria-label': 'Finished tasks' });
  shell.stage.classList.add('rq-stage');
  shell.stage.append(list);
  const side = h('aside.rr-side.rq-side', { 'aria-label': 'The task chosen' });
  shell.side(side);
  const status = h('p.rr-status.rq-status', { 'aria-live': 'polite' });
  const notes = h('textarea.rr-input.rq-notes', { rows: 3, maxlength: 20000, placeholder: 'Notes to send back (N)\u2026', 'aria-label': 'Notes to send back' }) as HTMLTextAreaElement;
  notes.addEventListener('input', () => selected && notesFor.set(selected, notes.value));
  notes.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      const i = chosen();
      if (i) void decide(i, 'notes');
    }
  });

  const items = () => view?.items ?? [];
  const shown = () => items().filter((i) => (tab === 'waiting' ? i.state === 'waiting' : i.state !== 'waiting'));
  const chosen = () => items().find((i) => i.id === selected);
  const waiting = () => items().filter((i) => i.state === 'waiting');

  // ---- The list ----
  function card(i: ReviewItem): HTMLElement {
    const el = h('div.rq-card', { role: 'option', tabindex: '0', 'data-id': i.id, 'data-state': i.state, 'aria-selected': String(i.id === selected) },
      h('div.rq-card-head', {}, h('span.rq-app', {}, `${appIcon(i.app)} ${appName(i.app)}`), i.by === 'jev' ? h('span.rq-jev', { title: 'Jev, TypeSafe\u2019s decision model, picked the app' }, `Jev ${Math.round((i.confidence ?? 0) * 100)}%`) : '', h('span.rq-when', {}, timeAgo(i.updatedAt))),
      h('strong.rq-who', {}, i.workerName, h('span', {}, ` \u00b7 ${i.floorName}`)),
      h('div.rq-task', {}, i.task),
      i.said ? h('div.rq-said', {}, i.said.replace(/[#*_`>]/g, '').slice(0, 220)) : '',
      i.state !== 'waiting' ? h('span.rq-state', { 'data-state': i.state }, `${STATE_LABEL[i.state]}${i.decidedBy ? ` \u00b7 ${i.decidedBy}` : ''}`) : '');
    el.addEventListener('click', () => select(i.id));
    el.addEventListener('dblclick', () => void open(i));
    return el;
  }

  function paint() {
    const n = waiting().length;
    shell.sub.textContent = !view ? 'Loading\u2026' : `${n} waiting \u00b7 ${view.jev ? 'Jev picks the app for each' : 'each opens in its files\u2019 app (no TypeSafe key for Jev)'}`;
    tabs.replaceChildren(...(['waiting', 'done'] as const).map((t) => {
      const b = h('button', { type: 'button', class: t === tab ? 'on' : '' }, t === 'waiting' ? `Waiting${n ? ` ${n}` : ''}` : 'Done');
      b.addEventListener('click', () => {
        tab = t;
        selected = shown()[0]?.id;
        paint();
      });
      return b;
    }));
    const list_ = shown();
    if (selected && !items().some((i) => i.id === selected)) selected = list_[0]?.id;
    if (!selected) selected = list_[0]?.id;
    const stamp = JSON.stringify([tab, list_.map((i) => [i.id, i.state, i.updatedAt, i.app]), Math.floor(Date.now() / 60_000)]);
    if (stamp !== listStamp) {
      listStamp = stamp;
      list.replaceChildren(...(list_.length ? list_.map(card) : [h('div.rq-empty', {}, h('strong', {}, tab === 'waiting' ? 'Nothing waiting' : 'Nothing decided yet'), h('p', {}, tab === 'waiting' ? 'When an agent finishes a task, it lands here to be looked at in the app that suits it.' : 'What you approve, send notes on or dismiss shows here.'))]));
    }
    for (const c of list.querySelectorAll<HTMLElement>('.rq-card')) c.setAttribute('aria-selected', String(c.dataset.id === selected));
    paintSide();
  }

  function select(id: string | undefined) {
    if (!id) return;
    selected = id;
    approving = undefined;
    paint();
    list.querySelector<HTMLElement>(`.rq-card[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  // ---- The one chosen ----
  function paintSide() {
    const i = chosen();
    const stamp = JSON.stringify([i, approving?.id === i?.id]);
    if (stamp === sideStamp) return;
    sideStamp = stamp;
    if (!i) {
      side.replaceChildren(h('div.rr-none', {}, h('strong', {}, 'Choose a task'), h('p', {}, 'What it was asked, what it said and what it made show here.')));
      return;
    }
    const elsewhere = i.floor !== store.floor;
    const apps = appsFor(i).map((t) => {
      const b = h('button.rq-chip', { type: 'button', 'aria-pressed': String(t === i.app), title: t === i.app ? (i.by === 'jev' ? `Jev picked this, ${Math.round((i.confidence ?? 0) * 100)}% sure` : 'Its files say so') : `Open it in ${appName(t)} instead` }, `${appIcon(t)} ${appName(t)}`);
      b.addEventListener('click', () => void open(i, t));
      return b;
    });
    const openBtn = h('button.rr-send', { type: 'button' }, elsewhere ? `Go to ${i.floorName} and open it \u21b5` : `Open in ${appName(i.app)} \u21b5`);
    openBtn.addEventListener('click', () => void open(i));
    const chat = h('button.rr-ghost', { type: 'button', title: 'Its own window: the conversation and every tab (C)' }, '\u{1f4ac} Chat');
    chat.addEventListener('click', () => d.openWorker(i));
    let actions: HTMLElement;
    if (i.state === 'waiting') {
      const sure = approving?.id === i.id && approving.until > Date.now();
      const approve = h(`button.rr-ghost.rq-approve${sure ? '.confirm' : ''}`, { type: 'button', title: i.files.length ? 'Tells the worker its files are final, as a room\u2019s Approve does (A)' : 'Marks it approved (A)' }, sure ? 'Approve? Again to confirm' : '\u2713 Approve');
      approve.addEventListener('click', () => approveOf(i) && void decide(i, 'approved'));
      const dismiss = h('button.rr-ghost', { type: 'button', title: 'Take it off the queue and tell the worker nothing (D)' }, 'Dismiss');
      dismiss.addEventListener('click', () => void decide(i, 'dismissed'));
      const skip = h('button.rr-ghost', { type: 'button', title: 'Leave it waiting and go to the next (S)' }, 'Skip');
      skip.addEventListener('click', () => next(1));
      const send = h('button.rr-ghost', { type: 'button', title: 'Send the notes to the worker (\u2318/Ctrl Enter)' }, 'Send notes');
      send.addEventListener('click', () => void decide(i, 'notes'));
      notes.value = notesFor.get(i.id) ?? '';
      notes.placeholder = `Notes for ${i.workerName} to work on (N)\u2026`;
      actions = h('div.rq-foot', {}, openBtn, h('div.rq-row', {}, approve, dismiss, skip, chat), notes, h('div.rq-row', {}, send), status);
    } else {
      const back = h('button.rr-ghost', { type: 'button' }, 'Put it back in the queue');
      back.addEventListener('click', () => void decide(i, 'waiting'));
      actions = h('div.rq-foot', {}, openBtn, h('p.rq-decided', {}, `${STATE_LABEL[i.state]}${i.decidedBy ? ` by ${i.decidedBy}` : ''}${i.decidedAt ? ` \u00b7 ${timeAgo(i.decidedAt)}` : ''}`), h('div.rq-row', {}, back, chat), status);
    }
    side.replaceChildren(
      h('div.rq-side-head', {}, h('strong', {}, i.workerName), h('p', {}, `${i.floorName} \u00b7 finished ${timeAgo(i.updatedAt)}`)),
      h('div.rq-side-body', {},
        h('h4', {}, 'Asked'), h('p.rq-ask', {}, i.task),
        h('h4', {}, 'Open in'), h('div.rq-chips', {}, ...apps),
        i.said ? h('h4', {}, 'What it said') : '', i.said ? h('div.rq-message', {}, markdownFile(i.said)) : '',
        i.files.length ? h('h4', {}, `What it made \u00b7 ${i.files.length}`) : '',
        i.files.length ? h('ul.rq-files', {}, ...i.files.map((f) => h('li', { title: f.path }, f.path.split('/').pop() ?? f.path))) : ''),
      actions);
  }

  // ---- Doing things ----
  async function decide(i: ReviewItem, state: ReviewState) {
    const text = state === 'notes' ? notes.value.trim() : undefined;
    if (state === 'notes' && !text) {
      notes.focus();
      status.textContent = 'Write the notes first.';
      return;
    }
    status.textContent = state === 'notes' ? 'Sending\u2026' : 'Saving\u2026';
    try {
      const at = shown().findIndex((x) => x.id === i.id);
      view = await call('/api/review-queue/decide', { id: i.id, state, ...(text ? { notes: text } : {}) });
      notesFor.delete(i.id);
      status.textContent = state === 'approved' ? `Approved ${i.workerName}\u2019s work.` : state === 'notes' ? `Notes sent to ${i.workerName}.` : state === 'dismissed' ? 'Dismissed.' : 'Back in the queue.';
      // On to the next one waiting, where this one was.
      const rest = shown();
      selected = rest[Math.min(Math.max(0, at), rest.length - 1)]?.id;
      sideStamp = '';
      paint();
    } catch (e) {
      status.textContent = e instanceof Error ? e.message : 'That didn\u2019t work';
    }
  }

  /** Approving takes a second press within 4 seconds, as a room's Approve does: true on the second. */
  function approveOf(i: ReviewItem): boolean {
    if (approving?.id === i.id && approving.until > Date.now()) {
      approving = undefined;
      return true;
    }
    approving = { id: i.id, until: Date.now() + 4000 };
    sideStamp = '';
    paintSide();
    window.setTimeout(() => {
      if (approving?.id === i.id && approving.until <= Date.now()) {
        approving = undefined;
        sideStamp = '';
        paintSide();
      }
    }, 4100);
    return false;
  }

  function next(by: number) {
    const l = shown();
    const at = l.findIndex((x) => x.id === selected);
    select(l[Math.max(0, Math.min(l.length - 1, at + by))]?.id);
  }

  async function open(i: ReviewItem, app: WorkspaceTab = i.app) {
    if (i.floor !== store.floor) return d.goTo(i, true);
    opened?.close();
    selected = i.id;
    paint();
    status.textContent = `Opening ${appName(app)}\u2026`;
    setRoomDock(dockFor(i));
    const id = i.id;
    const r = await openItem(i, app, () => {
      if (opened?.id !== id) return;
      opened = undefined;
      setRoomDock(undefined);
    });
    if (typeof r === 'string') {
      setRoomDock(undefined);
      status.textContent = r;
      return;
    }
    status.textContent = '';
    opened = { id, close: r.close };
  }

  // ---- The strip over a room it opened (ui/workspace/room-dock.ts) ----
  function dockFor(i: ReviewItem) {
    const step = (by: number) => {
      const l = shown();
      const at = l.findIndex((x) => x.id === i.id);
      const to = l[at + by];
      opened?.close();
      if (!to) return select(i.id);
      select(to.id);
      if (to.floor === store.floor) void open(to);
    };
    // Approved from its room: the room closes and the next one waiting here opens in its own.
    const approve = async () => {
      if (!approveOf(i)) return;
      opened?.close();
      await decide(i, 'approved');
      const to = chosen();
      if (to?.state === 'waiting' && to.floor === store.floor) void open(to);
    };
    return {
      bar: () => {
        const l = shown();
        const at = l.findIndex((x) => x.id === i.id);
        const sure = () => approving?.id === i.id && approving.until > Date.now();
        const ok = h('button.ok', { type: 'button', disabled: i.state !== 'waiting', title: 'Approve it and go to the next (Shift+A)' }, '\u2713 Approve', h('kbd', {}, '\u21e7A'));
        const refresh = () => {
          ok.classList.toggle('confirm', sure());
          ok.firstChild!.textContent = sure() ? 'Again to approve' : '\u2713 Approve';
        };
        ok.addEventListener('click', () => {
          void approve().then(refresh);
          window.setTimeout(refresh, 4200);
        });
        const prev = h('button', { type: 'button', disabled: at <= 0 }, '\u2039 Previous', h('kbd', {}, '['));
        prev.addEventListener('click', () => step(-1));
        const nxt = h('button', { type: 'button', disabled: at < 0 || at >= l.length - 1 }, 'Next \u203a', h('kbd', {}, ']'));
        nxt.addEventListener('click', () => step(1));
        const back = h('button', { type: 'button', title: 'Close the room and go back to the queue (Esc)' }, 'Queue');
        back.addEventListener('click', () => opened?.close());
        dockKeys = { approve: () => ok.click(), step };
        return h('div.rr-dock', { role: 'toolbar', 'aria-label': 'Review queue' }, h('span.rr-dock-label', {}, '\u{1f4e5} Review queue', h('span', {}, at >= 0 ? `${at + 1} of ${l.length}` : '')), h('span.rr-dock-task', {}, `${i.workerName}: ${i.task}`), ok, prev, nxt, back);
      },
      key: (e: KeyboardEvent) => {
        if (e.key === ']') return dockKeys?.step(1), true;
        if (e.key === '[') return dockKeys?.step(-1), true;
        if (e.key === 'A' && e.shiftKey) return dockKeys?.approve(), true;
        return false;
      },
    };
  }
  let dockKeys: { approve(): void; step(by: number): void } | undefined;

  // ---- Keys, here ----
  function onKey(e: KeyboardEvent): boolean {
    if (typing(e.target)) return false;
    const i = chosen();
    const k = e.key;
    if (k === 'ArrowDown' || k === 'j') return next(1), true;
    if (k === 'ArrowUp' || k === 'k') return next(-1), true;
    if (!i) return false;
    if (k === 'Enter' || k === 'o') return void open(i), true;
    if (k === 'c') return d.openWorker(i), true;
    if (i.state !== 'waiting') return false;
    if (k === 'a') {
      if (approveOf(i)) void decide(i, 'approved');
      return true;
    }
    if (k === 'd') return void decide(i, 'dismissed'), true;
    if (k === 's') return next(1), true;
    if (k === 'n') return notes.focus(), true;
    return false;
  }

  async function load() {
    try {
      view = await call('/api/review-queue');
    } catch (e) {
      shell.sub.textContent = e instanceof Error ? e.message : 'The office didn\u2019t answer';
      return;
    }
    // One it was asked to start on that's been decided meanwhile: show it where it is.
    const start = selected && items().find((x) => x.id === selected);
    if (start && start.state !== 'waiting' && tab === 'waiting' && !opened) tab = 'done';
    paint();
  }
  void load().then(() => {
    const i = chosen();
    if (o.open && i && i.floor === store.floor) void open(i);
  });
  timer = window.setInterval(() => document.visibilityState === 'visible' && void load(), LIST_MS);
  return { close: () => shell.close() };
}
